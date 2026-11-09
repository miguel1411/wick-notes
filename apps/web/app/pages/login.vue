<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Iniciar sesión' })

const route = useRoute()
const { login } = useAuth()

const form = reactive({ username: '', password: '' })
const error = ref('')
const loading = ref(false)
const expired = computed(() => route.query.expired === '1')

/** Solo se vuelve a rutas internas, nunca a otra web. */
function safeRedirect(): string {
  const r = route.query.redirect
  return typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : '/'
}

async function onSubmit() {
  error.value = ''
  loading.value = true
  try {
    await login(form.username, form.password)
    await navigateTo(safeRedirect(), { replace: true })
  } catch (err) {
    error.value = apiErrorMessage(err)
    form.password = ''
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="onSubmit">
    <div>
      <h1 class="text-lg font-semibold text-highlighted">Iniciar sesión</h1>
      <p class="text-sm text-muted">Entra con la cuenta que te dio tu administrador.</p>
    </div>

    <UAlert
      v-if="expired && !error"
      color="warning"
      variant="subtle"
      icon="i-lucide-clock"
      title="Tu sesión ha terminado. Vuelve a entrar para seguir."
    />
    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />

    <UFormField label="Usuario" name="username">
      <UInput v-model="form.username" autocomplete="username" autocapitalize="none" required autofocus class="w-full" />
    </UFormField>
    <UFormField label="Contraseña" name="password">
      <UInput v-model="form.password" type="password" autocomplete="current-password" required class="w-full" />
    </UFormField>

    <UButton type="submit" block :loading="loading" label="Entrar" />
  </form>
</template>
