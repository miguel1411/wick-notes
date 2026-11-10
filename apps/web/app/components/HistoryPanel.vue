<script setup lang="ts">
interface Version {
  id: string
  createdAt: string
  title: string
  reason: 'auto' | 'manual' | 'before_replace' | 'before_restore'
  author: { id: string; name: string } | null
  preview: string
}

const props = withDefaults(defineProps<{ documentId: string; title: string; canEdit?: boolean }>(), { canEdit: true })
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ restored: [] }>()

const toast = useToast()
const { handleUnauthorized } = useAuth()

const versions = ref<Version[]>([])
const loading = ref(false)
const selected = ref<Version | null>(null)
const preview = ref('')
const previewLoading = ref(false)
const saving = ref(false)
const confirmRestore = ref(false)
const restoring = ref(false)

const base = computed(() => `/api/documents/${props.documentId}/versions`)

const REASONS: Record<Version['reason'], { label: string; icon: string; who: string }> = {
  auto: { label: 'Edición', icon: 'i-lucide-pencil', who: 'Cambios de' },
  manual: { label: 'Guardada a mano', icon: 'i-lucide-bookmark', who: 'Guardada por' },
  before_replace: { label: 'Antes de un reemplazo', icon: 'i-lucide-shield', who: 'Antes de que la reemplazara' },
  before_restore: { label: 'Antes de restaurar', icon: 'i-lucide-history', who: 'Antes de que restaurara' },
}

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' })
const fmt = (d: string) => dateFormat.format(new Date(d))

async function handle(err: unknown, title: string) {
  if (apiErrorStatus(err) === 401) return handleUnauthorized()
  toast.add({ title, description: apiErrorMessage(err), color: 'error', icon: 'i-lucide-circle-alert' })
}

async function load() {
  loading.value = true
  try {
    const url: string = base.value
    versions.value = await $fetch<Version[]>(url)
    if (selected.value && !versions.value.some((v) => v.id === selected.value!.id)) selected.value = null
  } catch (err) {
    await handle(err, 'No se pudo cargar el historial')
  } finally {
    loading.value = false
  }
}

async function select(v: Version) {
  selected.value = v
  preview.value = ''
  previewLoading.value = true
  try {
    const url: string = `${base.value}/${v.id}/markdown`
    const text = await $fetch<string>(url, { responseType: 'text' })
    if (selected.value?.id === v.id) preview.value = text
  } catch (err) {
    await handle(err, 'No se pudo abrir la versión')
  } finally {
    previewLoading.value = false
  }
}

async function saveNow() {
  saving.value = true
  try {
    const url: string = base.value
    await $fetch(url, { method: 'POST' })
    toast.add({ title: 'Versión guardada', color: 'success', icon: 'i-lucide-bookmark' })
    await load()
  } catch (err) {
    await handle(err, 'No se pudo guardar la versión')
  } finally {
    saving.value = false
  }
}

async function restore() {
  if (!selected.value) return
  restoring.value = true
  try {
    const url: string = `${base.value}/${selected.value.id}/restore`
    await $fetch(url, { method: 'POST' })
    toast.add({
      title: 'Versión restaurada',
      description: 'La versión anterior se guardó en el historial por si necesitas volver.',
      color: 'success',
      icon: 'i-lucide-history',
    })
    confirmRestore.value = false
    open.value = false
    emit('restored')
  } catch (err) {
    await handle(err, 'No se pudo restaurar')
  } finally {
    restoring.value = false
  }
}

watch(open, (isOpen) => {
  if (isOpen) {
    selected.value = null
    void load()
  }
})
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="`Historial de «${title}»`"
    description="Se guarda una versión mientras se edita (como mucho cada 10 minutos) y siempre antes de un reemplazo o una restauración."
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="flex h-full min-h-0 flex-col gap-4 md:flex-row">
        <div class="flex min-h-0 flex-col gap-3 md:w-72 md:shrink-0">
          <UButton
            v-if="canEdit"
            icon="i-lucide-bookmark-plus"
            label="Guardar versión ahora"
            color="neutral"
            variant="outline"
            block
            :loading="saving"
            @click="saveNow"
          />
          <div v-if="loading && !versions.length" class="space-y-2">
            <USkeleton v-for="i in 4" :key="i" class="h-14 w-full" />
          </div>
          <p v-else-if="!versions.length" class="text-sm text-muted">
            Todavía no hay versiones. La primera se guardará al editar la nota.
          </p>
          <ul v-else class="-mx-1 min-h-0 space-y-1 overflow-y-auto px-1 max-md:max-h-64">
            <li v-for="v in versions" :key="v.id">
              <button
                type="button"
                class="w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-elevated"
                :class="selected?.id === v.id ? 'bg-elevated ring ring-accented' : ''"
                @click="select(v)"
              >
                <span class="flex items-center gap-1.5 text-sm font-medium text-highlighted">
                  <UIcon :name="REASONS[v.reason].icon" class="size-4 shrink-0 text-dimmed" />
                  {{ fmt(v.createdAt) }}
                </span>
                <span class="block truncate text-xs text-muted">
                  {{ REASONS[v.reason].label }}{{ v.author ? ` · ${v.author.name}` : '' }}
                </span>
                <span v-if="v.preview" class="mt-0.5 block truncate text-xs text-dimmed">{{ v.preview }}</span>
              </button>
            </li>
          </ul>
        </div>

        <div class="flex min-h-0 min-w-0 flex-1 flex-col rounded-md border border-default">
          <div v-if="!selected" class="m-auto p-6 text-center text-sm text-muted">Elige una versión para verla.</div>
          <template v-else>
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-default px-3 py-2">
              <div class="min-w-0 text-sm">
                <p class="truncate font-medium text-highlighted">{{ selected.title }}</p>
                <p class="truncate text-xs text-muted">
                  {{ fmt(selected.createdAt) }} ·
                  {{ selected.author ? `${REASONS[selected.reason].who} ${selected.author.name}` : REASONS[selected.reason].label }}
                </p>
              </div>
              <UButton v-if="canEdit" icon="i-lucide-history" label="Restaurar esta versión" size="sm" @click="confirmRestore = true" />
            </div>
            <div class="min-h-0 flex-1 overflow-auto p-3">
              <USkeleton v-if="previewLoading" class="h-24 w-full" />
              <pre v-else class="whitespace-pre-wrap break-words font-mono text-sm text-default">{{ preview || '(nota vacía)' }}</pre>
            </div>
          </template>
        </div>
      </div>
    </template>
  </USlideover>

  <UModal
    v-model:open="confirmRestore"
    title="¿Restaurar esta versión?"
    description="El contenido y el título volverán a como estaban. Lo actual se guarda antes en el historial, así que no se pierde nada. Quien tenga la nota abierta verá el cambio al momento."
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="confirmRestore = false" />
        <UButton label="Restaurar" icon="i-lucide-history" :loading="restoring" @click="restore" />
      </div>
    </template>
  </UModal>
</template>
