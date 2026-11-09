import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'

// scrypt viene con Node: sin dependencias nativas. Parámetros recomendados por OWASP.
const N = 2 ** 15
const r = 8
const p = 1
const KEY_LENGTH = 64
const MAX_MEM = 128 * N * r * 2

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

/** Devuelve `scrypt$N$r$p$sal$hash` (base64url), autocontenido para poder cambiar parámetros. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { N, r, p, maxmem: MAX_MEM })
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, rr, pp, saltB64, keyB64] = parts as [string, string, string, string, string, string]
  const expected = Buffer.from(keyB64, 'base64url')
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(rr),
    p: Number(pp),
    maxmem: 128 * Number(n) * Number(rr) * 2,
  })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/**
 * Hash con una contraseña aleatoria, para comparar cuando el usuario no existe
 * y que la respuesta tarde lo mismo (no revela qué usuarios existen).
 */
let dummyHash: Promise<string> | undefined
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'))
  return dummyHash
}
