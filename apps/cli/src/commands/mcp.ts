import { VERSION } from '../api'
import type { Context } from '../main'

/**
 * `wick mcp`: puente stdio ↔ HTTP para clientes MCP que solo lanzan procesos
 * locales. Lee mensajes JSON-RPC (uno por línea) de stdin, los envía al
 * servidor MCP de la instancia (/mcp) con el token guardado y escribe las
 * respuestas en stdout. Toda la lógica de las herramientas vive en el servidor.
 *
 *   claude mcp add wick -- wick mcp
 */
export async function mcpBridge(ctx: Context) {
  const api = ctx.api()
  const { io } = ctx
  const token = api.authToken
  let protocolVersion: string | undefined

  for await (const line of io.stdinLines()) {
    if (!line.trim()) continue
    let message: { id?: unknown; method?: string }
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    try {
      const res = await fetch(`${api.server}/mcp`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'user-agent': `wick-cli/${VERSION} (mcp)`,
          ...(protocolVersion ? { 'mcp-protocol-version': protocolVersion } : {}),
        },
        body: line,
      })
      const body = await res.text()
      if (!body.trim()) continue // notificaciones: 202 sin cuerpo

      const payloads = res.headers.get('content-type')?.includes('text/event-stream')
        ? body
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
        : [body.trim()]
      for (const payload of payloads) {
        if (message.method === 'initialize') {
          try {
            protocolVersion = JSON.parse(payload)?.result?.protocolVersion ?? protocolVersion
          } catch {
            // ignorar
          }
        }
        io.stdout(payload + '\n')
      }
    } catch (err) {
      if (message.id === undefined) continue
      io.stdout(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32000, message: `No se pudo contactar con ${api.server}: ${(err as Error).message}` },
        }) + '\n',
      )
    }
  }
}
