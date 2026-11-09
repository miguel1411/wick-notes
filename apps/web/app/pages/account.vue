<script setup lang="ts">
useHead({ title: 'Mi cuenta' })

const { user } = useAuth()
const toast = useToast()

const form = reactive({ currentPassword: '', newPassword: '', confirm: '' })
const error = ref('')
const saving = ref(false)

async function onSubmit() {
  error.value = ''
  if (form.newPassword !== form.confirm) {
    error.value = 'Las contraseñas nuevas no coinciden'
    return
  }
  saving.value = true
  try {
    await $fetch('/api/auth/password', {
      method: 'POST',
      body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
    })
    Object.assign(form, { currentPassword: '', newPassword: '', confirm: '' })
    toast.add({
      title: 'Contraseña cambiada',
      description: 'Se han cerrado tus sesiones en otros dispositivos.',
      color: 'success',
      icon: 'i-lucide-check',
    })
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    saving.value = false
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
        <UCard>
          <div class="flex items-center gap-3">
            <UserAvatar v-if="user" :user="user" size="lg" />
            <div class="min-w-0">
              <p class="font-medium text-highlighted">{{ user?.name }}</p>
              <p class="text-sm text-muted">
                @{{ user?.username }} · {{ user?.role === 'ADMIN' ? 'Administrador' : 'Miembro' }}
              </p>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">Cambiar contraseña</h2>
          </template>
          <form class="space-y-4" @submit.prevent="onSubmit">
            <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
            <UFormField label="Contraseña actual" name="currentPassword">
              <UInput v-model="form.currentPassword" type="password" autocomplete="current-password" required class="w-full" />
            </UFormField>
            <UFormField label="Contraseña nueva" name="newPassword" help="Al menos 10 caracteres.">
              <UInput v-model="form.newPassword" type="password" autocomplete="new-password" required class="w-full" />
            </UFormField>
            <UFormField label="Repite la contraseña nueva" name="confirm">
              <UInput v-model="form.confirm" type="password" autocomplete="new-password" required class="w-full" />
            </UFormField>
            <div class="flex justify-end">
              <UButton type="submit" :loading="saving" label="Guardar contraseña" />
            </div>
          </form>
        </UCard>

        <ApiTokensCard />
      </div>
    </template>
  </UDashboardPanel>
</template>
