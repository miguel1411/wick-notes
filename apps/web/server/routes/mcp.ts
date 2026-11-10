import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

/**
 * Servidor MCP (Streamable HTTP, sin estado) en /mcp.
 * Autenticación: `Authorization: Bearer wick_…` (token de Mi cuenta → Tokens de acceso).
 *
 *   claude mcp add --transport http wick http://servidor:3120/mcp \
 *     --header "Authorization: Bearer wick_…"
 */
export default defineEventHandler(async (event) => {
  const auth = event.context.auth
  if (auth?.via !== 'token') {
    setResponseHeader(event, 'WWW-Authenticate', 'Bearer realm="wick-notes"')
    throw createError({
      statusCode: 401,
      message: 'El servidor MCP necesita un token de API: Authorization: Bearer wick_… (créalo en Mi cuenta → Tokens de acceso)',
    })
  }

  // Sin estado: cada petición crea su servidor y transporte (no hay sesiones que guardar).
  const server = createWickMcpServer({
    user: auth.user,
    scope: auth.scope,
    tokenId: auth.tokenId,
    origin: getRequestURL(event, { xForwardedHost: trustProxy(), xForwardedProto: trustProxy() }).origin,
    version: '0.1.0',
  })
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  try {
    return await transport.handleRequest(toWebRequest(event))
  } finally {
    void server.close()
  }
})
