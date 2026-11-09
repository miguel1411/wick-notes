<script setup lang="ts">
const props = defineProps<{ status: SyncStatus }>()

const view = computed(() => {
  switch (props.status) {
    case 'connecting':
      return { label: 'Conectando…', icon: 'i-lucide-loader-circle', color: 'neutral' as const, spin: true, hint: '' }
    case 'syncing':
      return { label: 'Sincronizando…', icon: 'i-lucide-refresh-cw', color: 'neutral' as const, spin: true, hint: '' }
    case 'synced':
      return {
        label: 'Sincronizado',
        icon: 'i-lucide-cloud-check',
        color: 'success' as const,
        spin: false,
        hint: 'Todos los cambios llegaron al servidor',
      }
    case 'offline':
      return {
        label: 'Sin conexión',
        icon: 'i-lucide-cloud-off',
        color: 'warning' as const,
        spin: false,
        hint: 'Puedes seguir escribiendo: los cambios se enviarán al reconectar',
      }
    case 'unavailable':
      return {
        label: 'No disponible',
        icon: 'i-lucide-circle-alert',
        color: 'error' as const,
        spin: false,
        hint: 'El documento no existe o fue eliminado',
      }
  }
})
</script>

<template>
  <UTooltip :text="view.hint" :disabled="!view.hint">
    <UBadge :color="view.color" variant="subtle" size="md" class="gap-1.5" role="status" aria-live="polite">
      <UIcon :name="view.icon" class="size-4" :class="{ 'animate-spin': view.spin }" />
      <span class="hidden sm:inline">{{ view.label }}</span>
    </UBadge>
  </UTooltip>
</template>
