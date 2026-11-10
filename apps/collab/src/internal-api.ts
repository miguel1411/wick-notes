import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Hocuspocus } from '@hocuspocus/server'
import {
  appendUpdate,
  ContentEditError,
  createVersion,
  editUpdate,
  getVersionState,
  isValidServiceSecret,
  loadYjsState,
  MAX_MARKDOWN_BYTES,
  mergeUpdate,
  NotFoundError,
  protectBeforeChange,
  readMarkdown,
  renameDocument,
  replaceUpdate,
  restoreUpdate,
  REVISION_HEADER,
  SERVICE_HEADER,
  stateFromMarkdown,
  stateIncludes,
  toAuthUser,
  type AuthUser,
  type TextEdit,
} from '@wick/core'
import { getPrisma } from '@wick/db'
import * as Y from 'yjs'
import { RevisionStore } from './revisions'
import type { CollabContext } from './server'

/** Lecturas recientes, para fusionar las escrituras basadas en ellas. */
const revisions = new RevisionStore()

/**
 * API interna del servidor de colaboración, solo para la web (cabecera con el
 * secreto de servicio). Aquí viven las operaciones sobre el contenido porque este
 * proceso tiene los documentos abiertos: así una escritura desde la API, la CLI o
 * un agente se integra con lo que estén escribiendo las personas en ese momento.
 *
 * La web ya ha comprobado los permisos del usuario antes de llamar.
 *
 *   GET  /internal/documents/:id/markdown   → Markdown actual (text/markdown) y su
 *                                             revisión (cabecera x-wick-revision)
 *   POST /internal/documents/:id/markdown   { markdown, mode: 'replace'|'append', baseRevision?, actorId }
 *                                           { edits: [{ find, replace }], mode: 'edit', actorId }
 *                                           → { revision, merged }
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
      const id = docMatch[1]!
      const state = await currentStateOrEmpty(instance, id)
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', [REVISION_HEADER]: revisions.remember(id, state) })
      res.end(readMarkdown(state))
      return true
    }

    if (docMatch && req.method === 'POST') {
      const body = (await readJson(req)) as { markdown?: unknown; mode?: unknown; baseRevision?: unknown; edits?: unknown; actorId?: unknown }
      const actorId = typeof body.actorId === 'string' ? body.actorId : null
      if (body.mode === 'edit') {
        return send(res, 200, await editMarkdown(instance, docMatch[1]!, requireEdits(body.edits), actorId))
      }
      const markdown = requireMarkdown(body.markdown)
      const mode = body.mode === 'append' ? 'append' : body.mode === 'replace' ? 'replace' : null
      if (!mode) return send(res, 400, { message: 'mode debe ser "replace", "append" o "edit"' })
      if (body.baseRevision !== undefined && (typeof body.baseRevision !== 'string' || mode !== 'replace')) {
        return send(res, 400, { message: 'baseRevision solo vale con mode "replace"' })
      }
      const baseRevision = typeof body.baseRevision === 'string' ? body.baseRevision : undefined
      return send(res, 200, await writeMarkdown(instance, docMatch[1]!, markdown, mode, actorId, baseRevision))
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
      res.end(readMarkdown(state))
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
      const state = stateFromMarkdown(requireMarkdown(body.markdown))
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.end(Buffer.from(state))
      return true
    }

    return send(res, 404, { message: 'Ruta interna desconocida' })
  } catch (err) {
    if (err instanceof NotFoundError) return send(res, 404, { message: err.message })
    if (err instanceof ContentEditError) return send(res, 409, { message: err.message })
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
 * abierto y lo guarda al desconectar. Devuelve la revisión del resultado, para
 * poder escribir otra vez sin volver a leer.
 */
async function applyToLiveDocument(
  instance: Hocuspocus<CollabContext>,
  id: string,
  actor: AuthUser,
  compute: (state: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  const connection = await instance.openDirectConnection(id, { user: actor })
  try {
    const update = await compute(Y.encodeStateAsUpdate(connection.document!))
    await connection.transact((doc) => Y.applyUpdate(doc, update))
    return revisions.remember(id, Y.encodeStateAsUpdate(connection.document!))
  } finally {
    await connection.disconnect()
  }
}

/**
 * Con `baseRevision`, el reemplazo se calcula sobre lo que se leyó y se une con
 * lo escrito después por otras personas. `merged` indica que la nota había
 * cambiado desde esa lectura (el resultado puede no ser exactamente `markdown`).
 */
async function writeMarkdown(
  instance: Hocuspocus<CollabContext>,
  id: string,
  markdown: string,
  mode: 'replace' | 'append',
  actorId: string | null,
  baseRevision?: string,
): Promise<{ revision: string; merged: boolean }> {
  await requireDocument(id)
  const actor = await requireActor(actorId)
  let merged = false
  const revision = await applyToLiveDocument(instance, id, actor, async (state) => {
    if (mode === 'append') return appendUpdate(state, markdown)
    const base = baseRevision ? revisions.get(id, baseRevision) : null
    if (baseRevision && (!base || !stateIncludes(state, base))) {
      throw new BadRequest('La revisión ya no está disponible (caducó o se reinició el servidor). Vuelve a leer la nota y repite el cambio.', 409)
    }
    // Reemplazar puede borrar contenido: antes se guarda una versión.
    await protectBeforeChange(id, state, 'before_replace', actor.id)
    if (!base) return replaceUpdate(state, markdown)
    merged = readMarkdown(state) !== readMarkdown(base)
    return mergeUpdate(base, markdown, state)
  })
  return { revision, merged }
}

/** Cambios puntuales: cada fragmento debe aparecer una sola vez; si no, no se cambia nada. */
async function editMarkdown(
  instance: Hocuspocus<CollabContext>,
  id: string,
  edits: TextEdit[],
  actorId: string | null,
): Promise<{ revision: string; merged: boolean }> {
  await requireDocument(id)
  const actor = await requireActor(actorId)
  const revision = await applyToLiveDocument(instance, id, actor, async (state) => {
    const update = editUpdate(state, edits) // valida antes de guardar ninguna versión
    await protectBeforeChange(id, state, 'before_replace', actor.id)
    return update
  })
  return { revision, merged: false }
}

/** Restaura contenido y título de una versión; antes guarda la versión actual. */
async function restoreVersion(instance: Hocuspocus<CollabContext>, id: string, versionId: string, actor: AuthUser) {
  await requireDocument(id)
  const version = await getVersionState(id, versionId)
  await applyToLiveDocument(instance, id, actor, async (state) => {
    await protectBeforeChange(id, state, 'before_restore', actor.id)
    return restoreUpdate(state, version.state)
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

function requireEdits(value: unknown): TextEdit[] {
  if (!Array.isArray(value) || value.length === 0) throw new BadRequest('Falta la lista de cambios (edits)')
  if (value.length > 100) throw new BadRequest('Como mucho 100 cambios a la vez')
  let bytes = 0
  return value.map((e: { find?: unknown; replace?: unknown }) => {
    if (typeof e?.find !== 'string' || !e.find || typeof e.replace !== 'string') {
      throw new BadRequest('Cada cambio necesita find (no vacío) y replace')
    }
    bytes += Buffer.byteLength(e.find) + Buffer.byteLength(e.replace)
    if (bytes > MAX_MARKDOWN_BYTES) throw new BadRequest('Los cambios superan el tamaño máximo (2 MB)', 413)
    return { find: e.find, replace: e.replace }
  })
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
