import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'

/**
 * Cifrado de secretos guardados en la base de datos (la clave de API del
 * proveedor de IA), con AES-256-GCM. Así la clave no queda legible en la base de
 * datos ni en sus respaldos.
 *
 * La clave maestra sale de WICK_SECRET_KEY. Si no está definida, se deriva de
 * DATABASE_URL, igual que el secreto entre servicios (service.ts): no hay que
 * configurar nada más, y un volcado de la base de datos no incluye esa URL. Si
 * cambia la clave maestra (o DATABASE_URL sin WICK_SECRET_KEY), los secretos
 * guardados ya no se pueden leer y hay que volver a escribirlos en la web.
 */

const VERSION = 'v1'

function masterKey(): Buffer {
  const explicit = process.env.WICK_SECRET_KEY
  if (explicit) return createHash('sha256').update(explicit).digest()
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) throw new Error('Define WICK_SECRET_KEY o DATABASE_URL para cifrar secretos')
  return createHmac('sha256', dbUrl).update('wick-notes/secrets/v1').digest()
}

/** Texto cifrado: `v1:<iv>:<tag>:<datos>` en base64url. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join(':')
}

/** Descifra lo que produjo encryptSecret. Devuelve null si no se puede (clave maestra distinta o dato dañado). */
export function decryptSecret(encrypted: string): string | null {
  const [version, iv, tag, data] = encrypted.split(':')
  if (version !== VERSION || !iv || !tag || data === undefined) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

/** Últimos caracteres de una clave, para reconocerla sin mostrarla. */
export function secretHint(plain: string): string {
  return plain.length > 8 ? plain.slice(-4) : ''
}
