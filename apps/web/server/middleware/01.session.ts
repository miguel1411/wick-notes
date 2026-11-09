import { validateApiToken, validateSession } from '@wick/core'

/** Recursos estáticos: no necesitan sesión y así no consultan la base de datos. */
const STATIC = /^\/(_nuxt|__nuxt|_ipx|_fonts)\/|\.(js|css|map|svg|png|jpe?g|webp|ico|woff2?|ttf|txt)$/i

/**
 * Identifica a quien hace la petición y lo deja en event.context.auth:
 * primero un token de API (`Authorization: Bearer wick_…`), si no, la cookie de sesión.
 */
export default defineEventHandler(async (event) => {
  if (STATIC.test(event.path)) return
  event.context.auth = null

  const authorization = getRequestHeader(event, 'authorization')
  if (authorization) {
    const match = authorization.match(/^Bearer\s+(\S+)$/i)
    const valid = match ? await validateApiToken(match[1]) : null
    // Un token inválido es un error explícito: no se cae a la cookie.
    if (!valid) throw createError({ statusCode: 401, message: 'Token de API no válido, caducado o revocado' })
    event.context.auth = { via: 'token', user: valid.user, tokenId: valid.tokenId, scope: valid.scope }
    return
  }

  const token = getSessionToken(event)
  if (!token) return

  const session = await validateSession(token)
  if (!session) {
    clearSessionCookie(event)
    return
  }
  event.context.auth = { via: 'session', user: session.user, sessionId: session.sessionId, scope: 'write' }
  if (session.renewed) setSessionCookie(event, token, session.expiresAt)
})
