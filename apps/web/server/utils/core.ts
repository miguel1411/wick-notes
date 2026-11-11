import { MAX_MARKDOWN_BYTES, RateLimitedError, ValidationError, WickError } from '@wick/core'
import type { H3Event } from 'h3'
import type { z } from 'zod'

const STATUS: Record<WickError['code'], number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UNPROCESSABLE: 422,
  UNAVAILABLE: 503,
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

/** Error como JSON para canales sin código HTTP propio (eventos de un stream). */
export function errorPayload(err: unknown): { statusCode: number; message: string; code?: string; details?: unknown } {
  if (err instanceof WickError) return { statusCode: STATUS[err.code], message: err.message, code: err.code, details: err.details }
  return { statusCode: 500, message: 'Ha ocurrido un error inesperado' }
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

/** Valida con un esquema de @wick/core (errores como ValidationError → 400). */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value)
  if (!result.success) throw new ValidationError(result.error.issues[0]?.message ?? 'Datos inválidos', result.error.issues)
  return result.data
}

/** Rechaza cuerpos más grandes que un Markdown máximo antes de leerlos. */
export function assertBodySize(event: H3Event) {
  const length = Number(getRequestHeader(event, 'content-length') ?? 0)
  if (length > MAX_MARKDOWN_BYTES + 64 * 1024) {
    throw createError({ statusCode: 413, message: 'El contenido supera el tamaño máximo (2 MB)' })
  }
}

/**
 * Nota en la que el usuario puede escribir (si no, 404 o 403). Para las rutas que
 * piden cambios al servidor de colaboración, que confía en que la web ya comprobó
 * los permisos.
 */
export async function requireWritableDocument(event: H3Event, id: string) {
  const { getDocument, ForbiddenError } = await import('@wick/core')
  const doc = await runCore(() => getDocument(requireUser(event), id), event)
  if (!doc.canEdit) await runCore(() => Promise.reject(new ForbiddenError('En este espacio solo tienes permiso de lectura')), event)
  return doc
}
