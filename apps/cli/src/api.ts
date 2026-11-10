import { CliError } from './io'

declare const __WICK_VERSION__: string
export const VERSION = typeof __WICK_VERSION__ === 'string' ? __WICK_VERSION__ : '0.0.0-dev'

export interface NoteSummary {
  id: string
  title: string
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

export class ApiError extends CliError {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

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

  private async send(method: Method, path: string, body?: unknown): Promise<Response> {
    let res: Response
    try {
      res = await fetch(this.server + path, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          'user-agent': `wick-cli/${VERSION}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
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

  async me(): Promise<Me> {
    const state = await this.json<{ user: Me | null }>('GET', '/api/auth/state')
    if (!state.user) throw new ApiError('Token no válido', 401)
    return state.user
  }

  list(query?: string): Promise<NoteSummary[]> {
    const qs = query ? `?q=${encodeURIComponent(query)}` : ''
    return this.json('GET', `/api/documents${qs}`)
  }

  search(query: string, limit = 20): Promise<SearchResult[]> {
    return this.json('GET', `/api/documents/search?q=${encodeURIComponent(query)}&limit=${limit}`)
  }

  get(id: string): Promise<NoteSummary> {
    return this.json('GET', `/api/documents/${encodeURIComponent(id)}`)
  }

  /** Contenido en Markdown. Con `withTitle`, el fichero completo (`# Título` + contenido) y su nombre. */
  async markdown(id: string, withTitle = false): Promise<{ text: string; filename: string | null }> {
    const res = await this.send('GET', `/api/documents/${encodeURIComponent(id)}/markdown${withTitle ? '?download=1' : ''}`)
    const disposition = res.headers.get('content-disposition') ?? ''
    const star = disposition.match(/filename\*=UTF-8''([^;]+)/i)
    const plain = disposition.match(/filename="([^"]+)"/i)
    const filename = star ? decodeURIComponent(star[1]!) : plain ? plain[1]! : null
    return { text: await res.text(), filename }
  }

  create(title: string): Promise<NoteSummary> {
    return this.json('POST', '/api/documents', { title })
  }

  importMarkdown(input: { markdown: string; title?: string; filename?: string }): Promise<NoteSummary> {
    return this.json('POST', '/api/documents/import', input)
  }

  async writeMarkdown(id: string, markdown: string, mode: 'replace' | 'append'): Promise<void> {
    await this.send('PUT', `/api/documents/${encodeURIComponent(id)}/markdown`, { markdown, mode })
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
