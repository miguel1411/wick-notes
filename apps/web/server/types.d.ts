import type { AuthUser } from '@wick/core'

declare module 'h3' {
  interface H3EventContext {
    /** Sesión de la petición; null si no hay o no es válida. Lo rellena middleware/01.session. */
    auth?: { user: AuthUser; sessionId: string } | null
  }
}

export {}
