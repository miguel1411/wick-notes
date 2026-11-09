import { validateSession } from '@wick/core'

/** Recursos estáticos: no necesitan sesión y así no consultan la base de datos. */
const STATIC = /^\/(_nuxt|__nuxt|_ipx|_fonts)\/|\.(js|css|map|svg|png|jpe?g|webp|ico|woff2?|ttf|txt)$/i

/** Lee la cookie de sesión y deja el usuario en event.context.auth. */
export default defineEventHandler(async (event) => {
  if (STATIC.test(event.path)) return
  event.context.auth = null

  const token = getSessionToken(event)
  if (!token) return

  const session = await validateSession(token)
  if (!session) {
    clearSessionCookie(event)
    return
  }
  event.context.auth = { user: session.user, sessionId: session.sessionId }
  if (session.renewed) setSessionCookie(event, token, session.expiresAt)
})
