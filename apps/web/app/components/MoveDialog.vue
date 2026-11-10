<script setup lang="ts">
/** Elige espacio de trabajo y carpeta de destino para una nota. */
const props = defineProps<{ title: string; workspaceId: string; folderId: string | null }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ move: [target: { workspaceId: string; folderId: string | null }] }>()

const { workspaces } = useWorkspaces()
const targetWs = ref(props.workspaceId)
const targetFolder = ref<string>(props.folderId ?? '')
const folders = ref<FolderRow[]>([])
const loadingFolders = ref(false)

const writable = computed(() => workspaces.value.filter((w) => canWriteIn(w.role)))
const wsItems = computed(() => writable.value.map((w) => ({ label: w.name, value: w.id })))

/** Carpetas con su ruta completa («Infra / Servidores»). */
const folderItems = computed(() => {
  const byId = new Map(folders.value.map((f) => [f.id, f]))
  const path = (f: FolderRow): string => (f.parentId && byId.get(f.parentId) ? `${path(byId.get(f.parentId)!)} / ${f.name}` : f.name)
  return [
    { label: '(raíz del espacio)', value: '' },
    ...folders.value.map((f) => ({ label: path(f), value: f.id })).sort((a, b) => a.label.localeCompare(b.label, 'es')),
  ]
})

async function loadFolders(wsId: string) {
  loadingFolders.value = true
  try {
    const url: string = `/api/workspaces/${wsId}/folders`
    folders.value = await $fetch<FolderRow[]>(url)
  } finally {
    loadingFolders.value = false
  }
}

watch(open, (isOpen) => {
  if (!isOpen) return
  targetWs.value = props.workspaceId
  targetFolder.value = props.folderId ?? ''
  void loadFolders(targetWs.value)
})
watch(targetWs, (wsId, previous) => {
  if (!open.value || wsId === previous) return
  targetFolder.value = ''
  void loadFolders(wsId)
})

const unchanged = computed(() => targetWs.value === props.workspaceId && (targetFolder.value || null) === props.folderId)
</script>

<template>
  <UModal v-model:open="open" :title="`Mover «${title}»`" description="Quien no tenga acceso al espacio de destino dejará de ver la nota.">
    <template #body>
      <div class="space-y-4">
        <UFormField label="Espacio de trabajo">
          <USelect v-model="targetWs" :items="wsItems" class="w-full" />
        </UFormField>
        <UFormField label="Carpeta">
          <USelect v-model="targetFolder" :items="folderItems" :loading="loadingFolders" class="w-full" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="open = false" />
        <UButton
          label="Mover"
          icon="i-lucide-folder-input"
          :disabled="unchanged"
          @click="emit('move', { workspaceId: targetWs, folderId: targetFolder || null })"
        />
      </div>
    </template>
  </UModal>
</template>
