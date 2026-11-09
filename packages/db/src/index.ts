import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client'

export { Prisma, PrismaClient } from './generated/prisma/client'
export { Role } from './generated/prisma/client'
export type { Document, Session, User } from './generated/prisma/client'

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error('DATABASE_URL no está definida')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

// Un único cliente por proceso (sobrevive a recargas en caliente en desarrollo).
const globalForPrisma = globalThis as unknown as { __wickPrisma?: PrismaClient }

export function getPrisma(): PrismaClient {
  globalForPrisma.__wickPrisma ??= createPrismaClient()
  return globalForPrisma.__wickPrisma
}

export async function disconnectPrisma(): Promise<void> {
  await globalForPrisma.__wickPrisma?.$disconnect()
  globalForPrisma.__wickPrisma = undefined
}
