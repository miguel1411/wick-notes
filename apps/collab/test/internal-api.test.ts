import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import {
  createDocument,
  listVersions,
  renameDocument,
  createSession,
  getServiceSecret,
  hashPassword,
  loadYjsState,
  SERVICE_HEADER,
  SESSION_COOKIE,
  toAuthUser,
  type AuthUser,
} from '@wick/core'
import { disconnectPrisma, getPrisma } from '@wick/db'
import { getMarkdownConverter } from '@wick/markdown'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { createCollabServer } from '../src/server'

let server: ReturnType<typeof createCollabServer>
let user: AuthUser
let cookie: string
const auth = () => ({ [SERVICE_HEADER]: getServiceSecret() })

beforeAll(async () => {
  const prisma = getPrisma()
  await prisma.document.deleteMany()
  await prisma.session.deleteMany()
  await prisma.user.deleteMany()
  user = toAuthUser(
    await prisma.user.create({ data: { username: 'agente', name: 'Agente', passwordHash: await hashPassword('x'.repeat(12)) } }),
  )
  cookie = `${SESSION_COOKIE}=${(await createSession(user)).token}`
  server = createCollabServer({ port: 0, address: '127.0.0.1', debounce: 100, maxDebounce: 500 })
  await server.listen()
})

afterAll(async () => {
  await server.destroy()
  await getMarkdownConverter().close()
  await disconnectPrisma()
})

const url = (path: string) => `${server.httpURL}${path}`

async function newDoc(markdown: string) {
  const doc = await createDocument(user, { title: 'Prueba' })
  const res = await fetch(url('/internal/markdown/to-yjs'), {
    method: 'POST',
    headers: { ...auth(), 'content-type': 'application/json' },
    body: JSON.stringify({ markdown }),
  })
  expect(res.status).toBe(200)
  const state = new Uint8Array(await res.arrayBuffer())
  await getPrisma().document.update({ where: { id: doc.id }, data: { yjsState: state } })
  return doc.id
}

/** Un "navegador" conectado al documento. */
async function openClient(id: string) {
  const ydoc = new Y.Doc()
  const socket = new HocuspocusProviderWebsocket({
    url: server.webSocketURL,
    WebSocketPolyfill: class extends WebSocket {
      constructor(u: string, p?: string | string[]) {
        super(u, p, { headers: { cookie } })
      }
    },
  })
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: id, document: ydoc })
  provider.attach()
  await new Promise<void>((resolve) => provider.on('synced', () => resolve()))
  return { ydoc, close: () => (provider.destroy(), socket.destroy()) }
}

const markdownOf = async (ydoc: Y.Doc) => getMarkdownConverter().toMarkdown(Y.encodeStateAsUpdate(ydoc))

async function waitFor(check: () => Promise<boolean> | boolean, what: string) {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > 5000) throw new Error(`timeout esperando: ${what}`)
    await new Promise((r) => setTimeout(r, 30))
  }
}

describe('API interna del servidor de colaboración', () => {
  it('rechaza peticiones sin el secreto de servicio', async () => {
    const res = await fetch(url('/internal/markdown/to-yjs'), { method: 'POST', body: '{"markdown":"x"}' })
    expect(res.status).toBe(401)
    const wrong = await fetch(url('/internal/markdown/to-yjs'), { method: 'POST', headers: { [SERVICE_HEADER]: 'x' }, body: '{}' })
    expect(wrong.status).toBe(401)
  })

  it('las rutas no internas siguen respondiendo como siempre', async () => {
    const res = await fetch(url('/'))
    expect(res.status).toBe(200)
  })

  it('devuelve el Markdown de una nota guardada', async () => {
    const id = await newDoc('# Hola\n\nmundo')
    const res = await fetch(url(`/internal/documents/${id}/markdown`), { headers: auth() })
    expect(res.headers.get('content-type')).toContain('text/markdown')
    expect(await res.text()).toBe('# Hola\n\nmundo\n')
  })

  it('devuelve lo último escrito aunque todavía no se haya guardado', async () => {
    const id = await newDoc('Inicio')
    const client = await openClient(id)
    // Escribe directamente en el documento del navegador.
    const p = client.ydoc.getXmlFragment('prosemirror').get(0) as Y.XmlElement
    ;(p.get(0) as Y.XmlText).insert(6, ' y algo más')
    await waitFor(async () => {
      const res = await fetch(url(`/internal/documents/${id}/markdown`), { headers: auth() })
      return (await res.text()) === 'Inicio y algo más\n'
    }, 'contenido en vivo')
    client.close()
  })

  it('añade y reemplaza en vivo: el navegador lo ve y queda guardado', async () => {
    const id = await newDoc('# Diario')
    const client = await openClient(id)

    const post = (body: object) =>
      fetch(url(`/internal/documents/${id}/markdown`), {
        method: 'POST',
        headers: { ...auth(), 'content-type': 'application/json' },
        body: JSON.stringify({ actorId: user.id, ...body }),
      })

    expect((await post({ mode: 'append', markdown: 'Entrada del agente.' })).status).toBe(204)
    await waitFor(async () => (await markdownOf(client.ydoc)) === '# Diario\n\nEntrada del agente.\n', 'append en el navegador')

    // Guardado al momento (sin esperar al debounce).
    expect(await getMarkdownConverter().toMarkdown(await loadYjsState(id))).toBe('# Diario\n\nEntrada del agente.\n')

    expect((await post({ mode: 'replace', markdown: '# Diario\n\nReescrito.' })).status).toBe(204)
    await waitFor(async () => (await markdownOf(client.ydoc)) === '# Diario\n\nReescrito.\n', 'replace en el navegador')
    client.close()
  })

  it('historial: protege antes de reemplazar, guarda a mano y restaura en vivo', async () => {
    const id = await newDoc('# Plan\n\nVersión buena.')
    const client = await openClient(id)
    const json = (path: string, body: object) =>
      fetch(url(path), { method: 'POST', headers: { ...auth(), 'content-type': 'application/json' }, body: JSON.stringify(body) })

    // Un agente reemplaza todo → antes se guarda la versión buena.
    await json(`/internal/documents/${id}/markdown`, { mode: 'replace', markdown: 'Contenido estropeado', actorId: user.id })
    await renameDocument(user, id, { title: 'Título cambiado' })
    let versions = await listVersions(user, id)
    expect(versions.map((v) => v.reason)).toEqual(['before_replace'])
    expect(versions[0]!.preview).toBe('Plan Versión buena.')
    expect(versions[0]!.title).toBe('Prueba')

    // Markdown de la versión.
    const res = await fetch(url(`/internal/documents/${id}/versions/${versions[0]!.id}/markdown`), { headers: auth() })
    expect(await res.text()).toBe('# Plan\n\nVersión buena.\n')

    // Guardar a mano el estado actual.
    const manual = await json(`/internal/documents/${id}/versions`, { actorId: user.id })
    expect(manual.status).toBe(201)
    expect(((await manual.json()) as { reason: string }).reason).toBe('manual')

    // Restaurar: el navegador lo ve en vivo, vuelve el título y no se pierde nada.
    expect((await json(`/internal/documents/${id}/versions/${versions[0]!.id}/restore`, { actorId: user.id })).status).toBe(204)
    await waitFor(async () => (await markdownOf(client.ydoc)) === '# Plan\n\nVersión buena.\n', 'restauración en el navegador')
    expect((await getPrisma().document.findUniqueOrThrow({ where: { id } })).title).toBe('Prueba')
    versions = await listVersions(user, id)
    expect(versions.map((v) => v.reason)).toEqual(['manual', 'before_replace'])
    // (no hay before_restore: el estado actual ya estaba guardado en la versión manual)

    expect((await json(`/internal/documents/${id}/versions/no-existe/restore`, { actorId: user.id })).status).toBe(404)
    client.close()
  })

  it('valida las escrituras', async () => {
    const id = await newDoc('x')
    const post = (body: object, docId = id) =>
      fetch(url(`/internal/documents/${docId}/markdown`), {
        method: 'POST',
        headers: { ...auth(), 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect((await post({ mode: 'otro', markdown: 'x', actorId: user.id })).status).toBe(400)
    expect((await post({ mode: 'append', actorId: user.id })).status).toBe(400)
    expect((await post({ mode: 'append', markdown: 'x', actorId: 'nadie' })).status).toBe(400)
    expect((await post({ mode: 'append', markdown: 'x', actorId: user.id }, 'no-existe')).status).toBe(404)
    expect((await post({ mode: 'append', markdown: 'x'.repeat(2 * 1024 * 1024 + 1), actorId: user.id })).status).toBe(413)
  })
})
