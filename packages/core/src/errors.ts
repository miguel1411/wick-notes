export type WickErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  /** La petición es correcta, pero su contenido no se puede procesar (p. ej. una foto que no está escrita a mano). */
  | 'UNPROCESSABLE'
  /** Un servicio necesario no está disponible o no está configurado (p. ej. la IA). */
  | 'UNAVAILABLE'

/** Errores de negocio. Cada interfaz (API, CLI, MCP) los traduce a su propio formato. */
export class WickError extends Error {
  constructor(
    message: string,
    readonly code: WickErrorCode,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'WickError'
  }
}

export class NotFoundError extends WickError {
  constructor(what: string) {
    super(`${what} no encontrado`, 'NOT_FOUND')
  }
}

export class ValidationError extends WickError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION', details)
  }
}

/** Falta una sesión válida o las credenciales no son correctas. */
export class UnauthorizedError extends WickError {
  constructor(message = 'Necesitas iniciar sesión') {
    super(message, 'UNAUTHORIZED')
  }
}

/** Hay sesión, pero no permiso para esta operación. */
export class ForbiddenError extends WickError {
  constructor(message = 'No tienes permiso para hacer esto') {
    super(message, 'FORBIDDEN')
  }
}

export class ConflictError extends WickError {
  constructor(message: string) {
    super(message, 'CONFLICT')
  }
}

export class RateLimitedError extends WickError {
  constructor(readonly retryAfterSeconds: number) {
    super('Demasiados intentos. Espera unos minutos antes de volver a probar.', 'RATE_LIMITED', {
      retryAfterSeconds,
    })
  }
}

export class UnprocessableError extends WickError {
  constructor(message: string, details?: unknown) {
    super(message, 'UNPROCESSABLE', details)
  }
}

export class UnavailableError extends WickError {
  constructor(message: string, details?: unknown) {
    super(message, 'UNAVAILABLE', details)
  }
}
