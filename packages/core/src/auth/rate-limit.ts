import { RateLimitedError } from '../errors'

/**
 * Límite de intentos fallidos de inicio de sesión, en memoria (un solo proceso).
 * Clave típica: `usuario|ip`. Tras MAX_FAILURES fallos en WINDOW_MS, bloquea WINDOW_MS.
 */
const MAX_FAILURES = 8
const WINDOW_MS = 15 * 60 * 1000

interface Entry {
  failures: number
  firstAt: number
  blockedUntil?: number
}

const entries = new Map<string, Entry>()

export function assertLoginAllowed(key: string, now = Date.now()): void {
  const entry = entries.get(key)
  if (entry?.blockedUntil && entry.blockedUntil > now) {
    throw new RateLimitedError(Math.ceil((entry.blockedUntil - now) / 1000))
  }
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  let entry = entries.get(key)
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    entry = { failures: 0, firstAt: now }
    entries.set(key, entry)
  }
  entry.failures++
  if (entry.failures >= MAX_FAILURES) entry.blockedUntil = now + WINDOW_MS

  // Limpieza ocasional para que el mapa no crezca sin límite.
  if (entries.size > 10_000) {
    for (const [k, e] of entries) if (now - e.firstAt > WINDOW_MS && !(e.blockedUntil && e.blockedUntil > now)) entries.delete(k)
  }
}

export function recordLoginSuccess(key: string): void {
  entries.delete(key)
}

/** Solo para tests. */
export function resetLoginRateLimit(): void {
  entries.clear()
}
