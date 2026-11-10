<script setup lang="ts">
/** Diálogo sencillo para pedir un nombre (carpetas, espacios…). */
const props = defineProps<{ title: string; label: string; confirmLabel: string; initial?: string; description?: string }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ submit: [name: string] }>()

const name = ref('')
watch(open, (isOpen) => {
  if (isOpen) name.value = props.initial ?? ''
})

function submit() {
  const value = name.value.trim()
  if (!value) return
  emit('submit', value)
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="title" :description="description">
    <template #body>
      <form id="name-dialog" @submit.prevent="submit">
        <UFormField :label="label" name="name">
          <UInput v-model="name" required autofocus maxlength="120" class="w-full" />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="open = false" />
        <UButton type="submit" form="name-dialog" :label="confirmLabel" />
      </div>
    </template>
  </UModal>
</template>
