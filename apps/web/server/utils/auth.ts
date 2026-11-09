import { SESSION_COOKIE, type AuthUser, type ClientInfo } from '@wick/core'
import type { H3Event } from 'h3'

/** ¿Hay que fiarse de las cabeceras X-Forwarded-* de un proxy inverso? (NUXT_TRUST_PROXY=true) */
export const trustProxy = () => useRuntimeConfig().trustProxy === true

export function setSessionCookie(event: H3Event, token: string, expiresAt: Date) {
  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // Solo Secure si la web se sirve por HTTPS: en una LAN por HTTP la cookie no funcionaría.
    secure: getRequestProtocol(event, { xForwardedProto: trustProxy() }) === 'https',
    expires: expiresAt,
  })
}

export function clearSessionCookie(event: H3Event) {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}

export function getSessionToken(event: H3Event): string | undefined {
  return getCookie(event, SESSION_COOKIE)
}

/** Usuario de la sesión actual, o error 401. */
export function requireUser(event: H3Event): AuthUser {
  const user = event.context.auth?.user
  if (!user) throw createError({ statusCode: 401, message: 'Necesitas iniciar sesión' })
  return user
}

export function getClientInfo(event: H3Event): ClientInfo {
  return {
    ip: getRequestIP(event, { xForwardedFor: trustProxy() }),
    userAgent: getRequestHeader(event, 'user-agent'),
  }
}
