<script setup lang="ts">
interface Member {
  user: { id: string; username: string; name: string; disabled: boolean }
  role: WorkspaceRole
}
interface Person {
  id: string
  username: string
  name: string
}

const route = useRoute()
const id = computed(() => String(route.params.id))
const toast = useToast()
const { user: me } = useAuth()
const { workspaces, refresh: refreshWorkspaces, select } = useWorkspaces()
const { run } = useDocuments()

const ws = computed(() => workspaces.value.find((w) => w.id === id.value) ?? null)
const canManage = computed(() => ws.value?.role === 'owner')
useHead({ title: () => (ws.value ? `Ajustes · ${ws.value.name}` : 'Espacio de trabajo') })

watch(ws, (w) => w && select(w.id), { immediate: true })

const { data: members, refresh: refreshMembers } = await useFetch<Member[]>(() => `/api/workspaces/${id.value}/members`, {
  default: () => [],
})
const { data: people } = await useFetch<Person[]>('/api/users/directory', { default: () => [] })

const ROLE_ITEMS = [
  { label: 'Propietario', value: 'owner', description: 'Edita y gestiona el espacio y sus miembros' },
  { label: 'Editor', value: 'editor', description: 'Lee y escribe notas y carpetas' },
  { label: 'Solo lectura', value: 'viewer', description: 'Solo lee' },
]
const roleLabel = (r: WorkspaceRole) => ROLE_ITEMS.find((i) => i.value === r)!.label

// --- Nombre y visibilidad ---
const name = ref('')
watch(ws, (w) => w && (name.value = w.name), { immediate: true })

async function patch(body: Record<string, unknown>, success: string) {
  const url: string = `/api/workspaces/${id.value}`
  const ok = await run(() => $fetch<WorkspaceRow>(url, { method: 'PATCH', body }).then(() => true), 'No se pudo guardar')
  if (ok) toast.add({ title: success, color: 'success', icon: 'i-lucide-check' })
  await refreshWorkspaces()
}
const saveName = () => name.value.trim() && name.value.trim() !== ws.value?.name && patch({ name: name.value }, 'Nombre guardado')
const setEveryone = (everyone: boolean) =>
  patch({ everyone }, everyone ? 'Ahora todas las personas pueden editar este espacio' : 'Ahora solo los miembros acceden a este espacio')

// --- Miembros ---
const newMember = reactive({ userId: '', role: 'editor' as WorkspaceRole })
const candidates = computed(() =>
  people.value
    .filter((p) => !members.value.some((m) => m.user.id === p.id))
    .map((p) => ({ label: `${p.name} (@${p.username})`, value: p.id })),
)

async function setRole(userId: string, role: WorkspaceRole) {
  const url: string = `/api/workspaces/${id.value}/members/${userId}`
  await run(() => $fetch<Member>(url, { method: 'PUT', body: { role } }), 'No se pudo cambiar el rol')
  await Promise.all([refreshMembers(), refreshWorkspaces()])
}

async function addMember() {
  if (!newMember.userId) return
  await setRole(newMember.userId, newMember.role)
  newMember.userId = ''
}

async function removeMember(m: Member) {
  const url: string = `/api/workspaces/${id.value}/members/${m.user.id}`
  const ok = await run(() => $fetch<null>(url, { method: 'DELETE' }).then(() => true), 'No se pudo quitar al miembro')
  if (ok) toast.add({ title: `${m.user.name} ya no es miembro`, color: 'success' })
  await Promise.all([refreshMembers(), refreshWorkspaces()])
  if (m.user.id === me.value?.id) await navigateTo('/')
}

// --- Borrar ---
const confirmDelete = ref(false)
async function deleteWs() {
  const url: string = `/api/workspaces/${id.value}`
  const ok = await run(() => $fetch<null>(url, { method: 'DELETE' }).then(() => true), 'No se pudo borrar el espacio')
  confirmDelete.value = false
  if (!ok) return
  await refreshWorkspaces()
  if (workspaces.value[0]) select(workspaces.value[0].id)
  toast.add({ title: 'Espacio borrado', color: 'success' })
  await navigateTo('/')
}
</script>

<template>
  <UDashboardPanel id="workspace-settings">
    <template #header>
      <UDashboardNavbar :title="ws ? `Ajustes de «${ws.name}»` : 'Espacio de trabajo'" :ui="{ title: 'truncate' }">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UEmpty
        v-if="!ws"
        class="my-auto"
        icon="i-lucide-folder-x"
        title="Este espacio no existe"
        description="O no tienes acceso a él."
        :actions="[{ label: 'Volver al inicio', to: '/', color: 'neutral', variant: 'outline' }]"
      />

      <div v-else class="mx-auto w-full max-w-2xl space-y-6">
        <UAlert
          v-if="!canManage"
          color="neutral"
          variant="subtle"
          icon="i-lucide-info"
          :title="`Tu rol aquí: ${roleLabel(ws.role)}`"
          description="Solo los propietarios del espacio pueden cambiar estos ajustes."
        />

        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">General</h2>
          </template>
          <div class="space-y-5">
            <form class="flex items-end gap-2" @submit.prevent="saveName">
              <UFormField label="Nombre" class="flex-1">
                <UInput v-model="name" :disabled="!canManage" maxlength="80" class="w-full" />
              </UFormField>
              <UButton v-if="canManage" type="submit" label="Guardar" color="neutral" variant="outline" />
            </form>
            <USwitch
              :model-value="ws.everyone"
              :disabled="!canManage"
              label="Para todos"
              description="Cualquier persona con cuenta (también las que se den de alta después) puede leer y editar este espacio, aunque no sea miembro."
              @update:model-value="setEveryone"
            />
          </div>
        </UCard>

        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <h2 class="font-semibold text-highlighted">Miembros</h2>
            <p class="text-sm text-muted">
              {{ ws.everyone ? 'Al ser «para todos», todo el mundo es al menos editor; aquí se asignan propietarios o roles explícitos.' : 'Solo estas personas (y los administradores) ven este espacio.' }}
            </p>
          </template>
          <ul class="divide-y divide-default">
            <li v-for="m in members" :key="m.user.id" class="flex items-center gap-3 px-4 py-3">
              <UserAvatar :user="m.user" :class="{ 'opacity-40': m.user.disabled }" />
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium text-highlighted">{{ m.user.name }}<span v-if="m.user.id === me?.id" class="text-muted"> (tú)</span></p>
                <p class="truncate text-sm text-muted">@{{ m.user.username }}</p>
              </div>
              <USelect
                v-if="canManage"
                :model-value="m.role"
                :items="ROLE_ITEMS"
                class="w-40"
                :aria-label="`Rol de ${m.user.name}`"
                @update:model-value="(r) => setRole(m.user.id, r as WorkspaceRole)"
              />
              <UBadge v-else :label="roleLabel(m.role)" color="neutral" variant="subtle" />
              <UButton
                v-if="canManage"
                icon="i-lucide-user-minus"
                color="error"
                variant="ghost"
                :aria-label="`Quitar a ${m.user.name}`"
                @click="removeMember(m)"
              />
            </li>
            <li v-if="!members.length" class="px-4 py-3 text-sm text-dimmed">Sin miembros explícitos.</li>
          </ul>
          <template v-if="canManage" #footer>
            <form class="flex flex-wrap items-end gap-2" @submit.prevent="addMember">
              <UFormField label="Añadir persona" class="min-w-48 flex-1">
                <USelectMenu
                  v-model="newMember.userId"
                  :items="candidates"
                  value-key="value"
                  placeholder="Elige a alguien…"
                  aria-label="Persona que añadir"
                  class="w-full"
                />
              </UFormField>
              <USelect v-model="newMember.role" :items="ROLE_ITEMS" class="w-40" aria-label="Rol del nuevo miembro" />
              <UButton type="submit" icon="i-lucide-user-plus" label="Añadir" :disabled="!newMember.userId" />
            </form>
          </template>
        </UCard>

        <UCard v-if="canManage">
          <template #header>
            <h2 class="font-semibold text-error">Borrar el espacio</h2>
          </template>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm text-muted">
              {{ ws.documentCount ? `Tiene ${ws.documentCount} ${ws.documentCount === 1 ? 'nota' : 'notas'}: muévelas o bórralas antes.` : 'El espacio está vacío y se puede borrar.' }}
            </p>
            <UButton
              label="Borrar espacio"
              color="error"
              variant="outline"
              icon="i-lucide-trash-2"
              :disabled="ws.documentCount > 0"
              @click="confirmDelete = true"
            />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="confirmDelete" :title="`¿Borrar «${ws?.name ?? ''}»?`" description="Se borran también sus carpetas (vacías).">
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="confirmDelete = false" />
        <UButton label="Borrar" color="error" icon="i-lucide-trash-2" @click="deleteWs" />
      </div>
    </template>
  </UModal>
</template>
