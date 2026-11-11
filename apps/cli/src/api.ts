import { CliError } from './io'

declare const __WICK_VERSION__: string
export const VERSION = typeof __WICK_VERSION__ === 'string' ? __WICK_VERSION__ : '0.0.0-dev'

export interface Workspace {
  id: string
  name: string
  everyone: boolean
  role: 'owner' | 'editor' | 'viewer'
  documentCount: number
}

export interface NoteSummary {
  id: string
  title: string
  workspaceId?: string
  folderId?: string | null
  createdAt: string
  updatedAt: string
  createdBy: { id: string; name: string } | null
}

export interface SearchResult extends NoteSummary {
  snippet: string
  titleMatch: boolean
}

export interface Version {
  id: string
  createdAt: string
  title: string
  reason: 'auto' | 'manual' | 'before_replace' | 'before_restore'
  author: { id: string; name: string } | null
  preview: string
}

export interface Me {
  id: string
  username: string
  name: string
  role: 'ADMIN' | 'MEMBER'
}

export type PhotoNoteStage = 'reading' | 'context' | 'writing' | 'saving'

export class ApiError extends CliError {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** Nombre de fichero de una descarga (Content-Disposition), si lo hay. */
function attachmentName(res: Response): string | null {
  const disposition = res.headers.get('content-disposition') ?? ''
  const star = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  const plain = disposition.match(/filename="([^"]+)"/i)
  return star ? decodeURIComponent(star[1]!) : plain ? plain[1]! : null
}

/** Cliente mínimo de la API REST de wick notes, autenticado con un token. */
export class WickApi {
  constructor(
    readonly server: string,
    private readonly token: string,
  ) {}

  /** Para el puente MCP, que habla directamente con /mcp. */
  get authToken(): string {
    return this.token
  }

  /** `body` va como JSON; un FormData, tal cual (multipart). */
  private async send(method: Method, path: string, body?: unknown): Promise<Response> {
    let res: Response
    const form = body instanceof FormData
    try {
      res = await fetch(this.server + path, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          'user-agent': `wick-cli/${VERSION}`,
          ...(body === undefined || form ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
      })
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause?.code
      throw new CliError(`No se pudo conectar con ${this.server}${cause ? ` (${cause})` : ''}. ¿Es correcta la URL y está el servidor en marcha?`)
    }
    if (!res.ok) {
      let message = res.statusText
      try {
        const data = (await res.json()) as { message?: string; statusMessage?: string }
        message = data.message ?? data.statusMessage ?? message
      } catch {
        // respuesta sin JSON
      }
      if (res.status === 401) message = `${message}. Ejecuta \`wick login\` con un token válido.`
      throw new ApiError(message, res.status)
    }
    return res
  }

  private async json<T>(method: Method, path: string, body?: unknown): Promise<T> {
    return (await (await this.send(method, path, body)).json()) as T
  }

  /**
   * Nota desde foto: sube las fotos y sigue el progreso (eventos del servidor)
   * hasta que la nota está creada.
   */
  async photoNote(
    input: { images: { data: Uint8Array; name: string }[]; workspaceId?: string; research: boolean; instructions?: string },
    onStage: (stage: PhotoNoteStage, research: boolean) => void,
  ): Promise<{ document: NoteSummary; researched: boolean }> {
    const form = new FormData()
    for (const img of input.images) form.append('images', new Blob([img.data]), img.name)
    if (input.workspaceId) form.append('workspaceId', input.workspaceId)
    form.append('research', String(input.research))
    if (input.instructions) form.append('instructions', input.instructions)

    const res = await this.send('POST', '/api/documents/from-photo', form)
    const lost = new CliError('Se perdió la conexión con el servidor. Si la nota se llegó a crear, aparecerá en tu carpeta.')
    if (!res.body) throw lost
    const decoder = new TextDecoder()
    let buffer = ''
    const chunks = async function* (body: ReadableStream<Uint8Array>) {
      try {
        for await (const chunk of body) yield chunk
      } catch {
        throw lost
      }
    }
    for await (const chunk of chunks(res.body)) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true }).replace(/\r\n/g, '\n')
      for (let i = buffer.indexOf('\n\n'); i >= 0; i = buffer.indexOf('\n\n')) {
        const block = buffer.slice(0, i)
        buffer = buffer.slice(i + 2)
        let event = 'message'
        let data = ''
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) data += line.slice(5).replace(/^ /, '')
        }
        if (!data) continue
        const payload = JSON.parse(data)
        if (event === 'stage') onStage(payload.stage, payload.research)
        else if (event === 'done') return payload
        else if (event === 'error') throw new ApiError(payload.message ?? 'No se pudo crear la nota', payload.statusCode ?? 500)
      }
    }
    throw lost
  }

  async me(): Promise<Me> {
    const state = await this.json<{ user: Me | null }>('GET', '/api/auth/state')
    if (!state.user) throw new ApiError('Token no válido', 401)
    return state.user
  }

  list(query?: string, workspaceId?: string): Promise<NoteSummary[]> {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (workspaceId) params.set('workspace', workspaceId)
    const qs = params.size ? `?${params}` : ''
    return this.json('GET', `/api/documents${qs}`)
  }

  workspaces(): Promise<Workspace[]> {
    return this.json('GET', '/api/workspaces')
  }

  /** Árbol de espacios, carpetas y notas (todos o uno). */
  tree(workspaceId?: string): Promise<unknown[]> {
    const qs = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : ''
    return this.json('GET', `/api/workspaces/tree${qs}`)
  }

  search(query: string, limit = 20): Promise<SearchResult[]> {
    return this.json('GET', `/api/documents/search?q=${encodeURIComponent(query)}&limit=${limit}`)
  }

  get(id: string): Promise<NoteSummary> {
    return this.json('GET', `/api/documents/${encodeURIComponent(id)}`)
  }

  /**
   * Contenido en Markdown. Con `withTitle`, el fichero completo (`# Título` +
   * contenido) y su nombre. `revision` identifica lo leído (ver `writeMarkdown`).
   */
  async markdown(id: string, withTitle = false): Promise<{ text: string; filename: string | null; revision: string | null }> {
    const res = await this.send('GET', `/api/documents/${encodeURIComponent(id)}/markdown${withTitle ? '?download=1' : ''}`)
    return { text: await res.text(), filename: attachmentName(res), revision: res.headers.get('x-wick-revision') }
  }

  /** La nota en PDF (generado en el servidor) y su nombre de fichero. */
  async pdf(id: string): Promise<{ bytes: Uint8Array; filename: string | null }> {
    const res = await this.send('GET', `/api/documents/${encodeURIComponent(id)}/pdf?download=1`)
    return { bytes: new Uint8Array(await res.arrayBuffer()), filename: attachmentName(res) }
  }

  create(title: string, workspaceId?: string): Promise<NoteSummary> {
    return this.json('POST', '/api/documents', { title, workspaceId })
  }

  importMarkdown(input: { markdown: string; title?: string; filename?: string; workspaceId?: string }): Promise<NoteSummary> {
    return this.json('POST', '/api/documents/import', input)
  }

  /**
   * Con `baseRevision` (la de una lectura), el reemplazo se calcula sobre lo que
   * se leyó y conserva lo que otras personas escribieron después; `merged` indica
   * que había cambios ajenos. Si la revisión caducó, ApiError 409.
   */
  async writeMarkdown(id: string, markdown: string, mode: 'replace' | 'append', baseRevision?: string): Promise<{ merged: boolean }> {
    const res = await this.send('PUT', `/api/documents/${encodeURIComponent(id)}/markdown`, { markdown, mode, baseRevision })
    // Servidores anteriores responden 204 sin cuerpo.
    const data = res.status === 200 ? ((await res.json().catch(() => ({}))) as { merged?: boolean }) : {}
    return { merged: data.merged === true }
  }

  /** Cambios puntuales: cada `find` debe aparecer una sola vez (si no, ApiError 409 y no cambia nada). */
  async editMarkdown(id: string, edits: { find: string; replace: string }[]): Promise<void> {
    await this.send('PATCH', `/api/documents/${encodeURIComponent(id)}/markdown`, { edits })
  }

  rename(id: string, title: string): Promise<NoteSummary> {
    return this.json('PATCH', `/api/documents/${encodeURIComponent(id)}`, { title })
  }

  versions(id: string): Promise<Version[]> {
    return this.json('GET', `/api/documents/${encodeURIComponent(id)}/versions`)
  }

  async versionMarkdown(id: string, versionId: string): Promise<string> {
    return (await this.send('GET', `/api/documents/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/markdown`)).text()
  }

  async restoreVersion(id: string, versionId: string): Promise<void> {
    await this.send('POST', `/api/documents/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore`)
  }

  async delete(id: string): Promise<void> {
    await this.send('DELETE', `/api/documents/${encodeURIComponent(id)}`)
  }
}
