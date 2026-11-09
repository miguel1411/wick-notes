import { RateLimitedError, WickError } from '@wick/core'
import type { H3Event } from 'h3'

const STATUS: Record<WickError['code'], number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
}

/**
 * Ejecuta una operación de @wick/core y traduce sus errores de negocio a HTTP.
 * Las rutas de la API no contienen reglas propias: todo vive en @wick/core.
 */
export async function runCore<T>(fn: () => Promise<T>, event?: H3Event): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof WickError) {
      if (event && err instanceof RateLimitedError) setResponseHeader(event, 'Retry-After', err.retryAfterSeconds)
      throw createError({
        statusCode: STATUS[err.code],
        message: err.message,
        data: { code: err.code, details: err.details },
      })
    }
    throw err
  }
}

export function requireId(event: H3Event): string {
  return getRouterParam(event, 'id') ?? ''
}

/**
 * Cuerpo JSON de la petición, o {} si viene vacío o no es JSON.
 * El tipo es orientativo: @wick/core valida siempre los datos con zod.
 */
export async function readJson<T = Record<string, unknown>>(event: H3Event): Promise<T> {
  const body = await readBody(event).catch(() => null)
  return (body && typeof body === 'object' ? body : {}) as T
}
