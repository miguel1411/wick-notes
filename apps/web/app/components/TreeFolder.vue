<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * Una carpeta del árbol de la barra lateral, con sus subcarpetas y notas.
 * HTML válido a propósito: la fila (botón para desplegar) y el botón de acciones
 * van uno al lado del otro, nunca uno dentro del otro.
 */
export interface TreeContext {
  folders: Ref<FolderRow[]>
  documents: Ref<DocumentSummary[]>
  activeId: Ref<string | null>
  canWrite: Ref<boolean>
  isExpanded: (folderId: string) => boolean
  toggle: (folderId: string) => void
  folderMenu: (folder: FolderRow) => DropdownMenuItem[][]
}

const props = defineProps<{ folder: FolderRow }>()
const ctx = inject<TreeContext>('workspace-tree')!

const byName = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' })
const subfolders = computed(() => ctx.folders.value.filter((f) => f.parentId === props.folder.id).sort((a, b) => byName(a.name, b.name)))
const notes = computed(() => ctx.documents.value.filter((d) => d.folderId === props.folder.id).sort((a, b) => byName(a.title, b.title)))
const expanded = computed(() => ctx.isExpanded(props.folder.id))
</script>

<template>
  <li>
    <div class="group flex items-center rounded-md hover:bg-elevated/60">
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left text-sm text-default"
        :aria-expanded="expanded"
        @click="ctx.toggle(folder.id)"
      >
        <UIcon :name="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5 shrink-0 text-dimmed" />
        <UIcon :name="expanded ? 'i-lucide-folder-open' : 'i-lucide-folder'" class="size-4 shrink-0 text-muted" />
        <span class="truncate">{{ folder.name }}</span>
      </button>
      <UDropdownMenu v-if="ctx.canWrite.value" :items="ctx.folderMenu(folder)" :content="{ align: 'start' }">
        <UButton
          icon="i-lucide-ellipsis"
          color="neutral"
          variant="ghost"
          size="xs"
          class="me-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          :aria-label="`Opciones de la carpeta ${folder.name}`"
        />
      </UDropdownMenu>
    </div>
    <ul v-if="expanded" class="ms-3 border-s border-default ps-1">
      <TreeFolder v-for="f in subfolders" :key="f.id" :folder="f" />
      <TreeNote v-for="d in notes" :key="d.id" :doc="d" />
      <li v-if="!subfolders.length && !notes.length" class="px-2 py-1 text-xs text-dimmed">Vacía</li>
    </ul>
  </li>
</template>
