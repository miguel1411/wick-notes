<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const { documents, createDocument } = useDocuments()

const items = computed<NavigationMenuItem[]>(() =>
  documents.value.map((doc) => ({
    label: doc.title,
    icon: 'i-lucide-file-text',
    to: `/d/${doc.id}`,
  })),
)
</script>

<template>
  <UDashboardGroup unit="rem">
    <UDashboardSidebar collapsible resizable class="bg-elevated/25" :ui="{ footer: 'border-t border-default' }">
      <template #header="{ collapsed }">
        <NuxtLink to="/" class="flex items-center gap-2 font-semibold text-highlighted">
          <img src="/favicon.svg" alt="" class="size-6 shrink-0" />
          <span v-if="!collapsed">wick notes</span>
        </NuxtLink>
      </template>

      <template #default="{ collapsed }">
        <UButton
          icon="i-lucide-plus"
          :label="collapsed ? undefined : 'Nueva nota'"
          color="neutral"
          variant="outline"
          block
          :square="collapsed"
          @click="createDocument()"
        />

        <p v-if="!collapsed" class="px-2.5 pt-3 text-xs font-medium text-muted">Recientes</p>
        <UNavigationMenu
          v-if="items.length"
          :collapsed="collapsed"
          :items="items"
          orientation="vertical"
          tooltip
        />
        <p v-else-if="!collapsed" class="px-2.5 text-sm text-dimmed">Todavía no hay notas.</p>
      </template>

      <template #footer="{ collapsed }">
        <UColorModeButton :class="{ 'mx-auto': collapsed }" />
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
