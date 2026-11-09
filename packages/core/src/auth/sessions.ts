import { createHash, randomBytes } from 'node:crypto'
import { getPrisma } from '@wick/db'
import { UnauthorizedError } from '../errors'
import { parse } from '../validation'
import { toAuthUser, type AuthUser } from './actor'
import { getDummyHash, verifyPassword } from './password'
import { assertLoginAllowed, recordLoginFailure, recordLoginSuccess } from './rate-limit'
import { loginInput, type LoginInput } from './schemas'

/** Nombre de la cookie de sesión, compartido por la web y el servidor de colaboración. */
export const SESSION_COOKIE = 'wick_session'

/** Extrae el token de sesión de una cabecera Cookie. */
export function readSessionCookie(cookieHeader: string | null | undefined): string | undefined {
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === SESSION_COOKIE) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

/** Una sesión dura 30 días desde el último uso. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Como mucho una escritura por hora para renovar la sesión. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000

export interface IssuedSession {
  /** Va en la cookie. Solo existe en claro en este momento. */
  token: string
  expiresAt: Date
  user: AuthUser
}

export interface ValidSession {
  sessionId: string
  user: AuthUser
  expiresAt: Date
  /** true si se acaba de extender: conviene reenviar la cookie con la nueva caducidad. */
  renewed: boolean
}

export interface ClientInfo {
  ip?: string
  userAgent?: string
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const looksLikeToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token)

export async function createSession(user: AuthUser, client: ClientInfo = {}): Promise<IssuedSession> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await getPrisma().session.create({
    data: { id: hashToken(token), userId: user.id, expiresAt, userAgent: client.userAgent?.slice(0, 300) },
  })
  return { token, expiresAt, user }
}

export async function login(input: LoginInput, client: ClientInfo = {}): Promise<IssuedSession> {
  const { username, password } = parse(loginInput, input)
  const limitKey = `${username}|${client.ip ?? '-'}`
  assertLoginAllowed(limitKey)

  const user = await getPrisma().user.findUnique({ where: { username } })
  // Siempre se verifica un hash, exista o no el usuario, para no revelarlo por el tiempo de respuesta.
  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()))

  if (!user || !ok || user.disabledAt) {
    recordLoginFailure(limitKey)
    throw new UnauthorizedError('Usuario o contraseña incorrectos')
  }

  recordLoginSuccess(limitKey)
  void purgeExpiredSessions().catch(() => {})
  return createSession(toAuthUser(user), client)
}

/** Devuelve la sesión si el token es válido y la cuenta sigue activa; si no, null. */
export async function validateSession(token: string | undefined | null): Promise<ValidSession | null> {
  if (!token || !looksLikeToken(token)) return null
  const prisma = getPrisma()
  const id = hashToken(token)
  const session = await prisma.session.findUnique({ where: { id }, include: { user: true } })
  if (!session) return null

  const now = Date.now()
  if (session.expiresAt.getTime() <= now) {
    await prisma.session.delete({ where: { id } }).catch(() => {})
    return null
  }
  if (session.user.disabledAt) return null

  let expiresAt = session.expiresAt
  let renewed = false
  if (now - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    expiresAt = new Date(now + SESSION_TTL_MS)
    renewed = true
    await prisma.session
      .update({ where: { id }, data: { lastUsedAt: new Date(now), expiresAt } })
      .catch(() => {}) // si se cerró justo ahora, no pasa nada
  }

  return { sessionId: id, user: toAuthUser(session.user), expiresAt, renewed }
}

export async function logout(token: string | undefined | null): Promise<void> {
  if (!token || !looksLikeToken(token)) return
  await getPrisma().session.deleteMany({ where: { id: hashToken(token) } })
}

/** Cierra todas las sesiones de un usuario, salvo opcionalmente una. */
export async function revokeUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await getPrisma().session.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  })
}

export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await getPrisma().session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  return count
}
