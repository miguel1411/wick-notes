<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Configuración inicial' })

const { setup } = useAuth()

const form = reactive({ name: '', username: '', password: '', confirm: '' })
const error = ref('')
const loading = ref(false)

async function onSubmit() {
  error.value = ''
  if (form.password !== form.confirm) {
    error.value = 'Las contraseñas no coinciden'
    return
  }
  loading.value = true
  try {
    await setup({ name: form.name, username: form.username, password: form.password })
    await navigateTo('/', { replace: true })
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="onSubmit">
    <div>
      <h1 class="text-lg font-semibold text-highlighted">Bienvenido a wick notes</h1>
      <p class="text-sm text-muted">
        Crea la cuenta de administrador de esta instalación. Después podrás dar de alta al resto de usuarios.
      </p>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />

    <UFormField label="Tu nombre" name="name">
      <UInput v-model="form.name" autocomplete="name" required autofocus class="w-full" />
    </UFormField>
    <UFormField label="Usuario" name="username" help="Para iniciar sesión. Letras sin acentos, números, punto o guion.">
      <UInput v-model="form.username" autocomplete="username" autocapitalize="none" required class="w-full" />
    </UFormField>
    <UFormField label="Contraseña" name="password" help="Al menos 10 caracteres.">
      <UInput v-model="form.password" type="password" autocomplete="new-password" required class="w-full" />
    </UFormField>
    <UFormField label="Repite la contraseña" name="confirm">
      <UInput v-model="form.confirm" type="password" autocomplete="new-password" required class="w-full" />
    </UFormField>

    <UButton type="submit" block :loading="loading" label="Crear administrador" />
  </form>
</template>
