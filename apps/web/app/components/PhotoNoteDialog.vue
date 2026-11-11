<script setup lang="ts">
/**
 * «Nota desde foto»: el usuario elige o toma de 1 a 4 fotos de apuntes escritos
 * a mano y la IA crea una nota en su carpeta. Se puede cerrar mientras trabaja:
 * la nota se crea igual y avisa al terminar.
 */
const open = defineModel<boolean>('open', { default: false })

const toast = useToast()
const { current, refresh: refreshWorkspaces, refreshFolders } = useWorkspaces()
const { refresh: refreshDocuments } = useDocuments()
const { status, refresh: refreshStatus } = useAiStatus()

interface Photo {
  id: number
  file: File
  url: string
}

type Phase = 'pick' | 'working' | 'rejected' | 'error'

const photos = ref<Photo[]>([])
const research = ref(true)
const instructions = ref('')
const phase = ref<Phase>('pick')
const stage = ref<PhotoNoteStage>('reading')
const researching = ref(false)
const error = ref('')
const rejected = ref<{ photo: number; reason: string }[]>([])
let nextId = 0

const maxPhotos = computed(() => status.value?.maxPhotos ?? 4)
const remaining = computed(() => status.value?.remainingToday ?? 0)
const canResearch = computed(() => !!status.value?.webSearch)
const canSubmit = computed(() => photos.value.length > 0 && remaining.value > 0 && !!current.value)

watch(open, (isOpen) => {
  if (isOpen) {
    void refreshStatus()
    if (phase.value !== 'working') reset()
  }
})

function reset() {
  for (const p of photos.value) URL.revokeObjectURL(p.url)
  photos.value = []
  instructions.value = ''
  research.value = true
  phase.value = 'pick'
  error.value = ''
  rejected.value = []
}

// --- Elegir fotos ---
const cameraInput = ref<HTMLInputElement>()
const filesInput = ref<HTMLInputElement>()

function addFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
  input.value = ''
  const room = maxPhotos.value - photos.value.length
  if (files.length > room) {
    toast.add({
      title: `Como máximo ${maxPhotos.value} fotos por nota`,
      description: room > 0 ? `Se añadieron ${room}.` : 'Quita alguna para añadir otra.',
      color: 'warning',
      icon: 'i-lucide-images',
    })
  }
  for (const file of files.slice(0, Math.max(0, room))) {
    photos.value.push({ id: nextId++, file, url: URL.createObjectURL(file) })
  }
}

// Las miniaturas son URLs de objeto: se liberan si el diálogo desaparece.
onBeforeUnmount(() => {
  for (const p of photos.value) URL.revokeObjectURL(p.url)
})

function removePhoto(index: number) {
  const [p] = photos.value.splice(index, 1)
  if (p) URL.revokeObjectURL(p.url)
}

// --- Crear ---
const STAGES: { key: PhotoNoteStage; label: (research: boolean) => string }[] = [
  { key: 'reading', label: () => 'Leyendo las fotos' },
  { key: 'context', label: () => 'Buscando notas relacionadas' },
  { key: 'writing', label: (r) => (r ? 'Investigando y redactando' : 'Redactando') },
  { key: 'saving', label: () => 'Guardando la nota' },
]
const stageIndex = computed(() => STAGES.findIndex((s) => s.key === stage.value))

async function submit() {
  if (!canSubmit.value || !current.value) return
  phase.value = 'working'
  stage.value = 'reading'
  researching.value = research.value && canResearch.value
  error.value = ''

  const form = new FormData()
  form.append('workspaceId', current.value.id)
  form.append('research', String(researching.value))
  if (instructions.value.trim()) form.append('instructions', instructions.value.trim())
  for (const [i, p] of photos.value.entries()) {
    try {
      form.append('images', await preparePhoto(p.file), `foto-${i + 1}.jpg`)
    } catch {
      error.value = `No se pudo abrir la foto ${i + 1}. Prueba con una imagen JPEG o PNG.`
      phase.value = 'error'
      return
    }
  }

  try {
    const { document } = await sendPhotoNote(form, (s, r) => {
      stage.value = s
      researching.value = r
    })
    await Promise.all([refreshDocuments(), refreshWorkspaces(), refreshFolders(), refreshStatus()])
    const wasOpen = open.value
    open.value = false
    reset()
    if (wasOpen) {
      toast.add({ title: `«${document.title}» creada`, description: 'Revisa el contenido antes de darlo por bueno.', color: 'success', icon: 'i-lucide-sparkles' })
      await navigateTo(`/d/${document.id}`)
    } else {
      toast.add({
        title: `«${document.title}» creada`,
        description: 'La nota desde foto ya está en tu carpeta.',
        color: 'success',
        icon: 'i-lucide-sparkles',
        actions: [{ label: 'Abrir', color: 'neutral', variant: 'outline', onClick: () => navigateTo(`/d/${document.id}`) }],
      })
    }
  } catch (err) {
    const e = err as PhotoNoteError
    void refreshStatus()
    if (e.details?.reason === 'not_handwritten' && e.details.photos?.length) {
      rejected.value = e.details.photos
      error.value = e.message
      phase.value = 'rejected'
    } else {
      error.value = e.message || 'No se pudo crear la nota'
      phase.value = 'error'
    }
    if (!open.value) {
      toast.add({ title: 'No se pudo crear la nota desde foto', description: error.value, color: 'error', icon: 'i-lucide-circle-alert' })
    }
  }
}

/** Quita las fotos rechazadas y vuelve a elegir, con las demás ya puestas. */
function removeRejected() {
  const numbers = new Set(rejected.value.map((r) => r.photo))
  const keep = photos.value.filter((_, i) => !numbers.has(i + 1))
  for (const p of photos.value) if (!keep.includes(p)) URL.revokeObjectURL(p.url)
  photos.value = keep
  rejected.value = []
  phase.value = 'pick'
}

function cancel() {
  open.value = false
  if (phase.value !== 'working') reset()
}

const providerText = computed(() => {
  const who = status.value?.providerLabel ?? 'el proveedor de IA'
  const what = research.value && canResearch.value ? 'para transcribirlas e investigar en internet' : 'para transcribirlas'
  return `Las fotos se enviarán a ${who} ${what}, junto con el título y un fragmento de hasta 5 notas relacionadas. Las fotos no se guardan: solo queda la nota.`
})
</script>

<template>
  <UModal
    v-model:open="open"
    title="Nota desde foto"
    :description="phase === 'pick' ? `Fotos de apuntes escritos a mano (hasta ${maxPhotos}). La IA los transcribe y crea una nota en tu carpeta.` : undefined"
    :ui="{ footer: 'justify-end' }"
    :content="{ onFocusOutside: (e: Event) => e.preventDefault() }"
  >
    <template #body>
      <!-- Elegir fotos -->
      <div v-if="phase === 'pick'" class="space-y-4">
        <div v-if="photos.length" class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div v-for="(p, i) in photos" :key="p.id" class="relative aspect-[3/4] overflow-hidden rounded-md border border-default bg-muted">
            <img :src="p.url" :alt="`Foto ${i + 1}`" class="size-full object-cover" />
            <span class="absolute start-1 top-1 rounded bg-default/80 px-1.5 text-xs font-medium">{{ i + 1 }}</span>
            <UButton
              icon="i-lucide-x"
              size="xs"
              color="neutral"
              variant="solid"
              class="absolute end-1 top-1"
              :aria-label="`Quitar la foto ${i + 1}`"
              @click="removePhoto(i)"
            />
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <UButton
            icon="i-lucide-camera"
            label="Tomar foto"
            color="neutral"
            variant="outline"
            :disabled="photos.length >= maxPhotos"
            @click="cameraInput?.click()"
          />
          <UButton
            icon="i-lucide-images"
            label="Elegir imágenes"
            color="neutral"
            variant="outline"
            :disabled="photos.length >= maxPhotos"
            @click="filesInput?.click()"
          />
          <span class="self-center text-sm text-dimmed">{{ photos.length }} de {{ maxPhotos }}</span>
          <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" @change="addFiles" />
          <input ref="filesInput" type="file" accept="image/*,.heic,.heif" multiple class="hidden" @change="addFiles" />
        </div>

        <USwitch
          v-if="canResearch"
          v-model="research"
          label="Investigar en internet"
          description="Explica, completa y corrige lo necesario, siempre marcado y con sus fuentes."
        />

        <UFormField label="Indicaciones (opcional)" name="instructions">
          <UTextarea
            v-model="instructions"
            :rows="2"
            autoresize
            maxlength="1000"
            placeholder="Por ejemplo: «es para estudiar para el examen» o «céntrate en las fórmulas»"
            class="w-full"
          />
        </UFormField>

        <UAlert v-if="status && remaining === 0" color="warning" variant="subtle" icon="i-lucide-hourglass"
          :title="`Ya creaste ${status.dailyLimit} ${status.dailyLimit === 1 ? 'nota' : 'notas'} con IA hoy`"
          description="Es el máximo diario. Mañana podrás crear más."
        />
        <UAlert v-else color="neutral" variant="subtle" icon="i-lucide-shield" :description="providerText">
          <template v-if="status" #title>
            Te {{ remaining === 1 ? 'queda' : 'quedan' }} {{ remaining }} {{ remaining === 1 ? 'nota' : 'notas' }} con IA hoy
          </template>
        </UAlert>
      </div>

      <!-- Trabajando -->
      <div v-else-if="phase === 'working'" class="space-y-4">
        <ol class="space-y-2">
          <li v-for="(s, i) in STAGES" :key="s.key" class="flex items-center gap-2 text-sm">
            <UIcon v-if="i < stageIndex" name="i-lucide-circle-check" class="size-5 text-success" />
            <UIcon v-else-if="i === stageIndex" name="i-lucide-loader-circle" class="size-5 animate-spin text-primary" />
            <UIcon v-else name="i-lucide-circle" class="size-5 text-dimmed" />
            <span :class="i === stageIndex ? 'font-medium text-highlighted' : i < stageIndex ? 'text-muted' : 'text-dimmed'">
              {{ s.label(researching) }}
            </span>
          </li>
        </ol>
        <p class="text-sm text-muted">
          Puede tardar uno o dos minutos{{ researching ? ', más si investiga' : '' }}. Puedes cerrar esta ventana: la nota se
          creará igual y te avisaremos.
        </p>
      </div>

      <!-- Alguna foto no está escrita a mano -->
      <div v-else-if="phase === 'rejected'" class="space-y-4">
        <UAlert color="warning" variant="subtle" icon="i-lucide-pen-off" title="No es posible transcribir" :description="error" />
        <ul class="space-y-2">
          <li v-for="r in rejected" :key="r.photo" class="flex items-center gap-3">
            <img
              v-if="photos[r.photo - 1]"
              :src="photos[r.photo - 1]!.url"
              :alt="`Foto ${r.photo}`"
              class="size-14 shrink-0 rounded border border-default object-cover"
            />
            <div class="min-w-0 text-sm">
              <p class="font-medium text-highlighted">Foto {{ r.photo }}</p>
              <p class="text-muted">{{ r.reason }}</p>
            </div>
          </li>
        </ul>
        <p class="text-sm text-muted">Esta función solo transcribe apuntes escritos a mano. Este intento no cuenta para tu límite diario.</p>
      </div>

      <!-- Error -->
      <UAlert v-else color="error" variant="subtle" icon="i-lucide-circle-alert" title="No se pudo crear la nota" :description="error" />
    </template>

    <template #footer>
      <template v-if="phase === 'pick'">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="cancel" />
        <UButton icon="i-lucide-sparkles" label="Crear nota" :disabled="!canSubmit" @click="submit" />
      </template>
      <UButton v-else-if="phase === 'working'" label="Cerrar" color="neutral" variant="ghost" @click="open = false" />
      <template v-else-if="phase === 'rejected'">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="cancel" />
        <UButton
          :label="rejected.length === 1 ? 'Quitar esa foto' : 'Quitar esas fotos'"
          icon="i-lucide-image-minus"
          @click="removeRejected"
        />
      </template>
      <template v-else>
        <UButton label="Cerrar" color="neutral" variant="ghost" @click="cancel" />
        <UButton label="Volver" icon="i-lucide-arrow-left" @click="phase = 'pick'" />
      </template>
    </template>
  </UModal>
</template>
