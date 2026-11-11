<script setup lang="ts">
definePageMeta({ admin: true })
useHead({ title: 'Inteligencia artificial' })

/** Ajustes tal como los devuelve la API (la clave nunca viene completa). */
interface AiSettings {
  enabled: boolean
  provider: 'anthropic'
  providerLabel: string
  model: string
  webSearch: boolean
  maxSearches: number
  dailyLimit: number
  hasApiKey: boolean
  apiKeyHint: string | null
  apiKeyUnreadable: boolean
  updatedAt: string | null
}

const toast = useToast()
const { handleUnauthorized } = useAuth()
const { refresh: refreshStatus } = useAiStatus()
const { data: settings, refresh } = await useFetch<AiSettings>('/api/ai/settings')

const state = reactive({
  enabled: false,
  provider: 'anthropic' as const,
  apiKey: '',
  model: '',
  webSearch: true,
  maxSearches: 5,
  dailyLimit: 10,
})
watch(
  settings,
  (s) => {
    if (!s) return
    Object.assign(state, { enabled: s.enabled, provider: s.provider, model: s.model, webSearch: s.webSearch, maxSearches: s.maxSearches, dailyLimit: s.dailyLimit, apiKey: '' })
  },
  { immediate: true },
)

const providerItems = [{ label: 'Anthropic (Claude)', value: 'anthropic' }]
const keyPlaceholder = computed(() => {
  const s = settings.value
  if (!s?.hasApiKey || s.apiKeyUnreadable) return 'sk-ant-…'
  return s.apiKeyHint ? `Guardada (termina en ${s.apiKeyHint}). Escribe otra para cambiarla.` : 'Guardada. Escribe otra para cambiarla.'
})

function fail(err: unknown, title: string) {
  if (apiErrorStatus(err) === 401) return handleUnauthorized()
  toast.add({ title, description: apiErrorMessage(err), color: 'error', icon: 'i-lucide-circle-alert' })
}

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch('/api/ai/settings', {
      method: 'PUT',
      body: {
        enabled: state.enabled,
        provider: state.provider,
        model: state.model,
        webSearch: state.webSearch,
        maxSearches: state.maxSearches,
        dailyLimit: state.dailyLimit,
        ...(state.apiKey.trim() ? { apiKey: state.apiKey.trim() } : {}),
      },
    })
    await Promise.all([refresh(), refreshStatus()])
    toast.add({ title: 'Ajustes guardados', color: 'success', icon: 'i-lucide-check' })
  } catch (err) {
    await fail(err, 'No se pudieron guardar los ajustes')
  } finally {
    saving.value = false
  }
}

const testing = ref(false)
async function test() {
  testing.value = true
  try {
    const r = await $fetch<{ model: string }>('/api/ai/test', {
      method: 'POST',
      body: { provider: state.provider, model: state.model, ...(state.apiKey.trim() ? { apiKey: state.apiKey.trim() } : {}) },
    })
    toast.add({ title: 'Conexión correcta', description: `La clave funciona con el modelo ${r.model}.`, color: 'success', icon: 'i-lucide-plug-zap' })
  } catch (err) {
    await fail(err, 'La conexión falló')
  } finally {
    testing.value = false
  }
}

async function removeKey() {
  try {
    await $fetch('/api/ai/settings', { method: 'PUT', body: { enabled: false, apiKey: null } })
    await Promise.all([refresh(), refreshStatus()])
    toast.add({ title: 'Clave borrada', description: '«Nota desde foto» queda desactivada.', color: 'success', icon: 'i-lucide-trash-2' })
  } catch (err) {
    await fail(err, 'No se pudo borrar la clave')
  }
}
</script>

<template>
  <UDashboardPanel id="admin-ai">
    <template #header>
      <UDashboardNavbar title="Inteligencia artificial">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-2xl space-y-6">
        <p class="text-sm text-muted">
          La IA es opcional: wick funciona igual sin ella. Al activarla aparece «Nota desde foto», que convierte fotos de
          apuntes escritos a mano en notas. Las fotos se envían al proveedor elegido junto con el título y un fragmento de
          hasta 5 notas relacionadas, y no se guardan. Cada nota cuesta, aproximadamente, entre 0,20 y 0,50 USD con
          investigación.
        </p>

        <UAlert
          v-if="settings?.apiKeyUnreadable"
          color="warning"
          variant="subtle"
          icon="i-lucide-key-round"
          title="La clave guardada ya no se puede leer"
          description="Cambió la clave maestra del servidor (WICK_SECRET_KEY o DATABASE_URL). Escribe la clave de API otra vez y guarda."
        />

        <UForm :state="state" class="space-y-6" @submit="save">
          <UCard>
            <template #header>
              <h2 class="font-semibold text-highlighted">Nota desde foto</h2>
            </template>
            <div class="space-y-4">
              <USwitch
                v-model="state.enabled"
                label="Activar «Nota desde foto»"
                description="Apagada, el botón no aparece y la API la rechaza."
              />
              <UFormField label="Proveedor" name="provider">
                <USelect v-model="state.provider" :items="providerItems" class="w-full" />
              </UFormField>
              <UFormField label="Clave de API" name="apiKey" help="Se guarda cifrada y no se vuelve a mostrar.">
                <UInput v-model="state.apiKey" type="password" autocomplete="off" :placeholder="keyPlaceholder" class="w-full" />
              </UFormField>
              <UFormField label="Modelo" name="model">
                <UInput v-model="state.model" class="w-full" />
              </UFormField>
              <div class="flex flex-wrap gap-2">
                <UButton icon="i-lucide-plug-zap" label="Probar conexión" color="neutral" variant="outline" :loading="testing" @click="test" />
                <UButton
                  v-if="settings?.hasApiKey"
                  icon="i-lucide-trash-2"
                  label="Borrar clave"
                  color="error"
                  variant="ghost"
                  @click="removeKey"
                />
              </div>
            </div>
          </UCard>

          <UCard>
            <template #header>
              <h2 class="font-semibold text-highlighted">Límites</h2>
            </template>
            <div class="space-y-4">
              <USwitch
                v-model="state.webSearch"
                label="Permitir investigar en internet"
                description="La IA busca para explicar, completar o corregir, siempre con fuentes. Cada búsqueda tiene un costo."
              />
              <UFormField v-if="state.webSearch" label="Búsquedas máximas por nota" name="maxSearches">
                <UInputNumber v-model="state.maxSearches" :min="1" :max="20" />
              </UFormField>
              <UFormField label="Notas con IA por usuario y día" name="dailyLimit" help="El cupo se reinicia a medianoche.">
                <UInputNumber v-model="state.dailyLimit" :min="1" :max="1000" />
              </UFormField>
            </div>
          </UCard>

          <div class="flex justify-end">
            <UButton type="submit" label="Guardar" :loading="saving" />
          </div>
        </UForm>
      </div>
    </template>
  </UDashboardPanel>
</template>
