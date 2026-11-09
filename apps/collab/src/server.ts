import { Database } from '@hocuspocus/extension-database'
import { Server } from '@hocuspocus/server'
import { documentExists, loadYjsState, NotFoundError, saveYjsState } from '@wick/core'

export interface CollabServerOptions {
  port: number
  address?: string
  /** Milisegundos de inactividad antes de guardar (por defecto 2 s). */
  debounce?: number
  /** Guardar como máximo cada N ms aunque se siga escribiendo (por defecto 10 s). */
  maxDebounce?: number
  quiet?: boolean
}

/**
 * Servidor de colaboración en tiempo real.
 *
 * El nombre del documento Yjs es el id del documento en la base de datos.
 * El estado Yjs se carga y se guarda a través de @wick/core, igual que hará
 * cualquier otra interfaz (API, CLI, MCP).
 */
export function createCollabServer(options: CollabServerOptions) {
  return new Server({
    port: options.port,
    address: options.address,
    quiet: options.quiet ?? true,
    // El cierre ordenado lo gestiona quien arranca el servidor (ver index.ts).
    stopOnSignals: false,
    debounce: options.debounce ?? 2000,
    maxDebounce: options.maxDebounce ?? 10000,

    // Solo se puede colaborar sobre documentos que existen.
    // (La autenticación por usuario llegará en el siguiente paso.)
    async onConnect({ documentName }) {
      if (!(await documentExists(documentName))) {
        throw new NotFoundError('Documento')
      }
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
