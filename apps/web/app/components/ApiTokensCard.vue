<script setup lang="ts">
interface TokenRow {
  id: string
  name: string
  prefix: string
  scope: 'read' | 'write'
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
}

const toast = useToast()
const { data: tokens, refresh } = await useFetch<TokenRow[]>('/api/tokens', { default: () => [] })

const scopeItems = [
  { label: 'Solo lectura', value: 'read', description: 'Listar, buscar y leer notas' },
  { label: 'Lectura y escritura', value: 'write', description: 'También crear y modificar notas' },
]
const expiryItems = [
  { label: '30 días', value: 30 },
  { label: '90 días', value: 90 },
  { label: '1 año', value: 365 },
  { label: 'Sin caducidad', value: 0 },
]

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' })
const fmt = (d: string | null) => (d ? dateFormat.format(new Date(d)) : null)
const isExpired = (t: TokenRow) => !!t.expiresAt && new Date(t.expiresAt) < new Date()

// --- Crear ---
const createOpen = ref(false)
const form = reactive({ name: '', scope: 'read' as 'read' | 'write', expiresInDays: 90 })
const createError = ref('')
const creating = ref(false)
const newToken = ref<string | null>(null)
const origin = import.meta.client ? window.location.origin : ''
const cliCommands = computed(() =>
  newToken.value
    ? [
        `curl -fsSL ${origin}/cli/wick.mjs -o ~/.local/bin/wick && chmod +x ~/.local/bin/wick`,
        `wick login --server ${origin} --token ${newToken.value}`,
      ].join('\n')
    : '',
)

function openCreate() {
  Object.assign(form, { name: '', scope: 'read', expiresInDays: 90 })
  createError.value = ''
  newToken.value = null
  createOpen.value = true
}

async function submitCreate() {
  createError.value = ''
  creating.value = true
  try {
    const result = await $fetch<{ token: string }>('/api/tokens', {
      method: 'POST',
      body: { name: form.name, scope: form.scope, expiresInDays: form.expiresInDays || null },
    })
    newToken.value = result.token
    await refresh()
  } catch (err) {
    createError.value = apiErrorMessage(err)
  } finally {
    creating.value = false
  }
}

async function copyToken() {
  if (!newToken.value) return
  try {
    await navigator.clipboard.writeText(newToken.value)
    toast.add({ title: 'Token copiado', color: 'success', icon: 'i-lucide-clipboard-check' })
  } catch {
    toast.add({ title: 'No se pudo copiar', description: 'Selecciona el token y cópialo a mano.', color: 'warning' })
  }
}

// --- Revocar ---
const revokeTarget = ref<TokenRow | null>(null)
const revoking = ref(false)

async function confirmRevoke() {
  if (!revokeTarget.value) return
  revoking.value = true
  try {
    const url: string = `/api/tokens/${revokeTarget.value.id}`
    await $fetch(url, { method: 'DELETE' })
    toast.add({ title: `Token «${revokeTarget.value.name}» revocado`, color: 'success', icon: 'i-lucide-check' })
    revokeTarget.value = null
    await refresh()
  } catch (err) {
    toast.add({ title: 'No se pudo revocar', description: apiErrorMessage(err), color: 'error' })
  } finally {
    revoking.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold text-highlighted">Tokens de acceso</h2>
          <p class="text-sm text-muted">
            Para usar tus notas desde la terminal (CLI), agentes de IA (MCP) o scripts. Solo dan acceso a las notas.
          </p>
        </div>
        <UButton icon="i-lucide-plus" label="Nuevo token" color="neutral" variant="outline" class="shrink-0" @click="openCreate" />
      </div>
    </template>

    <p v-if="!tokens.length" class="text-sm text-dimmed">No tienes tokens.</p>
    <ul v-else class="-my-2 divide-y divide-default">
      <li v-for="t in tokens" :key="t.id" class="flex items-center gap-3 py-3">
        <UIcon name="i-lucide-key-round" class="size-5 shrink-0 text-dimmed" />
        <div class="min-w-0 flex-1">
          <p class="flex flex-wrap items-center gap-1.5 font-medium text-highlighted">
            <span class="truncate">{{ t.name }}</span>
            <UBadge :color="t.scope === 'write' ? 'warning' : 'neutral'" variant="subtle" size="sm" :label="t.scope === 'write' ? 'Escritura' : 'Lectura'" />
            <UBadge v-if="isExpired(t)" color="error" variant="subtle" size="sm" label="Caducado" />
          </p>
          <p class="truncate text-xs text-muted">
            <code>{{ t.prefix }}…</code> · creado {{ fmt(t.createdAt) }} ·
            {{ t.lastUsedAt ? `usado ${fmt(t.lastUsedAt)}` : 'sin usar' }} ·
            {{ t.expiresAt ? `caduca ${fmt(t.expiresAt)}` : 'no caduca' }}
          </p>
        </div>
        <UButton
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          :aria-label="`Revocar ${t.name}`"
          @click="revokeTarget = t"
        />
      </li>
    </ul>
  </UCard>

  <UModal
    v-model:open="createOpen"
    :title="newToken ? 'Token creado' : 'Nuevo token de acceso'"
    :dismissible="!newToken"
  >
    <template #body>
      <div v-if="newToken" class="space-y-3">
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Cópialo ahora: no volverás a verlo."
          description="Trátalo como una contraseña. Si se filtra, revócalo."
        />
        <div class="flex gap-2">
          <UInput :model-value="newToken" readonly class="flex-1 font-mono" aria-label="Token" @focus="($event.target as HTMLInputElement).select()" />
          <UButton icon="i-lucide-copy" label="Copiar" @click="copyToken" />
        </div>
        <div class="space-y-1.5 pt-2">
          <p class="text-sm font-medium text-highlighted">Usarlo con la CLI (macOS y Linux, requiere Node 20+)</p>
          <pre class="overflow-x-auto rounded-md bg-elevated p-3 text-xs leading-relaxed"><code>{{ cliCommands }}</code></pre>
          <p class="text-xs text-muted">
            En Windows: descarga <a :href="`${origin}/cli/wick.mjs`" class="underline">wick.mjs</a> y ejecútalo con
            <code>node wick.mjs login …</code>
          </p>
        </div>
      </div>
      <form v-else id="create-token" class="space-y-4" @submit.prevent="submitCreate">
        <UAlert v-if="createError" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="createError" />
        <UFormField label="Nombre" name="name" help="Para reconocerlo, p. ej. «CLI del portátil» o «Claude Code».">
          <UInput v-model="form.name" required autofocus class="w-full" />
        </UFormField>
        <UFormField label="Permisos" name="scope">
          <USelect v-model="form.scope" :items="scopeItems" class="w-full" />
        </UFormField>
        <UFormField label="Caducidad" name="expires">
          <USelect v-model="form.expiresInDays" :items="expiryItems" class="w-full" />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <template v-if="newToken">
          <UButton label="Hecho" @click="createOpen = false" />
        </template>
        <template v-else>
          <UButton label="Cancelar" color="neutral" variant="ghost" @click="createOpen = false" />
          <UButton type="submit" form="create-token" label="Crear token" :loading="creating" />
        </template>
      </div>
    </template>
  </UModal>

  <UModal
    :open="!!revokeTarget"
    :title="`¿Revocar «${revokeTarget?.name ?? ''}»?`"
    description="Lo que use este token dejará de funcionar al momento."
    @update:open="(open) => !open && (revokeTarget = null)"
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="revokeTarget = null" />
        <UButton label="Revocar" color="error" icon="i-lucide-trash-2" :loading="revoking" @click="confirmRevoke" />
      </div>
    </template>
  </UModal>
</template>
