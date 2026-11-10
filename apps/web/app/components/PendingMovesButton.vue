<script setup lang="ts">
/** Aviso en la barra lateral cuando un agente ha propuesto mover notas. */
defineProps<{ collapsed?: boolean }>()
const { pending, refresh } = usePendingMoves()

// Se actualiza solo: cada 20 s y al volver a la pestaña.
let timer: ReturnType<typeof setInterval> | undefined
const onFocus = () => void refresh()
onMounted(() => {
  timer = setInterval(onFocus, 20_000)
  window.addEventListener('focus', onFocus)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  window.removeEventListener('focus', onFocus)
})
</script>

<template>
  <UButton
    v-if="pending > 0"
    to="/moves"
    icon="i-lucide-folder-input"
    color="warning"
    variant="soft"
    block
    :square="collapsed"
    :label="collapsed ? undefined : `${pending} ${pending === 1 ? 'movimiento' : 'movimientos'} por aprobar`"
    :aria-label="`${pending} movimientos por aprobar`"
  />
</template>
