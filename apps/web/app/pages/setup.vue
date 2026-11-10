<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { setupInput, type SetupInput } from '@wick/core/auth/schemas'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Configuración inicial' })

const { setup } = useAuth()

const state = reactive({ name: '', username: '', password: '', confirm: '' })
const error = ref('')

async function onSubmit(event: FormSubmitEvent<SetupInput>) {
  error.value = ''
  try {
    await setup(event.data)
    await navigateTo('/', { replace: true })
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}
</script>

<template>
  <UForm
    :schema="setupInput"
    :validate="() => passwordsMatch(state.password, state.confirm)"
    :state="state"
    class="space-y-4"
    @submit="onSubmit"
  >
    <div>
      <h1 class="text-lg font-semibold text-highlighted">Bienvenido a wick notes</h1>
      <p class="text-sm text-muted">
        Crea la cuenta de administrador de esta instalación. Después podrás dar de alta al resto de usuarios.
      </p>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />

    <UFormField label="Tu nombre" name="name">
      <UInput v-model="state.name" autocomplete="name" required autofocus class="w-full" />
    </UFormField>
    <UFormField label="Usuario" name="username" help="Para iniciar sesión. Letras sin acentos, números, punto o guion.">
      <UInput v-model="state.username" autocomplete="username" autocapitalize="none" required class="w-full" />
    </UFormField>
    <UFormField label="Contraseña" name="password" help="Al menos 10 caracteres.">
      <UInput v-model="state.password" type="password" autocomplete="new-password" required class="w-full" />
    </UFormField>
    <UFormField label="Repite la contraseña" name="confirm">
      <UInput v-model="state.confirm" type="password" autocomplete="new-password" required class="w-full" />
    </UFormField>

    <UButton type="submit" block loading-auto label="Crear administrador" />
  </UForm>
</template>
