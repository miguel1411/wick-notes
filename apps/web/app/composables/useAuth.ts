export type UserRole = 'ADMIN' | 'MEMBER'

export interface SessionUser {
  id: string
  username: string
  name: string
  role: UserRole
}

interface AuthState {
  setupRequired: boolean
  user: SessionUser | null
}

/** Mensaje legible de un error de $fetch. */
export function apiErrorMessage(err: unknown): string {
  const e = err as { data?: { message?: string; statusMessage?: string }; statusMessage?: string; message?: string }
  return e?.data?.message ?? e?.data?.statusMessage ?? e?.statusMessage ?? e?.message ?? 'Error inesperado'
}

export function apiErrorStatus(err: unknown): number | undefined {
  const e = err as { statusCode?: number; status?: number; response?: { status?: number } }
  return e?.statusCode ?? e?.status ?? e?.response?.status
}

/** Sesión actual, compartida por toda la app (y transferida del servidor al cliente). */
export function useAuth() {
  const state = useState<AuthState | null>('auth', () => null)
  const requestFetch = useRequestFetch()

  const user = computed(() => state.value?.user ?? null)
  const isAdmin = computed(() => user.value?.role === 'ADMIN')

  async function refresh() {
    state.value = await requestFetch<AuthState>('/api/auth/state')
    return state.value
  }

  async function login(username: string, password: string) {
    const { user } = await $fetch<{ user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    })
    state.value = { setupRequired: false, user }
  }

  async function setup(input: { username: string; name: string; password: string }) {
    const { user } = await $fetch<{ user: SessionUser }>('/api/auth/setup', { method: 'POST', body: input })
    state.value = { setupRequired: false, user }
  }

  async function logout() {
    await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    state.value = { setupRequired: false, user: null }
    clearNuxtData()
    await navigateTo('/login')
  }

  /** La sesión caducó o se revocó mientras se usaba la app. */
  async function handleUnauthorized() {
    state.value = { setupRequired: false, user: null }
    clearNuxtData()
    const route = useRoute()
    await navigateTo({ path: '/login', query: { redirect: route.fullPath, expired: '1' } })
  }

  return { state, user, isAdmin, refresh, login, setup, logout, handleUnauthorized }
}
