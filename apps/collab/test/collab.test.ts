import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import {
  createDocument,
  createSession,
  deleteDocument,
  hashPassword,
  loadYjsState,
  SESSION_COOKIE,
  toAuthUser,
  type AuthUser,
} from '@wick/core'
import { disconnectPrisma, getPrisma } from '@wick/db'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { createCollabServer } from '../src/server'

let user: AuthUser
let cookie: string

/** WebSocket de Node que envía la cookie de sesión, como haría el navegador. */
function socketWithCookie(cookieHeader: string | null) {
  return class extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, cookieHeader ? { headers: { cookie: cookieHeader } } : {})
    }
  }
}

beforeAll(async () => {
  const prisma = getPrisma()
  await prisma.document.deleteMany()
  await prisma.session.deleteMany()
  await prisma.user.deleteMany()
  const created = await prisma.user.create({
    data: { username: 'collab', name: 'Colaboradora', passwordHash: await hashPassword('x'.repeat(12)) },
  })
  user = toAuthUser(created)
  const session = await createSession(user)
  cookie = `otra=1; ${SESSION_COOKIE}=${session.token}`
})

type CollabServer = ReturnType<typeof createCollabServer>

let server: CollabServer
let docId: string
const providers: HocuspocusProvider[] = []
const sockets: HocuspocusProviderWebsocket[] = []

async function startServer() {
  // Puerto 0 = puerto libre aleatorio. Debounce corto para que los tests sean rápidos.
  server = createCollabServer({ port: 0, address: '127.0.0.1', debounce: 100, maxDebounce: 500 })
  await server.listen()
}

/** Conecta un cliente y espera a la primera sincronización con el servidor. */
function connect(
  name: string,
  cookieHeader: string | null = cookie,
): Promise<{ provider: HocuspocusProvider; socket: HocuspocusProviderWebsocket; doc: Y.Doc }> {
  const doc = new Y.Doc()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout esperando sincronización')), 5000)
    const websocketProvider = new HocuspocusProviderWebsocket({
      url: server.webSocketURL,
      WebSocketPolyfill: socketWithCookie(cookieHeader),
    })
    sockets.push(websocketProvider)
    const provider = new HocuspocusProvider({
      websocketProvider,
      name,
      document: doc,
      onSynced: () => {
        clearTimeout(timer)
        resolve({ provider, socket: websocketProvider, doc })
      },
      onAuthenticationFailed: ({ reason }) => {
        clearTimeout(timer)
        provider.destroy()
        reject(new Error(`rechazado: ${reason}`))
      },
    })
    // Con un WebSocket propio, el provider no se engancha solo.
    provider.attach()
    providers.push(provider)
  })
}

async function waitFor(check: () => boolean, what: string, timeout = 5000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error(`timeout esperando: ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

const text = (doc: Y.Doc) => doc.getText('body').toString()

beforeEach(async () => {
  docId = (await createDocument(user, { title: 'Prueba de colaboración' })).id
  await startServer()
})

afterEach(async () => {
  for (const p of providers.splice(0)) p.destroy()
  for (const s of sockets.splice(0)) s.destroy()
  await server.destroy()
  await deleteDocument(user, docId).catch(() => {})
})

afterAll(async () => {
  await disconnectPrisma()
})

describe('servidor de colaboración', () => {
  it('dos clientes que editan a la vez convergen al mismo contenido', async () => {
    const a = await connect(docId)
    const b = await connect(docId)

    // Ediciones simultáneas en la misma posición, sin esperar entre ellas.
    a.doc.getText('body').insert(0, 'AAA')
    b.doc.getText('body').insert(0, 'BBB')

    await waitFor(() => text(a.doc).length === 6 && text(a.doc) === text(b.doc), 'convergencia')
    expect(text(a.doc)).toContain('AAA')
    expect(text(a.doc)).toContain('BBB')
  })

  it('el contenido se guarda y sobrevive a un reinicio del servidor', async () => {
    const a = await connect(docId)
    a.doc.getText('body').insert(0, 'contenido persistente ñ 🚀')
    await waitFor(() => a.provider.unsyncedChanges === 0, 'cambios enviados')

    // destroy() guarda los documentos pendientes antes de cerrar.
    await server.destroy()
    for (const p of providers.splice(0)) p.destroy()
    for (const s of sockets.splice(0)) s.destroy()

    const stored = await loadYjsState(docId)
    expect(stored).not.toBeNull()
    const fromDb = new Y.Doc()
    Y.applyUpdate(fromDb, stored!)
    expect(text(fromDb)).toBe('contenido persistente ñ 🚀')

    await startServer()
    const c = await connect(docId)
    expect(text(c.doc)).toBe('contenido persistente ñ 🚀')
  })

  it('las ediciones hechas sin conexión se integran al reconectar', async () => {
    const a = await connect(docId)
    const b = await connect(docId)
    a.doc.getText('body').insert(0, 'base')
    await waitFor(() => text(b.doc) === 'base', 'sincronización inicial')

    a.socket.disconnect()
    a.doc.getText('body').insert(4, ' offline-A')
    b.doc.getText('body').insert(0, 'online-B ')
    await new Promise((r) => setTimeout(r, 200))
    expect(text(b.doc)).not.toContain('offline-A')

    await a.socket.connect()
    await waitFor(() => text(a.doc) === text(b.doc) && text(b.doc).includes('offline-A'), 'reconexión')
    expect(text(b.doc)).toBe('online-B base offline-A')
  })

  it('rechaza conexiones a documentos que no existen', async () => {
    await expect(connect('no-existe')).rejects.toThrow()
  })

  it('rechaza conexiones sin sesión o con una sesión inválida', async () => {
    await expect(connect(docId, null)).rejects.toThrow()
    await expect(connect(docId, `${SESSION_COOKIE}=${'x'.repeat(43)}`)).rejects.toThrow()
  })

  it('rechaza la sesión de una cuenta desactivada', async () => {
    await getPrisma().user.update({ where: { id: user.id }, data: { disabledAt: new Date() } })
    try {
      await expect(connect(docId)).rejects.toThrow()
    } finally {
      await getPrisma().user.update({ where: { id: user.id }, data: { disabledAt: null } })
    }
  })
})
