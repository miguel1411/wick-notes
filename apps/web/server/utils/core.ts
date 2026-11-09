import { WickError } from '@wick/core'
import type { H3Event } from 'h3'

/**
 * Ejecuta una operación de @wick/core y traduce sus errores de negocio a HTTP.
 * Las rutas de la API no contienen reglas propias: todo vive en @wick/core.
 */
export async function runCore<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof WickError) {
      throw createError({
        statusCode: err.code === 'NOT_FOUND' ? 404 : 400,
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
