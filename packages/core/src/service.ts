import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Secreto compartido entre la web y el servidor de colaboración para sus llamadas
 * internas. Se deriva de DATABASE_URL (que ambos procesos ya conocen), así que no
 * hay nada más que configurar: quien conoce DATABASE_URL ya tiene acceso a todo.
 * Se puede fijar explícitamente con WICK_SERVICE_SECRET.
 */
export function getServiceSecret(): string {
  const explicit = process.env.WICK_SERVICE_SECRET
  if (explicit) return explicit
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) throw new Error('DATABASE_URL no está definida')
  return createHmac('sha256', dbUrl).update('wick-notes/collab-service/v1').digest('hex')
}

export const SERVICE_HEADER = 'x-wick-service'

export function isValidServiceSecret(value: string | null | undefined): boolean {
  if (!value) return false
  const a = Buffer.from(value)
  const b = Buffer.from(getServiceSecret())
  return a.length === b.length && timingSafeEqual(a, b)
}
