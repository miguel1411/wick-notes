<script setup lang="ts">
import type { DropdownMenuItem, NavigationMenuItem } from '@nuxt/ui'

const { documents, createDocument } = useDocuments()
const { user, isAdmin, logout } = useAuth()
const colorMode = useColorMode()

const userMenu = computed<DropdownMenuItem[][]>(() => [
  [{ type: 'label', label: user.value?.name, description: `@${user.value?.username}` }],
  [
    { label: 'Mi cuenta', icon: 'i-lucide-user-cog', to: '/account' },
    ...(isAdmin.value ? [{ label: 'Usuarios', icon: 'i-lucide-users', to: '/admin/users' }] : []),
    {
      label: colorMode.value === 'dark' ? 'Tema claro' : 'Tema oscuro',
      icon: colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon',
      onSelect: (e: Event) => {
        e.preventDefault()
        colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
      },
    },
  ],
  [{ label: 'Cerrar sesión', icon: 'i-lucide-log-out', onSelect: () => logout() }],
])

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
        <UDropdownMenu v-if="user" :items="userMenu" :content="{ align: 'start', side: 'top' }" class="w-full">
          <UButton
            color="neutral"
            variant="ghost"
            block
            :square="collapsed"
            :class="collapsed ? '' : 'justify-start'"
            :aria-label="`Menú de ${user.name}`"
          >
            <UserAvatar :user="user" size="xs" />
            <span v-if="!collapsed" class="truncate">{{ user.name }}</span>
            <UIcon v-if="!collapsed" name="i-lucide-chevrons-up-down" class="ms-auto size-4 text-dimmed" />
          </UButton>
        </UDropdownMenu>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
