/** Rutas de la API accesibles sin sesión. Todo lo demás exige haber iniciado sesión. */
const PUBLIC_API = new Set(['/api/health', '/api/auth/state', '/api/auth/login', '/api/auth/setup', '/api/auth/logout'])
/**
 * Lo único que se puede hacer con un token de API: trabajar con notas y saber
 * quién es. Gestionar usuarios, contraseñas o tokens exige una sesión de navegador.
 */
const TOKEN_API = [/^\/api\/documents(\/|$)/, /^\/api\/auth\/state$/]
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export default defineEventHandler((event) => {
  const path = event.path.split('?')[0]!
  if (!path.startsWith('/api/')) return
  const auth = event.context.auth

  // Protección CSRF: si el navegador indica un origen, tiene que ser esta misma web.
  // (Clientes sin navegador, como la CLI, no envían Origin.)
  if (!SAFE_METHODS.has(event.method)) {
    const origin = getRequestHeader(event, 'origin')
    if (origin) {
      let originHost: string | undefined
      try {
        originHost = new URL(origin).host
      } catch {
        originHost = undefined
      }
      if (originHost !== getRequestHost(event, { xForwardedHost: trustProxy() })) {
        throw createError({ statusCode: 403, message: 'Origen no permitido' })
      }
    }
  }

  if (auth?.via === 'token') {
    if (!TOKEN_API.some((re) => re.test(path))) {
      throw createError({ statusCode: 403, message: 'Esta operación no está disponible con un token de API' })
    }
    if (auth.scope === 'read' && !SAFE_METHODS.has(event.method)) {
      throw createError({ statusCode: 403, message: 'Este token es de solo lectura' })
    }
    return
  }

  // Los iconos (Nuxt Icon) se sirven desde /api/_nuxt_icon y son públicos.
  if (PUBLIC_API.has(path) || path.startsWith('/api/_nuxt_icon/')) return
  if (!auth) throw createError({ statusCode: 401, message: 'Necesitas iniciar sesión' })
})
