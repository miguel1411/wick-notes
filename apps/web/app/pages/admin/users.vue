<script setup lang="ts">
import type { DropdownMenuItem, FormSubmitEvent } from '@nuxt/ui'
import { createUserInput, resetPasswordInput, type CreateUserInput } from '@wick/core/auth/schemas'

definePageMeta({ admin: true })
useHead({ title: 'Usuarios' })

interface UserRow {
  id: string
  username: string
  name: string
  role: UserRole
  disabled: boolean
  createdAt: string
}

const { user: me, handleUnauthorized } = useAuth()
const toast = useToast()
const { data: users, refresh } = await useFetch<UserRow[]>('/api/users', { default: () => [] })

const roleItems = [
  { label: 'Miembro', value: 'MEMBER' },
  { label: 'Administrador', value: 'ADMIN' },
]

async function call(action: () => Promise<unknown>, success: string): Promise<boolean> {
  try {
    await action()
    await refresh()
    toast.add({ title: success, color: 'success', icon: 'i-lucide-check' })
    return true
  } catch (err) {
    if (apiErrorStatus(err) === 401) await handleUnauthorized()
    else toast.add({ title: 'No se pudo completar', description: apiErrorMessage(err), color: 'error', icon: 'i-lucide-circle-alert' })
    return false
  }
}

// --- Alta ---
const createOpen = ref(false)
const createError = ref('')
const creating = ref(false)
const newUser = reactive({ name: '', username: '', password: '', role: 'MEMBER' as UserRole })

function openCreate() {
  Object.assign(newUser, { name: '', username: '', password: '', role: 'MEMBER' })
  createError.value = ''
  createOpen.value = true
}

async function submitCreate(event: FormSubmitEvent<CreateUserInput>) {
  const data = event.data
  createError.value = ''
  creating.value = true
  try {
    await $fetch('/api/users', { method: 'POST', body: data })
    createOpen.value = false
    await refresh()
    toast.add({
      title: `Cuenta de ${data.name} creada`,
      description: `Comparte con esa persona su usuario (${data.username}) y la contraseña inicial.`,
      color: 'success',
      icon: 'i-lucide-user-plus',
    })
  } catch (err) {
    createError.value = apiErrorMessage(err)
  } finally {
    creating.value = false
  }
}

// --- Restablecer contraseña ---
const resetTarget = ref<UserRow | null>(null)
const resetState = reactive({ password: '' })
const resetError = ref('')
const resetting = ref(false)

async function submitReset() {
  if (!resetTarget.value) return
  resetError.value = ''
  resetting.value = true
  try {
    const url: string = `/api/users/${resetTarget.value.id}/password`
    await $fetch(url, { method: 'POST', body: { password: resetState.password } })
    toast.add({
      title: 'Contraseña restablecida',
      description: `Se han cerrado las sesiones abiertas de ${resetTarget.value.name}.`,
      color: 'success',
      icon: 'i-lucide-key-round',
    })
    resetTarget.value = null
  } catch (err) {
    resetError.value = apiErrorMessage(err)
  } finally {
    resetting.value = false
  }
}

function actions(u: UserRow): DropdownMenuItem[][] {
  const url: string = `/api/users/${u.id}`
  const update = (body: object, msg: string) => call(() => $fetch<UserRow>(url, { method: 'PATCH', body }), msg)
  return [
    [
      u.role === 'ADMIN'
        ? { label: 'Quitar rol de administrador', icon: 'i-lucide-shield-off', onSelect: () => update({ role: 'MEMBER' }, `${u.name} ya no es administrador`) }
        : { label: 'Hacer administrador', icon: 'i-lucide-shield', onSelect: () => update({ role: 'ADMIN' }, `${u.name} ahora es administrador`) },
      {
        label: 'Restablecer contraseña',
        icon: 'i-lucide-key-round',
        onSelect: () => {
          resetTarget.value = u
          resetState.password = ''
          resetError.value = ''
        },
      },
    ],
    [
      u.disabled
        ? { label: 'Reactivar cuenta', icon: 'i-lucide-user-check', onSelect: () => update({ disabled: false }, `Cuenta de ${u.name} reactivada`) }
        : {
            label: 'Desactivar cuenta',
            icon: 'i-lucide-user-x',
            color: 'error' as const,
            onSelect: () => update({ disabled: true }, `Cuenta de ${u.name} desactivada`),
          },
    ],
  ]
}
</script>

<template>
  <UDashboardPanel id="users">
    <template #header>
      <UDashboardNavbar title="Usuarios">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton icon="i-lucide-user-plus" label="Nuevo usuario" @click="openCreate" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-3xl space-y-4">
        <p class="text-sm text-muted">
          Todas las personas con cuenta pueden ver y editar todas las notas. Los administradores, además, gestionan las
          cuentas. Las cuentas no se borran: se desactivan, y sus notas se conservan.
        </p>

        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <ul class="divide-y divide-default">
            <li v-for="u in users" :key="u.id" class="flex items-center gap-3 px-4 py-3">
              <UUser
                :name="u.name"
                :description="`@${u.username}`"
                :avatar="userAvatar(u)"
                class="min-w-0 flex-1"
                :ui="{
                  avatar: u.disabled ? 'opacity-40' : '',
                  wrapper: 'min-w-0',
                  name: ['truncate', u.disabled && 'text-dimmed line-through'],
                  description: 'truncate',
                }"
              />
              <div class="hidden flex-wrap justify-end gap-1 sm:flex">
                <UBadge v-if="u.id === me?.id" color="neutral" variant="subtle" label="Tú" />
                <UBadge v-if="u.role === 'ADMIN'" color="primary" variant="subtle" label="Administrador" />
                <UBadge v-if="u.disabled" color="error" variant="subtle" label="Desactivada" />
              </div>
              <UDropdownMenu v-if="u.id !== me?.id" :items="actions(u)" :content="{ align: 'end' }">
                <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" :aria-label="`Acciones para ${u.name}`" />
              </UDropdownMenu>
              <UTooltip v-else text="Tu propia cuenta se gestiona en «Mi cuenta»">
                <UButton icon="i-lucide-user-cog" color="neutral" variant="ghost" to="/account" aria-label="Mi cuenta" />
              </UTooltip>
            </li>
          </ul>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <UModal
    v-model:open="createOpen"
    title="Nuevo usuario"
    description="La persona podrá cambiar su contraseña al entrar."
    :ui="{ footer: 'justify-end' }"
  >
    <template #body>
      <UForm id="create-user" :schema="createUserInput" :state="newUser" class="space-y-4" @submit="submitCreate">
        <UAlert v-if="createError" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="createError" />
        <UFormField label="Nombre" name="name">
          <UInput v-model="newUser.name" required autofocus class="w-full" />
        </UFormField>
        <UFormField label="Usuario" name="username" help="Para iniciar sesión. Letras sin acentos, números, punto o guion.">
          <UInput v-model="newUser.username" autocapitalize="none" autocomplete="off" required class="w-full" />
        </UFormField>
        <UFormField label="Contraseña inicial" name="password" help="Al menos 10 caracteres.">
          <UInput v-model="newUser.password" type="password" autocomplete="new-password" required class="w-full" />
        </UFormField>
        <UFormField label="Rol" name="role">
          <USelect v-model="newUser.role" :items="roleItems" class="w-full" />
        </UFormField>
      </UForm>
    </template>
    <template #footer="{ close }">
      <UButton label="Cancelar" color="neutral" variant="ghost" @click="close" />
      <UButton type="submit" form="create-user" label="Crear cuenta" :loading="creating" />
    </template>
  </UModal>

  <UModal
    :open="!!resetTarget"
    :title="`Restablecer la contraseña de ${resetTarget?.name ?? ''}`"
    description="Se cerrarán todas sus sesiones abiertas."
    :ui="{ footer: 'justify-end' }"
    @update:open="(open) => !open && (resetTarget = null)"
  >
    <template #body>
      <UForm id="reset-password" :schema="resetPasswordInput" :state="resetState" class="space-y-4" @submit="submitReset">
        <UAlert v-if="resetError" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="resetError" />
        <UFormField label="Contraseña nueva" name="password" help="Al menos 10 caracteres.">
          <UInput v-model="resetState.password" type="password" autocomplete="new-password" required autofocus class="w-full" />
        </UFormField>
      </UForm>
    </template>
    <template #footer="{ close }">
      <UButton label="Cancelar" color="neutral" variant="ghost" @click="close" />
      <UButton type="submit" form="reset-password" label="Restablecer" :loading="resetting" />
    </template>
  </UModal>
</template>
