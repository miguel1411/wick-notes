import { getPrisma } from '@wick/db'
import { hashPassword, resetLoginRateLimit, toAuthUser, type AuthUser } from '../src'

/** Vacía la base de datos de pruebas (en orden, por las claves foráneas). */
export async function resetDatabase() {
  const prisma = getPrisma()
  await prisma.aiRun.deleteMany()
  await prisma.aiUserFolder.deleteMany()
  await prisma.aiSettings.deleteMany()
  await prisma.moveRequest.deleteMany()
  await prisma.documentVersion.deleteMany()
  await prisma.document.deleteMany()
  await prisma.folder.deleteMany()
  await prisma.workspaceMember.deleteMany()
  await prisma.workspace.deleteMany({ where: { id: { not: 'general' } } })
  // El espacio «General» (para todos) lo crea la migración; se deja como recién instalado.
  await prisma.workspace.upsert({
    where: { id: 'general' },
    create: { id: 'general', name: 'General', everyone: true },
    update: { name: 'General', everyone: true },
  })
  await prisma.session.deleteMany()
  await prisma.apiToken.deleteMany()
  await prisma.user.deleteMany()
  resetLoginRateLimit()
}

let counter = 0
// Hash calculado una vez: scrypt es lento a propósito.
let hash: Promise<string> | undefined
export const TEST_PASSWORD = 'contraseña-de-prueba'

export async function makeUser(role: 'ADMIN' | 'MEMBER' = 'MEMBER', opts: { disabled?: boolean } = {}): Promise<AuthUser> {
  hash ??= hashPassword(TEST_PASSWORD)
  const n = ++counter
  const user = await getPrisma().user.create({
    data: {
      username: `user${n}`,
      name: `Usuario ${n}`,
      role,
      passwordHash: await hash,
      disabledAt: opts.disabled ? new Date() : null,
    },
  })
  return toAuthUser(user)
}
