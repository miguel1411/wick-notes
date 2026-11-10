import { getPrisma, Prisma } from '@wick/db'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { parse } from '../validation'
import { requireActor, requireAdmin, toAuthUser, type AuthUser, type UserRole } from './actor'
import { hashPassword, verifyPassword } from './password'
import {
  changeOwnPasswordInput,
  createUserInput,
  resetPasswordInput,
  setupInput,
  updateUserInput,
  type ChangeOwnPasswordInput,
  type CreateUserInput,
  type SetupInput,
  type UpdateUserInput,
} from './schemas'
import { revokeUserSessions } from './sessions'

export interface UserSummary {
  id: string
  username: string
  name: string
  role: UserRole
  disabled: boolean
  createdAt: Date
}

const userSelect = { id: true, username: true, name: true, role: true, disabledAt: true, createdAt: true } as const

function toSummary(u: { id: string; username: string; name: string; role: UserRole; disabledAt: Date | null; createdAt: Date }): UserSummary {
  return { id: u.id, username: u.username, name: u.name, role: u.role, disabled: !!u.disabledAt, createdAt: u.createdAt }
}

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
const isNotFound = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'

/** true mientras la instalación no tenga ningún usuario (hay que crear el primer admin). */
export async function isSetupRequired(): Promise<boolean> {
  return (await getPrisma().user.count()) === 0
}

/**
 * Crea el primer administrador. Solo funciona si no existe ningún usuario;
 * un bloqueo en la base de datos evita que dos peticiones simultáneas creen dos.
 */
export async function createInitialAdmin(input: SetupInput): Promise<AuthUser> {
  const data = parse(setupInput, input)
  const passwordHash = await hashPassword(data.password)
  return getPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(718201)`
    if ((await tx.user.count()) > 0) throw new ConflictError('Esta instalación ya tiene un administrador')
    const user = await tx.user.create({
      data: { username: data.username, name: data.name, passwordHash, role: 'ADMIN' },
    })
    return toAuthUser(user)
  })
}

export async function listUsers(actor: AuthUser): Promise<UserSummary[]> {
  requireAdmin(actor)
  const users = await getPrisma().user.findMany({ select: userSelect, orderBy: { createdAt: 'asc' } })
  return users.map(toSummary)
}

export async function createUser(actor: AuthUser, input: CreateUserInput): Promise<UserSummary> {
  requireAdmin(actor)
  const data = parse(createUserInput, input)
  const passwordHash = await hashPassword(data.password)
  try {
    const user = await getPrisma().user.create({
      data: { username: data.username, name: data.name, role: data.role, passwordHash },
      select: userSelect,
    })
    return toSummary(user)
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError('Ya existe un usuario con ese nombre')
    throw err
  }
}

export async function updateUser(actor: AuthUser, id: string, input: UpdateUserInput): Promise<UserSummary> {
  requireAdmin(actor)
  const data = parse(updateUserInput, input)

  // Así siempre queda al menos un administrador activo: quien hace el cambio.
  if (id === actor.id && (data.role === 'MEMBER' || data.disabled === true)) {
    throw new ForbiddenError('No puedes quitarte el rol de administrador ni desactivar tu propia cuenta')
  }

  try {
    const user = await getPrisma().user.update({
      where: { id },
      data: {
        name: data.name,
        role: data.role,
        ...(data.disabled === undefined ? {} : { disabledAt: data.disabled ? new Date() : null }),
      },
      select: userSelect,
    })
    if (data.disabled) await revokeUserSessions(id)
    return toSummary(user)
  } catch (err) {
    if (isNotFound(err)) throw new NotFoundError('Usuario')
    throw err
  }
}

/** Un admin pone una contraseña nueva a otra cuenta; se cierran sus sesiones abiertas. */
export async function resetUserPassword(actor: AuthUser, id: string, input: { password: string }): Promise<void> {
  requireAdmin(actor)
  const { password } = parse(resetPasswordInput, input)
  const passwordHash = await hashPassword(password)
  try {
    await getPrisma().user.update({ where: { id }, data: { passwordHash } })
  } catch (err) {
    if (isNotFound(err)) throw new NotFoundError('Usuario')
    throw err
  }
  await revokeUserSessions(id)
}

/** Cambio de la propia contraseña; cierra las demás sesiones, conserva la actual. */
export async function changeOwnPassword(
  actor: AuthUser,
  input: ChangeOwnPasswordInput,
  currentSessionId?: string,
): Promise<void> {
  const { currentPassword, newPassword } = parse(changeOwnPasswordInput, input)
  const prisma = getPrisma()
  const user = await prisma.user.findUnique({ where: { id: actor.id } })
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    // Error de validación (no 401): la sesión sigue siendo válida.
    throw new ValidationError('La contraseña actual no es correcta')
  }
  await prisma.user.update({ where: { id: actor.id }, data: { passwordHash: await hashPassword(newPassword) } })
  await revokeUserSessions(actor.id, currentSessionId)
}

/**
 * Personas con cuenta activa (solo id, usuario y nombre), para elegir miembros de
 * un espacio. Lo puede consultar cualquier usuario con sesión.
 */
export async function listUserDirectory(actor: AuthUser): Promise<{ id: string; username: string; name: string }[]> {
  requireActor(actor)
  return getPrisma().user.findMany({
    where: { disabledAt: null },
    select: { id: true, username: true, name: true },
    orderBy: { name: 'asc' },
  })
}
