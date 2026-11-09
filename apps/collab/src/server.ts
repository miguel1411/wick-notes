import { Database } from '@hocuspocus/extension-database'
import { Server } from '@hocuspocus/server'
import {
  canAccessDocument,
  loadYjsState,
  NotFoundError,
  readSessionCookie,
  saveYjsState,
  UnauthorizedError,
  validateSession,
  type AuthUser,
} from '@wick/core'
import { handleInternalRequest } from './internal-api'

export interface CollabServerOptions {
  port: number
  address?: string
  /** Milisegundos de inactividad antes de guardar (por defecto 2 s). */
  debounce?: number
  /** Guardar como máximo cada N ms aunque se siga escribiendo (por defecto 10 s). */
  maxDebounce?: number
  quiet?: boolean
}

/** Contexto de cada conexión: quién está conectado. */
export interface CollabContext {
  user: AuthUser
}

/**
 * Servidor de colaboración en tiempo real.
 *
 * El nombre del documento Yjs es el id del documento en la base de datos.
 * Cada conexión se autentica con la misma cookie de sesión que la web (el navegador
 * la envía al abrir el WebSocket en el mismo host) y se autoriza con @wick/core.
 */
export function createCollabServer(options: CollabServerOptions) {
  return new Server<CollabContext>({
    port: options.port,
    address: options.address,
    quiet: options.quiet ?? true,
    // El cierre ordenado lo gestiona quien arranca el servidor (ver index.ts).
    stopOnSignals: false,
    debounce: options.debounce ?? 2000,
    maxDebounce: options.maxDebounce ?? 10000,

    // API HTTP interna (ver internal-api.ts). Lanzar null corta la respuesta por defecto.
    async onRequest({ request, response, instance }) {
      if (await handleInternalRequest(request, response, instance)) throw null
    },

    async onConnect({ documentName, requestHeaders, context }) {
      const session = await validateSession(readSessionCookie(requestHeaders.get('cookie')))
      if (!session) throw new UnauthorizedError()
      if (!(await canAccessDocument(session.user, documentName))) throw new NotFoundError('Documento')
      context.user = session.user
    },

    extensions: [
      new Database({
        fetch: ({ documentName }) => loadYjsState(documentName),
        store: async ({ documentName, state }) => {
          try {
            await saveYjsState(documentName, state)
          } catch (err) {
            // El documento se borró mientras alguien lo tenía abierto: no hay dónde guardar.
            if (err instanceof NotFoundError) {
              console.warn(`[collab] documento ${documentName} borrado; se descarta su estado`)
              return
            }
            throw err
          }
        },
      }),
    ],
  })
}
