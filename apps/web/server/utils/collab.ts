import { getServiceSecret, SERVICE_HEADER } from '@wick/core'
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

export async function collabFetch<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; responseType?: 'text' | 'arrayBuffer' } = {}): Promise<T> {
  try {
    // ofetch y no $fetch: $fetch tipa las rutas de esta app y esta llamada es a otro servicio.
    return await ofetch<T>(path, {
      baseURL: baseUrl(),
      method: init.method ?? 'GET',
      body: init.body as Record<string, unknown> | undefined,
      headers: { [SERVICE_HEADER]: getServiceSecret() },
      responseType: init.responseType as 'json' | undefined,
      timeout: 60_000,
    })
  } catch (err) {
    const e = err as { statusCode?: number; data?: { message?: string } }
    const status = e.statusCode
    if (status === 404 || status === 400 || status === 413) {
      throw createError({ statusCode: status, message: e.data?.message ?? 'Petición no válida' })
    }
    console.error('[web] fallo al llamar al servidor de colaboración', err)
    throw createError({ statusCode: 503, message: 'El servidor de colaboración no responde. Inténtalo de nuevo en unos segundos.' })
  }
}

export const getDocumentMarkdown = (id: string) =>
  collabFetch<string>(`/internal/documents/${encodeURIComponent(id)}/markdown`, { responseType: 'text' })

export const writeDocumentMarkdown = (id: string, actorId: string, markdown: string, mode: 'replace' | 'append') =>
  collabFetch<void>(`/internal/documents/${encodeURIComponent(id)}/markdown`, {
    method: 'POST',
    body: { markdown, mode, actorId },
  })

export const markdownToYjsState = async (markdown: string) =>
  new Uint8Array(await collabFetch<ArrayBuffer>('/internal/markdown/to-yjs', { method: 'POST', body: { markdown }, responseType: 'arrayBuffer' }))
