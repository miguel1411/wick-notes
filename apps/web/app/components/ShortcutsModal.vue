<script setup lang="ts">
/**
 * Atajos de teclado de la app. Se abre con useHelp().openShortcuts() o con «?».
 * Las combinaciones salen de editor/setup.ts, del keymap por defecto de CodeMirror
 * y de y-codemirror (deshacer/rehacer): si cambian allí, hay que cambiarlas aquí.
 */
interface Shortcut {
  label: string
  /** Una o varias combinaciones alternativas; cada una es una lista de teclas para UKbd. */
  keys: string[][]
}

const sections: { title: string; description?: string; items: Shortcut[] }[] = [
  {
    title: 'Formato',
    description: 'En el editor. Con texto seleccionado, lo envuelven; sin selección, dejan el cursor listo para escribir.',
    items: [
      { label: 'Negrita', keys: [['meta', 'B']] },
      { label: 'Cursiva', keys: [['meta', 'I']] },
      { label: 'Tachado', keys: [['meta', 'shift', 'X']] },
      { label: 'Código en línea', keys: [['meta', 'E']] },
      { label: 'Enlace', keys: [['meta', 'K']] },
    ],
  },
  {
    title: 'Edición',
    items: [
      { label: 'Deshacer (solo tus cambios)', keys: [['meta', 'Z']] },
      { label: 'Rehacer', keys: [['meta', 'shift', 'Z']] },
      { label: 'Seguir la lista o la cita en la línea siguiente', keys: [['enter']] },
      { label: 'Sangrar / quitar sangría', keys: [['tab'], ['shift', 'tab']] },
      { label: 'Mover la línea', keys: [['alt', 'arrowup'], ['alt', 'arrowdown']] },
      { label: 'Duplicar la línea', keys: [['shift', 'alt', 'arrowup'], ['shift', 'alt', 'arrowdown']] },
      { label: 'Borrar la línea', keys: [['meta', 'shift', 'K']] },
      { label: 'Añadir un cursor arriba / abajo', keys: [['meta', 'alt', 'arrowup'], ['meta', 'alt', 'arrowdown']] },
      { label: 'Seleccionar todo', keys: [['meta', 'A']] },
      { label: 'Abrir un enlace en otra pestaña', keys: [['meta', 'clic']] },
    ],
  },
  {
    title: 'En toda la app',
    description: 'Fuera del editor y de los campos de texto.',
    items: [
      { label: 'Buscar notas', keys: [['meta', 'K']] },
      { label: 'Ver estos atajos', keys: [['?']] },
      { label: 'Cerrar un diálogo', keys: [['escape']] },
    ],
  },
]
</script>

<template>
  <UModal title="Atajos de teclado" :ui="{ content: 'sm:max-w-xl' }">
    <template #body>
      <div class="space-y-6">
        <section v-for="section in sections" :key="section.title" class="space-y-2">
          <div>
            <h3 class="text-sm font-semibold text-highlighted">{{ section.title }}</h3>
            <p v-if="section.description" class="text-xs text-muted">{{ section.description }}</p>
          </div>
          <ul class="divide-y divide-default">
            <li v-for="item in section.items" :key="item.label" class="flex items-center justify-between gap-4 py-1.5 text-sm">
              <span class="text-default">{{ item.label }}</span>
              <span class="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                <template v-for="(combo, i) in item.keys" :key="i">
                  <span v-if="i > 0" class="text-xs text-dimmed">/</span>
                  <span class="flex items-center gap-0.5">
                    <UKbd v-for="key in combo" :key="key" :value="key" />
                  </span>
                </template>
              </span>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </UModal>
</template>
