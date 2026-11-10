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
      label: 'Apariencia',
      icon: 'i-lucide-sun-moon',
      children: (
        [
          { label: 'Claro', icon: 'i-lucide-sun', value: 'light' },
          { label: 'Oscuro', icon: 'i-lucide-moon', value: 'dark' },
          { label: 'Como el sistema', icon: 'i-lucide-monitor', value: 'system' },
        ] as const
      ).map(({ value, ...item }) => ({
        ...item,
        type: 'checkbox' as const,
        checked: colorMode.preference === value,
        onSelect: (e: Event) => {
          e.preventDefault()
          colorMode.preference = value
        },
      })),
    },
  ],
  [{ label: 'Cerrar sesión', icon: 'i-lucide-log-out', onSelect: () => logout() }],
])
</script>

<template>
  <UDashboardGroup unit="rem">
    <!--
      Al plegar/desplegar, el ancho se anima como en USidebar (200 ms), salvo al
      arrastrar el borde. collapsed-size = 4 (rem) coincide con su min-w-16, para
      que la animación recorra todo el trayecto en vez de frenar contra el mínimo.
      Mientras cambia el ancho, el contenido se recorta en lugar de partirse en líneas.
    -->
    <UDashboardSidebar
      collapsible
      resizable
      :collapsed-size="4"
      class="bg-elevated/25"
      :ui="{
        root: 'transition-[width] duration-200 ease-out data-[dragging=true]:transition-none motion-reduce:transition-none',
        header: 'overflow-hidden',
        body: 'overflow-x-hidden',
        footer: 'overflow-hidden border-t border-default',
      }"
    >
      <template #header="{ collapsed }">
        <NuxtLink to="/" class="flex items-center gap-2 font-semibold whitespace-nowrap text-highlighted">
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
