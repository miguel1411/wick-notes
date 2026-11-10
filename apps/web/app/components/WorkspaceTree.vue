<script setup lang="ts">
import type { DropdownMenuItem, TreeItem } from '@nuxt/ui'

/**
 * Carpetas y notas del espacio actual. Las carpetas tienen su menú (nueva nota,
 * subcarpeta, renombrar, eliminar); las notas se abren al pulsarlas.
 */
const route = useRoute()
const toast = useToast()
const { current, canWrite, folders, refreshFolders } = useWorkspaces()
const { documents, createDocument, refreshAll, run } = useDocuments()

interface Node extends TreeItem {
  key: string
  folderId?: string
  children?: Node[]
}

const activeId = computed(() => (route.path.startsWith('/d/') ? String(route.params.id) : null))
const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' })

const items = computed<Node[]>(() => {
  const childFolders = (parentId: string | null): Node[] =>
    folders.value
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
      .map((f) => ({
        key: `f:${f.id}`,
        folderId: f.id,
        label: f.name,
        icon: 'i-lucide-folder',
        slot: 'folder',
        defaultExpanded: containsActive(f.id),
        children: [...childFolders(f.id), ...notesIn(f.id)],
      }))
  const notesIn = (folderId: string | null): Node[] =>
    documents.value
      .filter((d) => d.folderId === folderId)
      .sort(byTitle)
      .map((d) => ({
        key: `d:${d.id}`,
        label: d.title,
        icon: 'i-lucide-file-text',
        class: d.id === activeId.value ? 'text-primary font-medium' : undefined,
        onSelect: () => navigateTo(`/d/${d.id}`),
      }))
  return [...childFolders(null), ...notesIn(null)]
})

/** ¿La nota abierta está dentro de esta carpeta (a cualquier profundidad)? */
function containsActive(folderId: string): boolean {
  const doc = documents.value.find((d) => d.id === activeId.value)
  for (let id = doc?.folderId ?? null; id; id = folders.value.find((f) => f.id === id)?.parentId ?? null) {
    if (id === folderId) return true
  }
  return false
}

// --- Acciones de carpetas ---
const dialog = reactive({ open: false, mode: 'create' as 'create' | 'rename', parentId: null as string | null, folderId: '', initial: '' })
const deleteTarget = ref<{ id: string; name: string } | null>(null)

function newFolder(parentId: string | null = null) {
  Object.assign(dialog, { open: true, mode: 'create', parentId, folderId: '', initial: '' })
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

async function confirmDelete() {
  if (!deleteTarget.value) return
  const url: string = `/api/folders/${deleteTarget.value.id}`
  const ok = await run(() => $fetch<null>(url, { method: 'DELETE' }).then(() => true), 'No se pudo eliminar la carpeta')
  if (ok) toast.add({ title: `Carpeta «${deleteTarget.value.name}» eliminada`, description: 'Su contenido pasó a la carpeta superior.', color: 'success' })
  deleteTarget.value = null
  await Promise.all([refreshFolders(), refreshAll()])
}

/** La ranura del árbol no conserva el tipo de los elementos. */
const asNode = (item: unknown) => item as Node

function folderMenu(item: Node): DropdownMenuItem[][] {
  const id = item.folderId!
  return [
    [
      { label: 'Nueva nota aquí', icon: 'i-lucide-file-plus', onSelect: () => createDocument({ folderId: id }) },
      { label: 'Nueva subcarpeta', icon: 'i-lucide-folder-plus', onSelect: () => newFolder(id) },
      {
        label: 'Renombrar',
        icon: 'i-lucide-pencil',
        onSelect: () => Object.assign(dialog, { open: true, mode: 'rename', folderId: id, initial: item.label }),
      },
    ],
    [{ label: 'Eliminar carpeta', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => (deleteTarget.value = { id, name: item.label! }) }],
  ]
}
</script>

<template>
  <div>
    <UTree v-if="items.length" :items="items" :get-key="(i: Node) => i.key" color="neutral" size="sm">
      <template #folder-trailing="{ item }">
        <UDropdownMenu v-if="canWrite" :items="folderMenu(asNode(item))" :content="{ align: 'start' }">
          <UButton
            icon="i-lucide-ellipsis"
            color="neutral"
            variant="ghost"
            size="xs"
            class="ms-auto opacity-60 hover:opacity-100"
            :aria-label="`Opciones de la carpeta ${asNode(item).label}`"
            @click.stop
          />
        </UDropdownMenu>
      </template>
    </UTree>
    <p v-else class="px-2.5 text-sm text-dimmed">{{ canWrite ? 'Todavía no hay notas.' : 'Este espacio está vacío.' }}</p>

    <NameDialog
      v-model:open="dialog.open"
      :title="dialog.mode === 'create' ? 'Nueva carpeta' : 'Renombrar carpeta'"
      label="Nombre"
      :confirm-label="dialog.mode === 'create' ? 'Crear' : 'Guardar'"
      :initial="dialog.initial"
      @submit="onDialogSubmit"
    />

    <UModal
      :open="!!deleteTarget"
      :title="`¿Eliminar la carpeta «${deleteTarget?.name ?? ''}»?`"
      description="No se borra ninguna nota: lo que contiene pasa a la carpeta superior."
      @update:open="(o) => !o && (deleteTarget = null)"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancelar" color="neutral" variant="ghost" @click="deleteTarget = null" />
          <UButton label="Eliminar carpeta" color="error" icon="i-lucide-trash-2" @click="confirmDelete" />
        </div>
      </template>
    </UModal>
  </div>
</template>
