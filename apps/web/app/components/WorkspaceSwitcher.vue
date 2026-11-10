<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

defineProps<{ collapsed?: boolean }>()

const { workspaces, current, select, refresh } = useWorkspaces()
const { run } = useDocuments()
const createOpen = ref(false)

const ROLE: Record<WorkspaceRole, string> = { owner: 'Propietario', editor: 'Editor', viewer: 'Solo lectura' }
const iconFor = (w: WorkspaceRow) => (w.everyone ? 'i-lucide-users' : 'i-lucide-lock')

const items = computed<DropdownMenuItem[][]>(() => [
  workspaces.value.map((w) => ({
    label: w.name,
    description: `${w.everyone ? 'Para todos' : ROLE[w.role]} · ${w.documentCount} ${w.documentCount === 1 ? 'nota' : 'notas'}`,
    icon: iconFor(w),
    type: 'checkbox' as const,
    checked: w.id === current.value?.id,
    onSelect: () => {
      select(w.id)
      void navigateTo('/')
    },
  })),
  [
    ...(current.value ? [{ label: 'Ajustes del espacio', icon: 'i-lucide-settings', to: `/workspaces/${current.value.id}` }] : []),
    { label: 'Nuevo espacio de trabajo…', icon: 'i-lucide-plus', onSelect: () => (createOpen.value = true) },
  ],
])

async function create(name: string) {
  const ws = await run(() => $fetch<WorkspaceRow>('/api/workspaces', { method: 'POST', body: { name } }), 'No se pudo crear el espacio')
  if (!ws) return
  await refresh()
  select(ws.id)
  await navigateTo(`/workspaces/${ws.id}`)
}
</script>

<template>
  <div>
    <UDropdownMenu :items="items" :content="{ align: 'start' }" :ui="{ content: 'w-72' }">
      <UButton
        color="neutral"
        variant="ghost"
        block
        :square="collapsed"
        :class="collapsed ? '' : 'justify-start'"
        :aria-label="`Espacio de trabajo: ${current?.name ?? ''}`"
      >
        <UIcon :name="current ? iconFor(current) : 'i-lucide-layers'" class="size-4 shrink-0 text-muted" />
        <span v-if="!collapsed" class="truncate font-medium">{{ current?.name ?? 'Sin espacio' }}</span>
        <UBadge v-if="!collapsed && current?.role === 'viewer'" label="Lectura" color="neutral" variant="subtle" size="sm" />
        <UIcon v-if="!collapsed" name="i-lucide-chevrons-up-down" class="ms-auto size-4 text-dimmed" />
      </UButton>
    </UDropdownMenu>
    <NameDialog
      v-model:open="createOpen"
      title="Nuevo espacio de trabajo"
      description="Empezará siendo privado: solo tú. Después puedes invitar a otras personas o abrirlo a todos."
      label="Nombre"
      confirm-label="Crear espacio"
      @submit="create"
    />
  </div>
</template>
