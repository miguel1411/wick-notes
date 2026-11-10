<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const { createDocument, importMarkdownFiles } = useDocuments()
const { canWrite } = useWorkspaces()
const { user, isAdmin, logout } = useAuth()
const colorMode = useColorMode()
const tree = ref<{ newFolder: (parentId?: string | null) => void }>()

const fileInput = ref<HTMLInputElement>()
async function onFilesSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (files.length) await importMarkdownFiles(files)
}

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
        <WorkspaceSwitcher :collapsed="collapsed" />

        <div class="flex gap-1.5" :class="{ 'flex-col': collapsed }">
          <UButton
            icon="i-lucide-plus"
            :label="collapsed ? undefined : 'Nueva nota'"
            color="neutral"
            variant="outline"
            block
            :square="collapsed"
            :disabled="!canWrite"
            class="flex-1"
            @click="createDocument()"
          />
          <UTooltip text="Nueva carpeta">
            <UButton
              icon="i-lucide-folder-plus"
              color="neutral"
              variant="outline"
              square
              :disabled="!canWrite"
              aria-label="Nueva carpeta"
              @click="tree?.newFolder(null)"
            />
          </UTooltip>
          <UTooltip text="Importar Markdown (.md)">
            <UButton
              icon="i-lucide-file-up"
              color="neutral"
              variant="outline"
              square
              :disabled="!canWrite"
              aria-label="Importar Markdown"
              @click="fileInput?.click()"
            />
          </UTooltip>
          <input
            ref="fileInput"
            type="file"
            accept=".md,.markdown,.mdown,.txt,text/markdown,text/plain"
            multiple
            class="hidden"
            @change="onFilesSelected"
          />
        </div>

        <UDashboardSearchButton :collapsed="collapsed" label="Buscar" class="bg-transparent ring-default" />

        <PendingMovesButton :collapsed="collapsed" />

        <WorkspaceTree v-show="!collapsed" ref="tree" class="pt-2" />
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

    <NoteSearch />
  </UDashboardGroup>
</template>
