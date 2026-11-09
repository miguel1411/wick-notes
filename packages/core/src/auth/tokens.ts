import { createHash, randomBytes } from 'node:crypto'
import { getPrisma } from '@wick/db'
import { z } from 'zod'
import { ConflictError, NotFoundError } from '../errors'
import { parse } from '../validation'
import { requireActor, toAuthUser, type AuthUser } from './actor'

/** read: solo consultar. write: consultar, crear y modificar notas. */
export type TokenScope = 'read' | 'write'

export const TOKEN_PREFIX = 'wick_'
/** Un usuario no puede tener más tokens que estos. */
const MAX_TOKENS_PER_USER = 50
const TOUCH_INTERVAL_MS = 60 * 60 * 1000

export const createApiTokenInput = z.object({
  name: z.string().trim().min(1, 'Ponle un nombre al token').max(80, 'El nombre no puede superar 80 caracteres'),
  scope: z.enum(['read', 'write']).default('read'),
  /** null o ausente = no caduca. */
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
})
export type CreateApiTokenInput = z.input<typeof createApiTokenInput>

export interface ApiTokenSummary {
  id: string
  name: string
  /** Inicio del token para reconocerlo (p. ej. `wick_Ab3d…`). */
  prefix: string
  scope: TokenScope
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date | null
}

export interface ValidToken {
  tokenId: string
  user: AuthUser
  scope: TokenScope
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const looksLikeToken = (token: string) => new RegExp(`^${TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`).test(token)
const fromDbScope = (s: 'READ' | 'WRITE'): TokenScope => (s === 'WRITE' ? 'write' : 'read')

const summarySelect = { id: true, name: true, prefix: true, scope: true, createdAt: true, lastUsedAt: true, expiresAt: true } as const
const toSummary = (t: { id: string; name: string; prefix: string; scope: 'READ' | 'WRITE'; createdAt: Date; lastUsedAt: Date | null; expiresAt: Date | null }): ApiTokenSummary => ({
  ...t,
  scope: fromDbScope(t.scope),
})

/** Crea un token del propio usuario. El token completo solo se devuelve aquí. */
export async function createApiToken(
  actor: AuthUser,
  input: CreateApiTokenInput,
): Promise<{ token: string; summary: ApiTokenSummary }> {
  requireActor(actor)
  const data = parse(createApiTokenInput, input)
  const prisma = getPrisma()
  if ((await prisma.apiToken.count({ where: { userId: actor.id } })) >= MAX_TOKENS_PER_USER) {
    throw new ConflictError(`Ya tienes ${MAX_TOKENS_PER_USER} tokens; revoca alguno antes de crear otro`)
  }
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url')
  const created = await prisma.apiToken.create({
    data: {
      userId: actor.id,
      name: data.name,
      tokenHash: hash(token),
      prefix: token.slice(0, TOKEN_PREFIX.length + 4),
      scope: data.scope === 'write' ? 'WRITE' : 'READ',
      expiresAt: data.expiresInDays ? new Date(Date.now() + data.expiresInDays * 86_400_000) : null,
    },
    select: summarySelect,
  })
  return { token, summary: toSummary(created) }
}

export async function listApiTokens(actor: AuthUser): Promise<ApiTokenSummary[]> {
  requireActor(actor)
  const tokens = await getPrisma().apiToken.findMany({
    where: { userId: actor.id },
    select: summarySelect,
    orderBy: { createdAt: 'desc' },
  })
  return tokens.map(toSummary)
}

/** Revoca (borra) un token propio. */
export async function revokeApiToken(actor: AuthUser, id: string): Promise<void> {
  requireActor(actor)
  const { count } = await getPrisma().apiToken.deleteMany({ where: { id, userId: actor.id } })
  if (count === 0) throw new NotFoundError('Token')
}

/** Devuelve usuario y alcance si el token es válido, no ha caducado y la cuenta está activa. */
export async function validateApiToken(token: string | undefined | null): Promise<ValidToken | null> {
  if (!token || !looksLikeToken(token)) return null
  const prisma = getPrisma()
  const row = await prisma.apiToken.findUnique({ where: { tokenHash: hash(token) }, include: { user: true } })
  if (!row || row.user.disabledAt) return null
  const now = Date.now()
  if (row.expiresAt && row.expiresAt.getTime() <= now) return null
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date(now) } }).catch(() => {})
  }
  return { tokenId: row.id, user: toAuthUser(row.user), scope: fromDbScope(row.scope) }
}
