<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { TreeContext } from './TreeFolder.vue'

/**
 * Carpetas y notas del espacio actual. Las carpetas tienen su menú (nueva nota,
 * subcarpeta, renombrar, eliminar); las notas son enlaces.
 */
const route = useRoute()
const toast = useToast()
const confirm = useConfirmDialog()
const { current, canWrite, folders, refreshFolders } = useWorkspaces()
const { documents, createDocument, refreshAll, run } = useDocuments()

const activeId = computed(() => (route.path.startsWith('/d/') ? String(route.params.id) : null))
const byName = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' })
const rootFolders = computed(() => folders.value.filter((f) => !f.parentId).sort((a, b) => byName(a.name, b.name)))
const rootNotes = computed(() => documents.value.filter((d) => !d.folderId).sort((a, b) => byName(a.title, b.title)))

// Carpetas desplegadas: lo que la persona abre o cierra, y por defecto las que
// contienen la nota abierta. En useState para que servidor y navegador coincidan.
const toggled = useState<Record<string, boolean>>('tree-expanded', () => ({}))
function containsActive(folderId: string): boolean {
  const doc = documents.value.find((d) => d.id === activeId.value)
  for (let id = doc?.folderId ?? null; id; id = folders.value.find((f) => f.id === id)?.parentId ?? null) {
    if (id === folderId) return true
  }
  return false
}
const isExpanded = (id: string) => toggled.value[id] ?? containsActive(id)
const toggle = (id: string) => (toggled.value = { ...toggled.value, [id]: !isExpanded(id) })

// --- Acciones de carpetas ---
const dialog = reactive({ open: false, mode: 'create' as 'create' | 'rename', parentId: null as string | null, folderId: '', initial: '' })

function newFolder(parentId: string | null = null) {
  Object.assign(dialog, { open: true, mode: 'create', parentId, folderId: '', initial: '' })
  // La carpeta donde se crea queda desplegada para ver el resultado.
  if (parentId) toggled.value = { ...toggled.value, [parentId]: true }
}
defineExpose({ newFolder })

async function onDialogSubmit(name: string) {
  if (dialog.mode === 'create') {
    const url: string = `/api/workspaces/${current.value!.id}/folders`
    await run(() => $fetch<FolderRow>(url, { method: 'POST', body: { name, parentId: dialog.parentId } }), 'No se pudo crear la carpeta')
  } else {
    const url: string = `/api/folders/${dialog.folderId}`
    await run(() => $fetch<FolderRow>(url, { method: 'PATCH', body: { name } }), 'No se pudo renombrar la carpeta')
  }
  await refreshFolders()
}

async function deleteFolder(folder: FolderRow) {
  const confirmed = await confirm({
    title: `¿Eliminar la carpeta «${folder.name}»?`,
    description: 'No se borra ninguna nota: lo que contiene pasa a la carpeta superior.',
    confirmLabel: 'Eliminar carpeta',
    confirmIcon: 'i-lucide-trash-2',
    color: 'error',
  })
  if (!confirmed) return
  const url: string = `/api/folders/${folder.id}`
  const ok = await run(() => $fetch<null>(url, { method: 'DELETE' }).then(() => true), 'No se pudo eliminar la carpeta')
  if (ok) toast.add({ title: `Carpeta «${folder.name}» eliminada`, description: 'Su contenido pasó a la carpeta superior.', color: 'success' })
  await Promise.all([refreshFolders(), refreshAll()])
}

function folderMenu(folder: FolderRow): DropdownMenuItem[][] {
  const id = folder.id
  return [
    [
      { label: 'Nueva nota aquí', icon: 'i-lucide-file-plus', onSelect: () => createDocument({ folderId: id }) },
      { label: 'Nueva subcarpeta', icon: 'i-lucide-folder-plus', onSelect: () => newFolder(id) },
      {
        label: 'Renombrar',
        icon: 'i-lucide-pencil',
        onSelect: () => Object.assign(dialog, { open: true, mode: 'rename', folderId: id, initial: folder.name }),
      },
    ],
    [{ label: 'Eliminar carpeta', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => deleteFolder(folder) }],
  ]
}
provide<TreeContext>('workspace-tree', { folders, documents, activeId, canWrite, isExpanded, toggle, folderMenu })
</script>

<template>
  <div>
    <nav v-if="rootFolders.length || rootNotes.length" aria-label="Carpetas y notas">
      <ul class="space-y-px">
        <TreeFolder v-for="f in rootFolders" :key="f.id" :folder="f" />
        <TreeNote v-for="d in rootNotes" :key="d.id" :doc="d" />
      </ul>
    </nav>
    <p v-else class="px-2.5 text-sm text-dimmed">{{ canWrite ? 'Todavía no hay notas.' : 'Este espacio está vacío.' }}</p>

    <NameDialog
      v-model:open="dialog.open"
      :title="dialog.mode === 'create' ? 'Nueva carpeta' : 'Renombrar carpeta'"
      label="Nombre"
      :confirm-label="dialog.mode === 'create' ? 'Crear' : 'Guardar'"
      :initial="dialog.initial"
      @submit="onDialogSubmit"
    />
  </div>
</template>
