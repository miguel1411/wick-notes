<script setup lang="ts">
import type { FormError } from '@nuxt/ui'

/** Diálogo sencillo para pedir un nombre (carpetas, espacios…). */
const props = defineProps<{ title: string; label: string; confirmLabel: string; initial?: string; description?: string }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ submit: [name: string] }>()

const formId = useId()
const state = reactive({ name: '' })
watch(open, (isOpen) => {
  if (isOpen) state.name = props.initial ?? ''
})

const validate = (s: typeof state): FormError[] => (s.name.trim() ? [] : [{ name: 'name', message: 'Escribe un nombre' }])

function submit() {
  emit('submit', state.name.trim())
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="title" :description="description" :ui="{ footer: 'justify-end' }">
    <template #body>
      <UForm :id="formId" :state="state" :validate="validate" @submit="submit">
        <UFormField :label="label" name="name">
          <UInput v-model="state.name" autofocus maxlength="120" class="w-full" />
        </UFormField>
      </UForm>
    </template>
    <template #footer="{ close }">
      <UButton label="Cancelar" color="neutral" variant="ghost" @click="close" />
      <UButton type="submit" :form="formId" :label="confirmLabel" />
    </template>
  </UModal>
</template>
