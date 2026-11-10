<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const route = useRoute()
const id = computed(() => String(route.params.id))

const { renameDocument, deleteDocument } = useDocuments()
const { data: doc, error, refresh: refreshDoc } = await useFetch<DocumentSummary>(() => `/api/documents/${id.value}`)
const { refresh: refreshList } = useDocuments()
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
  if (!doc.value || title.value.trim() === doc.value.title) return
  const updated = await renameDocument(id.value, title.value)
  if (updated) doc.value = updated
  else title.value = doc.value.title
}

// --- Colaboración ---
const syncStatus = ref<SyncStatus>('connecting')
const peers = ref<Peer[]>([])

// --- Eliminar ---
const confirmDelete = ref(false)
const deleting = ref(false)

async function onDelete() {
  deleting.value = true
  const ok = await deleteDocument(id.value)
  deleting.value = false
  if (!ok) return
  confirmDelete.value = false
  await navigateTo('/')
}

const menu: DropdownMenuItem[][] = [
  [
    { label: 'Historial', icon: 'i-lucide-history', onSelect: () => (historyOpen.value = true) },
    {
      label: 'Descargar Markdown',
      icon: 'i-lucide-file-down',
      // La respuesta es un adjunto: el navegador lo descarga sin salir de la página.
      onSelect: () => window.location.assign(`/api/documents/${id.value}/markdown?download=1`),
    },
  ],
  [{ label: 'Eliminar nota', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => (confirmDelete.value = true) }],
]
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
        description="Puede que la hayan eliminado o que el enlace no sea correcto."
        :actions="[{ label: 'Volver al inicio', to: '/', color: 'neutral', variant: 'outline' }]"
      />

      <div v-else class="mx-auto w-full max-w-3xl">
        <input
          v-model="title"
          aria-label="Título de la nota"
          placeholder="Sin título"
          maxlength="200"
          class="w-full bg-transparent pt-4 text-3xl font-bold text-highlighted outline-none placeholder:text-dimmed sm:text-4xl"
          @blur="saveTitle"
          @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
        />
        <!-- El editor solo existe en el navegador; se descarga aparte al abrir una nota. -->
        <ClientOnly>
          <LazyCollabEditor
            :key="id"
            :document-id="id"
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

  <HistoryPanel v-if="doc" v-model:open="historyOpen" :document-id="id" :title="doc.title" @restored="onRestored" />

  <UModal
    v-model:open="confirmDelete"
    title="¿Eliminar esta nota?"
    :description="`«${doc?.title}» se eliminará para todos los colaboradores. Esta acción no se puede deshacer.`"
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="confirmDelete = false" />
        <UButton label="Eliminar" color="error" icon="i-lucide-trash-2" :loading="deleting" @click="onDelete" />
      </div>
    </template>
  </UModal>
</template>
