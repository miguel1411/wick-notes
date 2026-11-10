<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { changeOwnPasswordInput, type ChangeOwnPasswordInput } from '@wick/core/auth/schemas'

useHead({ title: 'Mi cuenta' })

const { user } = useAuth()
const toast = useToast()

const form = useTemplateRef('form')
const state = reactive({ currentPassword: '', newPassword: '', confirm: '' })
const error = ref('')

async function onSubmit(event: FormSubmitEvent<ChangeOwnPasswordInput>) {
  error.value = ''
  try {
    await $fetch('/api/auth/password', { method: 'POST', body: event.data })
    Object.assign(state, { currentPassword: '', newPassword: '', confirm: '' })
    form.value?.clear()
    toast.add({
      title: 'Contraseña cambiada',
      description: 'Se han cerrado tus sesiones en otros dispositivos.',
      color: 'success',
      icon: 'i-lucide-check',
    })
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}
</script>

<template>
  <UDashboardPanel id="account">
    <template #header>
      <UDashboardNavbar title="Mi cuenta">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-2xl space-y-6">
        <UCard v-if="user">
          <UUser
            :name="user.name"
            :description="`@${user.username} · ${user.role === 'ADMIN' ? 'Administrador' : 'Miembro'}`"
            :avatar="userAvatar(user)"
            size="lg"
          />
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">Cambiar contraseña</h2>
          </template>
          <UForm
            ref="form"
            :schema="changeOwnPasswordInput"
            :validate="() => passwordsMatch(state.newPassword, state.confirm)"
            :state="state"
            class="space-y-4"
            @submit="onSubmit"
          >
            <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
            <UFormField label="Contraseña actual" name="currentPassword">
              <UInput v-model="state.currentPassword" type="password" autocomplete="current-password" required class="w-full" />
            </UFormField>
            <UFormField label="Contraseña nueva" name="newPassword" help="Al menos 10 caracteres.">
              <UInput v-model="state.newPassword" type="password" autocomplete="new-password" required class="w-full" />
            </UFormField>
            <UFormField label="Repite la contraseña nueva" name="confirm">
              <UInput v-model="state.confirm" type="password" autocomplete="new-password" required class="w-full" />
            </UFormField>
            <div class="flex justify-end">
              <UButton type="submit" loading-auto label="Guardar contraseña" />
            </div>
          </UForm>
        </UCard>

        <ApiTokensCard />
      </div>
    </template>
  </UDashboardPanel>
</template>
