import type { AuthUser, TokenScope } from '@wick/core'

declare module 'h3' {
  interface H3EventContext {
    /**
     * Quién hace la petición; null si nadie. Lo rellena middleware/01.session.
     * - via 'session': navegador con cookie (acceso completo según su rol).
     * - via 'token': token de API (solo la API de notas, con su alcance).
     */
    auth?:
      | { via: 'session'; user: AuthUser; sessionId: string; scope: 'write' }
      | { via: 'token'; user: AuthUser; tokenId: string; scope: TokenScope }
      | null
  }
}

export {}
