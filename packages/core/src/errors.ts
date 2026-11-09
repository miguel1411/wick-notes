/** Errores de negocio. Cada interfaz (API, CLI, MCP) los traduce a su propio formato. */
export class WickError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'VALIDATION',
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
