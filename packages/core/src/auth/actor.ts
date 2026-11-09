import type { User } from '@wick/db'
import { ForbiddenError, UnauthorizedError } from '../errors'

export type UserRole = 'ADMIN' | 'MEMBER'

/**
 * Quién hace la operación. Toda función de core que actúa en nombre de alguien lo
 * recibe, para que web, CLI y MCP apliquen exactamente los mismos permisos.
 */
export interface AuthUser {
  id: string
  username: string
  name: string
  role: UserRole
}

export function toAuthUser(user: Pick<User, 'id' | 'username' | 'name' | 'role'>): AuthUser {
  return { id: user.id, username: user.username, name: user.name, role: user.role }
}

export function requireActor(actor: AuthUser | null | undefined): AuthUser {
  if (!actor) throw new UnauthorizedError()
  return actor
}

export function requireAdmin(actor: AuthUser | null | undefined): AuthUser {
  const a = requireActor(actor)
  if (a.role !== 'ADMIN') throw new ForbiddenError('Solo un administrador puede hacer esto')
  return a
}
