<script setup lang="ts">
/**
 * Chuleta de Markdown con buscador. Panel lateral sin bloquear la página, para
 * consultarla mientras se escribe. Se abre con useHelp().toggleMarkdownGuide().
 * Solo lista lo que entiende el editor (CommonMark + GFM).
 */
interface Entry {
  title: string
  syntax: string
  description: string
  /** Atajo del editor, si lo hay (teclas para UKbd). */
  keys?: string[]
  /** Otras palabras por las que buscarlo (también en inglés). */
  keywords: string
}

const toast = useToast()
const query = ref('')

const groups: { title: string; entries: Entry[] }[] = [
  {
    title: 'Texto',
    entries: [
      { title: 'Negrita', syntax: '**texto**', description: 'Resalta una palabra o frase.', keys: ['meta', 'B'], keywords: 'bold fuerte strong resaltar' },
      { title: 'Cursiva', syntax: '*texto*', description: 'También vale _texto_.', keys: ['meta', 'I'], keywords: 'italic enfasis emphasis' },
      { title: 'Tachado', syntax: '~~texto~~', description: 'Para lo que ya no vale o está hecho.', keys: ['meta', 'shift', 'X'], keywords: 'strikethrough tachar' },
      { title: 'Código en línea', syntax: '`código`', description: 'Comandos, nombres de archivo o valores dentro de una frase.', keys: ['meta', 'E'], keywords: 'inline code monoespaciado backtick' },
      { title: 'Salto de línea', syntax: 'primera línea\\\nsegunda línea', description: 'Una barra invertida al final corta la línea sin empezar un párrafo nuevo.', keywords: 'line break br nueva linea' },
      { title: 'Escapar un símbolo', syntax: '\\*no es cursiva\\*', description: 'Una barra invertida delante muestra el símbolo tal cual.', keywords: 'escape literal barra invertida backslash' },
    ],
  },
  {
    title: 'Estructura',
    entries: [
      { title: 'Encabezados', syntax: '# Título\n## Sección\n### Apartado', description: 'De # a ######: cuantas más almohadillas, más pequeño.', keywords: 'heading titulo h1 h2 h3 almohadilla hash' },
      { title: 'Párrafos', syntax: 'Un párrafo.\n\nOtro párrafo.', description: 'Deja una línea en blanco entre párrafos.', keywords: 'paragraph parrafo' },
      { title: 'Cita', syntax: '> Texto citado', description: 'Al pulsar Enter, la línea siguiente sigue en la cita.', keywords: 'quote blockquote' },
      { title: 'Separador', syntax: '---', description: 'Una línea horizontal entre secciones.', keywords: 'horizontal rule hr linea divisor' },
    ],
  },
  {
    title: 'Listas',
    entries: [
      { title: 'Lista con viñetas', syntax: '- Elemento\n- Otro elemento', description: 'También con * o +. Enter añade otro elemento.', keywords: 'bullet list unordered vinetas puntos' },
      { title: 'Lista numerada', syntax: '1. Primero\n2. Segundo', description: 'Enter sigue la numeración.', keywords: 'numbered ordered list numeros' },
      { title: 'Lista anidada', syntax: '- Fruta\n  - Manzana\n  - Pera', description: 'Sangra el elemento con Tab (Shift + Tab para quitarla).', keywords: 'nested sublista sangria indent' },
      { title: 'Lista de tareas', syntax: '- [ ] Pendiente\n- [x] Hecha', description: 'En el editor se ve como casilla: un clic la marca o desmarca.', keywords: 'task todo checkbox casilla pendiente checklist' },
    ],
  },
  {
    title: 'Enlaces e imágenes',
    entries: [
      { title: 'Enlace', syntax: '[texto](https://ejemplo.com)', description: 'Ctrl/⌘ + clic lo abre. Pegar una URL sobre texto seleccionado también crea el enlace.', keys: ['meta', 'K'], keywords: 'link url vinculo hipervinculo' },
      { title: 'Enlace directo', syntax: '<https://ejemplo.com>', description: 'Una URL que empieza por https:// o www. ya funciona como enlace.', keywords: 'autolink url' },
      { title: 'Imagen', syntax: '![Descripción](https://ejemplo.com/foto.png)', description: 'El editor la muestra si la URL empieza por https:// (o http://). Al poner el cursor encima reaparece el texto para editarlo.', keywords: 'image picture foto img' },
    ],
  },
  {
    title: 'Código y tablas',
    entries: [
      { title: 'Bloque de código', syntax: '```bash\ndocker compose ps\n```', description: 'Indica el lenguaje tras las comillas para colorear el código.', keywords: 'code block fence snippet bash js' },
      { title: 'Tabla', syntax: '| Nombre | Puerto |\n| --- | ---: |\n| web | 3120 |', description: 'La segunda fila separa la cabecera. Con : se alinea (---: a la derecha, :---: al centro).', keywords: 'table columnas filas pipe' },
    ],
  },
]

/** Minúsculas y sin acentos, para que «codigo» encuentre «Código». */
const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

const filtered = computed(() => {
  const terms = normalize(query.value).split(/\s+/).filter(Boolean)
  if (!terms.length) return groups
  return groups
    .map((g) => ({
      ...g,
      entries: g.entries.filter((e) => {
        const haystack = normalize(`${e.title} ${e.keywords} ${e.description} ${e.syntax}`)
        return terms.every((t) => haystack.includes(t))
      }),
    }))
    .filter((g) => g.entries.length)
})

async function copy(entry: Entry) {
  try {
    await navigator.clipboard.writeText(entry.syntax)
    toast.add({ title: `${entry.title}: copiado`, icon: 'i-lucide-clipboard-check', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo copiar', description: 'Selecciona el ejemplo y cópialo a mano.', color: 'warning' })
  }
}
</script>

<template>
  <USlideover
    title="Guía de Markdown"
    description="Los símbolos para dar formato. Puedes seguir escribiendo con la guía abierta."
    :modal="false"
    :overlay="false"
    :dismissible="false"
    :ui="{ content: 'max-w-md' }"
  >
    <template #body>
      <div class="space-y-5">
        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Buscar: negrita, tabla, **, enlace…"
          aria-label="Buscar en la guía de Markdown"
          autofocus
          class="w-full"
        >
          <template v-if="query" #trailing>
            <UButton icon="i-lucide-x" color="neutral" variant="link" size="sm" aria-label="Borrar búsqueda" @click="query = ''" />
          </template>
        </UInput>

        <UEmpty
          v-if="!filtered.length"
          icon="i-lucide-search-x"
          :title="`Nada coincide con «${query.trim()}»`"
          description="Prueba con otra palabra, en español o en inglés, o con el símbolo."
        />

        <section v-for="group in filtered" :key="group.title" class="space-y-2">
          <h3 class="text-xs font-semibold tracking-wide text-muted uppercase">{{ group.title }}</h3>
          <ul class="space-y-2">
            <li v-for="entry in group.entries" :key="entry.title" class="rounded-md border border-default p-3">
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-medium text-highlighted">{{ entry.title }}</span>
                <span class="flex items-center gap-1">
                  <span v-if="entry.keys" class="me-1 flex items-center gap-0.5">
                    <UKbd v-for="key in entry.keys" :key="key" :value="key" size="sm" />
                  </span>
                  <UButton
                    icon="i-lucide-copy"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :aria-label="`Copiar ${entry.title}`"
                    @click="copy(entry)"
                  />
                </span>
              </div>
              <pre class="mt-2 overflow-x-auto rounded bg-elevated px-2.5 py-2 font-mono text-xs leading-relaxed text-default"><code>{{ entry.syntax }}</code></pre>
              <p class="mt-1.5 text-xs text-muted">{{ entry.description }}</p>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </USlideover>
</template>
