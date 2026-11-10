<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const route = useRoute()
const id = computed(() => String(route.params.id))

const { renameDocument, deleteDocument, moveDocument, refresh: refreshList } = useDocuments()
const { workspaces, current, select: selectWorkspace } = useWorkspaces()
const confirm = useConfirmDialog()
const { data: doc, error, refresh: refreshDoc } = await useFetch<DocumentDetail>(() => `/api/documents/${id.value}`)

const canEdit = computed(() => !!doc.value?.canEdit)
const workspaceName = computed(() => workspaces.value.find((w) => w.id === doc.value?.workspaceId)?.name)

// La barra lateral muestra el espacio de la nota abierta.
watch(
  () => doc.value?.workspaceId,
  (wsId) => {
    if (wsId && wsId !== current.value?.id) selectWorkspace(wsId)
  },
  { immediate: true },
)

const historyOpen = ref(false)
async function onRestored() {
  await Promise.all([refreshDoc(), refreshList()])
}

useHead({ title: () => doc.value?.title ?? 'Nota' })

// --- Título ---
const title = ref(doc.value?.title ?? '')
watch(doc, (d) => {
  if (d) title.value = d.title
})

async function saveTitle() {
  if (!doc.value || !canEdit.value || title.value.trim() === doc.value.title) return
  const updated = await renameDocument(id.value, title.value)
  if (updated) doc.value = { ...doc.value, ...updated }
  else title.value = doc.value.title
}

// --- Colaboración ---
const syncStatus = ref<SyncStatus>('connecting')
const peers = ref<Peer[]>([])

// --- Mover ---
const moveOpen = ref(false)
async function onMove(target: { workspaceId: string; folderId: string | null }) {
  const moved = await moveDocument(id.value, target)
  if (!moved) return
  moveOpen.value = false
  await refreshDoc()
}

// --- Eliminar ---
async function onDelete() {
  const deleted = await confirm({
    title: '¿Eliminar esta nota?',
    description: `«${doc.value?.title}» se eliminará para todos los colaboradores, con su historial. Esta acción no se puede deshacer.`,
    confirmLabel: 'Eliminar',
    confirmIcon: 'i-lucide-trash-2',
    color: 'error',
    action: () => deleteDocument(id.value),
  })
  if (deleted) await navigateTo('/')
}

const menu = computed<DropdownMenuItem[][]>(() => [
  [
    { label: 'Historial', icon: 'i-lucide-history', onSelect: () => (historyOpen.value = true) },
    {
      label: 'Descargar Markdown',
      icon: 'i-lucide-file-down',
      // La respuesta es un adjunto: el navegador lo descarga sin salir de la página.
      onSelect: () => window.location.assign(`/api/documents/${id.value}/markdown?download=1`),
    },
    ...(canEdit.value ? [{ label: 'Mover a…', icon: 'i-lucide-folder-input', onSelect: () => (moveOpen.value = true) }] : []),
  ],
  ...(canEdit.value
    ? [[{ label: 'Eliminar nota', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: onDelete }]]
    : []),
])
</script>

<template>
  <UDashboardPanel :id="`doc-${id}`">
    <template #header>
      <UDashboardNavbar :title="doc?.title ?? 'Nota'" :ui="{ title: 'truncate' }">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <PresenceAvatars :peers="peers" />
          <UBadge v-if="doc && !canEdit" label="Solo lectura" icon="i-lucide-eye" color="neutral" variant="subtle" />
          <SyncIndicator v-if="doc" :status="syncStatus" />
          <UDropdownMenu v-if="doc" :items="menu" :content="{ align: 'end' }">
            <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" aria-label="Más opciones" />
          </UDropdownMenu>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UEmpty
        v-if="error || !doc"
        class="my-auto"
        icon="i-lucide-file-x"
        title="Esta nota no existe"
        description="Puede que la hayan eliminado, que el enlace no sea correcto o que no tengas acceso a su espacio de trabajo."
        :actions="[{ label: 'Volver al inicio', to: '/', color: 'neutral', variant: 'outline' }]"
      />

      <div v-else class="mx-auto w-full max-w-3xl">
        <p v-if="workspaceName" class="pt-2 text-xs text-dimmed">{{ workspaceName }}</p>
        <input
          v-model="title"
          aria-label="Título de la nota"
          placeholder="Sin título"
          maxlength="200"
          :readonly="!canEdit"
          class="w-full bg-transparent pt-2 text-3xl font-bold text-highlighted outline-none placeholder:text-dimmed sm:text-4xl"
          @blur="saveTitle"
          @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
        />
        <!-- El editor solo existe en el navegador; se descarga aparte al abrir una nota. -->
        <ClientOnly>
          <LazyCollabEditor
            :key="`${id}:${canEdit}`"
            :document-id="id"
            :readonly="!canEdit"
            @status="syncStatus = $event"
            @peers="peers = $event"
          />
          <template #fallback>
            <div class="space-y-3 py-6">
              <USkeleton class="h-5 w-2/3" />
              <USkeleton class="h-5 w-full" />
              <USkeleton class="h-5 w-5/6" />
            </div>
          </template>
        </ClientOnly>
      </div>
    </template>
  </UDashboardPanel>

  <HistoryPanel
    v-if="doc"
    v-model:open="historyOpen"
    :document-id="id"
    :title="doc.title"
    :can-edit="canEdit"
    @restored="onRestored"
  />

  <MoveDialog
    v-if="doc"
    v-model:open="moveOpen"
    :title="doc.title"
    :workspace-id="doc.workspaceId"
    :folder-id="doc.folderId"
    @move="onMove"
  />
</template>
