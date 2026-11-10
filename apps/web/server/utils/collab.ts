import { getServiceSecret, REVISION_HEADER, SERVICE_HEADER, type TextEdit } from '@wick/core'
import { ofetch } from 'ofetch'

/**
 * Llamadas de la web al servidor de colaboración (su API interna). Allí viven las
 * operaciones sobre el contenido, porque es quien tiene los documentos abiertos.
 */
function baseUrl(): string {
  const configured = useRuntimeConfig().collabInternalUrl
  if (configured) return configured
  // Desarrollo: el mismo host en el que escucha `pnpm dev` (ver DEV_HOST).
  return `http://${process.env.DEV_HOST || '127.0.0.1'}:${process.env.COLLAB_PORT || '3121'}`
}

type CollabInit = { method?: 'GET' | 'POST'; body?: unknown; responseType?: 'text' | 'arrayBuffer' }

/** Opciones comunes: dirección, secreto de servicio y tiempo máximo. */
function collabOptions(init: CollabInit) {
  return {
    baseURL: baseUrl(),
    method: init.method ?? 'GET',
    body: init.body as Record<string, unknown> | undefined,
    headers: { [SERVICE_HEADER]: getServiceSecret() },
    timeout: 60_000,
  }
}

export async function collabFetch<T>(path: string, init: CollabInit = {}): Promise<T> {
  try {
    // ofetch y no $fetch: $fetch tipa las rutas de esta app y esta llamada es a otro servicio.
    return await ofetch<T>(path, { ...collabOptions(init), responseType: init.responseType as 'json' | undefined })
  } catch (err) {
    throw collabError(err)
  }
}

/** Errores del servidor de colaboración: los de la petición se reenvían tal cual; el resto, 503. */
function collabError(err: unknown) {
  const e = err as { statusCode?: number; data?: { message?: string } }
  const status = e.statusCode
  // 409: la revisión caducó o un fragmento a cambiar no está en la nota.
  if (status === 404 || status === 400 || status === 409 || status === 413) {
    return createError({ statusCode: status, message: e.data?.message ?? 'Petición no válida' })
  }
  console.error('[web] fallo al llamar al servidor de colaboración', err)
  return createError({ statusCode: 503, message: 'El servidor de colaboración no responde. Inténtalo de nuevo en unos segundos.' })
}

/** Resultado de una escritura: la revisión nueva y si se unió con cambios de otras personas. */
export interface WriteResult {
  revision: string
  merged: boolean
}

/**
 * Markdown actual y su revisión. Quien vaya a reescribir la nota devuelve esa
 * revisión al escribir, para no borrar lo que otros escriban mientras tanto.
 */
export async function getDocumentContent(id: string): Promise<{ markdown: string; revision: string }> {
  try {
    const res = await ofetch.raw(`/internal/documents/${encodeURIComponent(id)}/markdown`, { ...collabOptions({}), responseType: 'text' as const })
    return { markdown: String(res._data ?? ''), revision: res.headers.get(REVISION_HEADER) ?? '' }
  } catch (err) {
    throw collabError(err)
  }
}

export const getDocumentMarkdown = async (id: string) => (await getDocumentContent(id)).markdown

/**
 * `replace` deja la nota con exactamente ese contenido; con `baseRevision`, lo
 * calcula sobre lo que se leyó en esa revisión y conserva lo escrito después por
 * otras personas. `append` lo añade al final.
 */
export const writeDocumentMarkdown = (id: string, actorId: string, markdown: string, mode: 'replace' | 'append', baseRevision?: string) =>
  collabFetch<WriteResult>(`/internal/documents/${encodeURIComponent(id)}/markdown`, {
    method: 'POST',
    body: { markdown, mode, actorId, baseRevision },
  })

/** Cambios puntuales: cada `find` debe aparecer una sola vez en la nota (si no, 409 y no cambia nada). */
export const editDocumentMarkdown = (id: string, actorId: string, edits: TextEdit[]) =>
  collabFetch<WriteResult>(`/internal/documents/${encodeURIComponent(id)}/markdown`, {
    method: 'POST',
    body: { mode: 'edit', edits, actorId },
  })

export const markdownToYjsState = async (markdown: string) =>
  new Uint8Array(await collabFetch<ArrayBuffer>('/internal/markdown/to-yjs', { method: 'POST', body: { markdown }, responseType: 'arrayBuffer' }))

export const saveDocumentVersion = (id: string, actorId: string) =>
  collabFetch<unknown>(`/internal/documents/${encodeURIComponent(id)}/versions`, { method: 'POST', body: { actorId } })

export const getVersionMarkdown = (id: string, versionId: string) =>
  collabFetch<string>(`/internal/documents/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/markdown`, {
    responseType: 'text',
  })

export const restoreDocumentVersion = (id: string, versionId: string, actorId: string) =>
  collabFetch<void>(`/internal/documents/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore`, {
    method: 'POST',
    body: { actorId },
  })
