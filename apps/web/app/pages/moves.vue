<script setup lang="ts">
interface Place {
  workspaceId: string
  workspaceName: string
  folderId: string | null
  path: string
}
interface MoveRequest {
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'failed' | 'superseded'
  reason: string | null
  createdAt: string
  decidedAt: string | null
  error: string | null
  document: { id: string; title: string }
  from: Place
  to: Place
  agent: string | null
  decidedBy: { id: string; name: string } | null
}

useHead({ title: 'Movimientos propuestos' })
const toast = useToast()
const { refresh: refreshCount } = usePendingMoves()
const { refreshAll } = useDocuments()
const { refreshFolders } = useWorkspaces()
const { handleUnauthorized } = useAuth()

const { data: requests, refresh } = await useFetch<MoveRequest[]>('/api/move-requests', { default: () => [] })
const pending = computed(() => requests.value.filter((r) => r.status === 'pending'))
const history = computed(() => requests.value.filter((r) => r.status !== 'pending'))

const STATUS: Record<MoveRequest['status'], { label: string; color: 'success' | 'neutral' | 'error' | 'warning' }> = {
  pending: { label: 'Pendiente', color: 'warning' },
  approved: { label: 'Aprobada', color: 'success' },
  rejected: { label: 'Rechazada', color: 'neutral' },
  failed: { label: 'No se pudo mover', color: 'error' },
  superseded: { label: 'Sustituida', color: 'neutral' },
}
const fmt = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' })

const busy = ref<Set<string>>(new Set())
async function decide(r: MoveRequest, decision: 'approve' | 'reject', quiet = false) {
  busy.value = new Set(busy.value).add(r.id)
  try {
    const url: string = `/api/move-requests/${r.id}/${decision}`
    const done = await $fetch<MoveRequest>(url, { method: 'POST' })
    if (!quiet) {
      if (done.status === 'approved') toast.add({ title: `«${r.document.title}» movida a ${r.to.path}`, color: 'success', icon: 'i-lucide-check' })
      else if (done.status === 'failed') toast.add({ title: 'No se pudo mover', description: done.error ?? undefined, color: 'error' })
      else toast.add({ title: 'Solicitud rechazada', color: 'neutral' })
    }
    return done
  } catch (err) {
    if (apiErrorStatus(err) === 401) await handleUnauthorized()
    else toast.add({ title: 'Error', description: apiErrorMessage(err), color: 'error' })
  } finally {
    const next = new Set(busy.value)
    next.delete(r.id)
    busy.value = next
  }
}

async function afterChanges() {
  await Promise.all([refresh(), refreshCount(), refreshAll(), refreshFolders()])
}

async function decideOne(r: MoveRequest, decision: 'approve' | 'reject') {
  await decide(r, decision)
  await afterChanges()
}

async function approveAll() {
  const list = [...pending.value]
  let ok = 0
  for (const r of list) if ((await decide(r, 'approve', true))?.status === 'approved') ok++
  toast.add({ title: `${ok} de ${list.length} notas movidas`, color: ok === list.length ? 'success' : 'warning', icon: 'i-lucide-check' })
  await afterChanges()
}
</script>

<template>
  <UDashboardPanel id="moves">
    <template #header>
      <UDashboardNavbar title="Movimientos propuestos">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            v-if="pending.length > 1"
            icon="i-lucide-check-check"
            :label="`Aprobar todas (${pending.length})`"
            @click="approveAll"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-3xl space-y-6">
        <p class="text-sm text-muted">
          Los agentes conectados por MCP con tus tokens no mueven notas por su cuenta: lo proponen y tú decides aquí. Al
          aprobar se mueve con tus permisos.
        </p>

        <UEmpty
          v-if="!pending.length"
          icon="i-lucide-folder-check"
          title="No hay movimientos pendientes"
          description="Cuando un agente proponga mover una nota, aparecerá aquí."
        />

        <ul v-else class="space-y-3">
          <li v-for="r in pending" :key="r.id">
            <UCard>
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0 flex-1 space-y-1">
                  <NuxtLink :to="`/d/${r.document.id}`" class="font-medium text-highlighted hover:underline">
                    {{ r.document.title }}
                  </NuxtLink>
                  <p class="flex flex-wrap items-center gap-1.5 text-sm">
                    <span class="text-muted">{{ r.from.path }}</span>
                    <UIcon name="i-lucide-arrow-right" class="size-4 text-dimmed" />
                    <span class="font-medium text-highlighted">{{ r.to.path }}</span>
                  </p>
                  <p v-if="r.reason" class="text-sm text-default">«{{ r.reason }}»</p>
                  <p class="text-xs text-dimmed">
                    {{ r.agent ? `Propuesto por ${r.agent}` : 'Propuesto por un agente' }} · {{ fmt.format(new Date(r.createdAt)) }}
                  </p>
                </div>
                <div class="flex gap-2">
                  <UButton
                    label="Rechazar"
                    color="neutral"
                    variant="outline"
                    :disabled="busy.has(r.id)"
                    :aria-label="`Rechazar mover ${r.document.title}`"
                    @click="decideOne(r, 'reject')"
                  />
                  <UButton
                    label="Aprobar"
                    icon="i-lucide-check"
                    :loading="busy.has(r.id)"
                    :aria-label="`Aprobar mover ${r.document.title}`"
                    @click="decideOne(r, 'approve')"
                  />
                </div>
              </div>
            </UCard>
          </li>
        </ul>

        <section v-if="history.length" class="space-y-2">
          <h2 class="text-sm font-medium text-muted">Historial</h2>
          <ul class="divide-y divide-default rounded-md border border-default">
            <li v-for="r in history" :key="r.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <UBadge :label="STATUS[r.status].label" :color="STATUS[r.status].color" variant="subtle" size="sm" />
              <span class="min-w-0 truncate font-medium text-highlighted">{{ r.document.title }}</span>
              <span class="truncate text-muted">→ {{ r.to.path }}</span>
              <span v-if="r.error" class="text-error">{{ r.error }}</span>
              <span class="ms-auto text-xs text-dimmed">{{ r.decidedAt ? fmt.format(new Date(r.decidedAt)) : '' }}</span>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
