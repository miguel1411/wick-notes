import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Hocuspocus } from '@hocuspocus/server'
import {
  createVersion,
  getVersionState,
  isValidServiceSecret,
  loadYjsState,
  NotFoundError,
  protectBeforeChange,
  renameDocument,
  SERVICE_HEADER,
  toAuthUser,
  type AuthUser,
} from '@wick/core'
import { getPrisma } from '@wick/db'
import { getMarkdownConverter, MAX_MARKDOWN_BYTES } from '@wick/markdown'
import * as Y from 'yjs'
import type { CollabContext } from './server'

/**
 * API interna del servidor de colaboración, solo para la web (cabecera con el
 * secreto de servicio). Aquí viven las operaciones sobre el contenido porque este
 * proceso tiene los documentos abiertos: así una escritura desde la API, la CLI o
 * un agente se integra con lo que estén escribiendo las personas en ese momento.
 *
 * La web ya ha comprobado los permisos del usuario antes de llamar.
 *
 *   GET  /internal/documents/:id/markdown   → Markdown actual (text/markdown)
 *   POST /internal/documents/:id/markdown   { markdown, mode: 'replace'|'append', actorId }
 *   POST /internal/markdown/to-yjs          { markdown } → estado Yjs (octet-stream)
 *   POST /internal/documents/:id/versions   { actorId } → guarda una versión del estado actual
 *   GET  /internal/documents/:id/versions/:vid/markdown → Markdown de esa versión
 *   POST /internal/documents/:id/versions/:vid/restore  { actorId } → la restaura (en vivo)
 */
export async function handleInternalRequest(
  req: IncomingMessage,
  res: ServerResponse,
  instance: Hocuspocus<CollabContext>,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal')
  if (!url.pathname.startsWith('/internal/')) return false

  try {
    if (!isValidServiceSecret(headerValue(req, SERVICE_HEADER))) {
      return send(res, 401, { message: 'No autorizado' })
    }

    const docMatch = url.pathname.match(/^\/internal\/documents\/([^/]+)\/markdown$/)
    if (docMatch && req.method === 'GET') {
      const markdown = await getMarkdownConverter().toMarkdown(await currentState(instance, docMatch[1]!))
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' })
      res.end(markdown)
      return true
    }

    if (docMatch && req.method === 'POST') {
      const body = (await readJson(req)) as { markdown?: unknown; mode?: unknown; actorId?: unknown }
      const markdown = requireMarkdown(body.markdown)
      const mode = body.mode === 'append' ? 'append' : body.mode === 'replace' ? 'replace' : null
      if (!mode) return send(res, 400, { message: 'mode debe ser "replace" o "append"' })
      await writeMarkdown(instance, docMatch[1]!, markdown, mode, typeof body.actorId === 'string' ? body.actorId : null)
      res.writeHead(204)
      res.end()
      return true
    }

    const versionsMatch = url.pathname.match(/^\/internal\/documents\/([^/]+)\/versions$/)
    if (versionsMatch && req.method === 'POST') {
      const body = (await readJson(req)) as { actorId?: unknown }
      const actor = await requireActor(body.actorId)
      const id = versionsMatch[1]!
      await requireDocument(id)
      const version = await createVersion(id, await currentStateOrEmpty(instance, id), { reason: 'manual', authorId: actor.id })
      return send(res, 201, version)
    }

    const versionMatch = url.pathname.match(/^\/internal\/documents\/([^/]+)\/versions\/([^/]+)\/(markdown|restore)$/)
    if (versionMatch && versionMatch[3] === 'markdown' && req.method === 'GET') {
      const { state } = await getVersionState(versionMatch[1]!, versionMatch[2]!)
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' })
      res.end(await getMarkdownConverter().toMarkdown(state))
      return true
    }
    if (versionMatch && versionMatch[3] === 'restore' && req.method === 'POST') {
      const body = (await readJson(req)) as { actorId?: unknown }
      const actor = await requireActor(body.actorId)
      await restoreVersion(instance, versionMatch[1]!, versionMatch[2]!, actor)
      res.writeHead(204)
      res.end()
      return true
    }

    if (url.pathname === '/internal/markdown/to-yjs' && req.method === 'POST') {
      const body = (await readJson(req)) as { markdown?: unknown }
      const state = await getMarkdownConverter().fromMarkdown(requireMarkdown(body.markdown))
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.end(Buffer.from(state))
      return true
    }

    return send(res, 404, { message: 'Ruta interna desconocida' })
  } catch (err) {
    if (err instanceof NotFoundError) return send(res, 404, { message: err.message })
    if (err instanceof BadRequest) return send(res, err.status, { message: err.message })
    console.error('[collab] error en la API interna', err)
    return send(res, 500, { message: 'Error interno' })
  }
}

/** Estado más reciente: el documento abierto en memoria si lo está, si no, el guardado. */
async function currentState(instance: Hocuspocus<CollabContext>, id: string): Promise<Uint8Array | null> {
  const live = instance.documents.get(id)
  if (live && !live.isLoading) return Y.encodeStateAsUpdate(live)
  return loadYjsState(id)
}

async function requireDocument(id: string) {
  if ((await getPrisma().document.count({ where: { id } })) === 0) throw new NotFoundError('Documento')
}

async function requireActor(actorId: unknown): Promise<AuthUser> {
  const actor = typeof actorId === 'string' ? await getPrisma().user.findUnique({ where: { id: actorId } }) : null
  if (!actor) throw new BadRequest('actorId no corresponde a ningún usuario', 400)
  return toAuthUser(actor)
}

async function currentStateOrEmpty(instance: Hocuspocus<CollabContext>, id: string): Promise<Uint8Array> {
  return (await currentState(instance, id)) ?? Y.encodeStateAsUpdate(new Y.Doc())
}

/**
 * Aplica un cambio Yjs calculado sobre el documento vivo. La conexión directa
 * carga el documento (o usa el abierto), difunde el cambio a quien lo tenga
 * abierto y lo guarda al desconectar.
 */
async function applyToLiveDocument(
  instance: Hocuspocus<CollabContext>,
  id: string,
  actor: AuthUser,
  compute: (state: Uint8Array) => Promise<Uint8Array>,
) {
  const connection = await instance.openDirectConnection(id, { user: actor })
  try {
    const update = await compute(Y.encodeStateAsUpdate(connection.document!))
    await connection.transact((doc) => Y.applyUpdate(doc, update))
  } finally {
    await connection.disconnect()
  }
}

async function writeMarkdown(
  instance: Hocuspocus<CollabContext>,
  id: string,
  markdown: string,
  mode: 'replace' | 'append',
  actorId: string | null,
) {
  await requireDocument(id)
  const actor = await requireActor(actorId)
  const converter = getMarkdownConverter()
  await applyToLiveDocument(instance, id, actor, async (state) => {
    if (mode === 'append') return converter.appendUpdate(state, markdown)
    // Reemplazar puede borrar contenido: antes se guarda una versión.
    await protectBeforeChange(id, state, 'before_replace', actor.id)
    return converter.replaceUpdate(state, markdown)
  })
}

/** Restaura contenido y título de una versión; antes guarda la versión actual. */
async function restoreVersion(instance: Hocuspocus<CollabContext>, id: string, versionId: string, actor: AuthUser) {
  await requireDocument(id)
  const version = await getVersionState(id, versionId)
  await applyToLiveDocument(instance, id, actor, async (state) => {
    await protectBeforeChange(id, state, 'before_restore', actor.id)
    return getMarkdownConverter().restoreUpdate(state, version.state)
  })
  const current = await getPrisma().document.findUnique({ where: { id }, select: { title: true } })
  if (current && current.title !== version.title) await renameDocument(actor, id, { title: version.title })
}

class BadRequest extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

function requireMarkdown(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequest('Falta el campo markdown')
  if (Buffer.byteLength(value) > MAX_MARKDOWN_BYTES) throw new BadRequest('El Markdown supera el tamaño máximo (2 MB)', 413)
  return value
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name]
  return Array.isArray(v) ? v[0] : v
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_MARKDOWN_BYTES + 64 * 1024) throw new BadRequest('Petición demasiado grande', 413)
    chunks.push(chunk as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw new BadRequest('JSON inválido')
  }
}

function send(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
  return true
}
