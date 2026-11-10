<script setup lang="ts">
import type { TreeContext } from './TreeFolder.vue'

/** Una nota del árbol: un enlace de verdad (se puede abrir en otra pestaña). */
defineProps<{ doc: DocumentSummary }>()
const ctx = inject<TreeContext>('workspace-tree')!
</script>

<template>
  <li>
    <NuxtLink
      :to="`/d/${doc.id}`"
      class="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm hover:bg-elevated/60"
      :class="doc.id === ctx.activeId.value ? 'bg-elevated font-medium text-highlighted' : 'text-default'"
      :aria-current="doc.id === ctx.activeId.value ? 'page' : undefined"
    >
      <UIcon name="i-lucide-file-text" class="ms-5 size-4 shrink-0 text-muted" />
      <span class="truncate">{{ doc.title }}</span>
    </NuxtLink>
  </li>
</template>
