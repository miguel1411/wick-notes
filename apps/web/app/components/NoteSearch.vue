<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'

interface SearchResult {
  id: string
  title: string
  snippet: string
  updatedAt: string
}

const { documents } = useDocuments()
const searchTerm = ref('')
const results = ref<SearchResult[]>([])
const loading = ref(false)

// Búsqueda en el servidor, con un pequeño retardo mientras se escribe.
let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0
watch(searchTerm, (term) => {
  clearTimeout(timer)
  const q = term.trim()
  if (!q) {
    results.value = []
    loading.value = false
    return
  }
  loading.value = true
  const mine = ++seq
  timer = setTimeout(async () => {
    try {
      const data = await $fetch<SearchResult[]>('/api/documents/search', { query: { q, limit: 20 } })
      if (mine === seq) results.value = data
    } catch {
      if (mine === seq) results.value = []
    } finally {
      if (mine === seq) loading.value = false
    }
  }, 180)
})

const groups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => {
  const q = searchTerm.value.trim()
  if (!q) {
    return [
      {
        id: 'recent',
        label: 'Recientes',
        ignoreFilter: true,
        items: documents.value.slice(0, 8).map((d) => ({ label: d.title, icon: 'i-lucide-file-text', to: `/d/${d.id}` })),
      },
    ]
  }
  return [
    {
      id: 'results',
      label: results.value.length ? `Resultados (${results.value.length})` : undefined,
      ignoreFilter: true,
      items: results.value.map((r) => ({
        label: r.title,
        description: r.snippet || undefined,
        icon: 'i-lucide-file-text',
        to: `/d/${r.id}`,
      })),
    },
  ]
})
</script>

<template>
  <UDashboardSearch
    v-model:search-term="searchTerm"
    :groups="groups"
    :loading="loading"
    :color-mode="false"
    placeholder="Buscar en títulos y contenido…"
    shortcut="meta_k"
  >
    <template #empty>
      <p class="py-6 text-center text-sm text-muted">
        {{ searchTerm.trim() && !loading ? `Ninguna nota contiene «${searchTerm.trim()}».` : 'Escribe para buscar.' }}
      </p>
    </template>
  </UDashboardSearch>
</template>
