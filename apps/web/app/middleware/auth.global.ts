/**
 * Decide adónde puede ir cada quien:
 * - Instalación nueva → /setup (crear el primer admin).
 * - Sin sesión → /login (y vuelta a la página pedida después).
 * - Páginas con `meta.admin` → solo administradores.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { state, refresh } = useAuth()
  if (!state.value) await refresh()
  const { setupRequired, user } = state.value!

  if (setupRequired) return to.path === '/setup' ? undefined : navigateTo('/setup')
  if (to.path === '/setup') return navigateTo(user ? '/' : '/login')

  if (!user) {
    if (to.path === '/login') return
    return navigateTo({ path: '/login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } })
  }
  if (to.path === '/login') return navigateTo('/')
  if (to.meta.admin && user.role !== 'ADMIN') return navigateTo('/')
})
