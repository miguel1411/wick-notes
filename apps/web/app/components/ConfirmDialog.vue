<script setup lang="ts">
import type { ConfirmDialogOptions } from '~/composables/useConfirmDialog'

/** Diálogo de confirmación. Se abre con useConfirmDialog(), no directamente. */
const props = withDefaults(defineProps<ConfirmDialogOptions>(), { color: 'primary' })
const emit = defineEmits<{ close: [confirmed: boolean] }>()

const running = ref(false)

async function confirm() {
  running.value = true
  try {
    if ((await props.action?.()) === false) return
    emit('close', true)
  } finally {
    running.value = false
  }
}
</script>

<template>
  <UModal
    :title="title"
    :description="description"
    :dismissible="!running"
    :close="{ disabled: running }"
    :ui="{ footer: 'justify-end' }"
  >
    <template #footer>
      <UButton label="Cancelar" color="neutral" variant="ghost" :disabled="running" @click="emit('close', false)" />
      <UButton :label="confirmLabel" :icon="confirmIcon" :color="color" :loading="running" @click="confirm" />
    </template>
  </UModal>
</template>
