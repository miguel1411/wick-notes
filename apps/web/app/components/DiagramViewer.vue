<script setup lang="ts">
/**
 * Visor de diagramas a pantalla completa. Lo abre el editor (botón «Ampliar» o
 * clic en un diagrama) con un evento de ventana. Zoom con la rueda, los botones,
 * el teclado (+, −, 0) o pellizcando; se mueve arrastrando.
 */

const open = ref(false)
const viewport = ref<HTMLElement>()
const stage = ref<HTMLElement>()
const svgMarkup = ref('')

const scale = ref(1)
const x = ref(0)
const y = ref(0)
const MIN = 0.1
const MAX = 8
const clamp = (s: number) => Math.min(MAX, Math.max(MIN, s))
const natural = { width: 0, height: 0 }

function onOpen(event: Event) {
  const { svg, id } = (event as CustomEvent<OpenDiagramDetail>).detail
  // Otro id: el diagrama sigue también en la nota, y sus marcadores (flechas) usan url(#id).
  svgMarkup.value = svg.split(id).join(`${id}-visor`)
  open.value = true
  void nextTick(() => requestAnimationFrame(fit))
}

onMounted(() => window.addEventListener(OPEN_DIAGRAM_EVENT, onOpen))
onBeforeUnmount(() => window.removeEventListener(OPEN_DIAGRAM_EVENT, onOpen))

/** Ajusta el diagrama a la pantalla (sin pasar del doble de su tamaño). */
function fit() {
  const svg = stage.value?.querySelector('svg')
  const vp = viewport.value
  if (!svg || !vp) return
  const box = svg.viewBox.baseVal
  natural.width = box?.width || svg.getBoundingClientRect().width
  natural.height = box?.height || svg.getBoundingClientRect().height
  svg.style.maxWidth = 'none'
  svg.style.width = `${natural.width}px`
  svg.style.height = `${natural.height}px`
  const s = clamp(Math.min((vp.clientWidth * 0.95) / natural.width, (vp.clientHeight * 0.95) / natural.height, 2))
  scale.value = s
  x.value = (vp.clientWidth - natural.width * s) / 2
  y.value = (vp.clientHeight - natural.height * s) / 2
}

/** Zoom manteniendo fijo el punto (px, py) de la pantalla. */
function zoomAt(factor: number, px?: number, py?: number) {
  const vp = viewport.value
  if (!vp) return
  const cx = px ?? vp.clientWidth / 2
  const cy = py ?? vp.clientHeight / 2
  const next = clamp(scale.value * factor)
  const k = next / scale.value
  x.value = cx - (cx - x.value) * k
  y.value = cy - (cy - y.value) * k
  scale.value = next
}

function actualSize() {
  zoomAt(1 / scale.value)
}

function local(e: { clientX: number; clientY: number }) {
  const r = viewport.value!.getBoundingClientRect()
  return { px: e.clientX - r.left, py: e.clientY - r.top }
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const { px, py } = local(e)
  zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), px, py)
}

// Arrastrar con un dedo o el ratón; pellizcar con dos dedos.
const pointers = new Map<number, { x: number; y: number }>()
let pinch: { distance: number } | null = null

function onPointerDown(e: PointerEvent) {
  viewport.value?.setPointerCapture(e.pointerId)
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    pinch = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y) }
  }
}

function onPointerMove(e: PointerEvent) {
  const prev = pointers.get(e.pointerId)
  if (!prev) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 1) {
    x.value += e.clientX - prev.x
    y.value += e.clientY - prev.y
  } else if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()]
    const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y)
    const { px, py } = local({ clientX: (a!.x + b!.x) / 2, clientY: (a!.y + b!.y) / 2 })
    if (pinch.distance > 0) zoomAt(distance / pinch.distance, px, py)
    pinch.distance = distance
  }
}

function onPointerUp(e: PointerEvent) {
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinch = null
}

function onDoubleClick(e: MouseEvent) {
  const { px, py } = local(e)
  zoomAt(2, px, py)
}

// Teclado: + (o =) acerca, − aleja, 0 ajusta. Por la tecla, no por el atajo:
// en muchos teclados «+» lleva Mayúsculas.
function onKey(e: KeyboardEvent) {
  if (!open.value || e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key === '+' || e.key === '=') zoomAt(1.25)
  else if (e.key === '-' || e.key === '_') zoomAt(0.8)
  else if (e.key === '0') fit()
  else return
  e.preventDefault()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const percent = computed(() => `${Math.round(scale.value * 100)} %`)
</script>

<template>
  <UModal v-model:open="open" fullscreen title="Diagrama" :ui="{ body: 'p-0 sm:p-0 flex', header: 'gap-2' }">
    <template #header="{ close }">
      <h2 class="me-auto font-semibold text-highlighted">Diagrama</h2>
      <UFieldGroup>
        <UTooltip text="Alejar (−)">
          <UButton icon="i-lucide-zoom-out" color="neutral" variant="outline" aria-label="Alejar" @click="zoomAt(0.8)" />
        </UTooltip>
        <UTooltip text="Tamaño real">
          <UButton :label="percent" color="neutral" variant="outline" class="min-w-16 justify-center tabular-nums" @click="actualSize" />
        </UTooltip>
        <UTooltip text="Acercar (+)">
          <UButton icon="i-lucide-zoom-in" color="neutral" variant="outline" aria-label="Acercar" @click="zoomAt(1.25)" />
        </UTooltip>
      </UFieldGroup>
      <UTooltip text="Ajustar a la pantalla (0)">
        <UButton icon="i-lucide-scan" color="neutral" variant="outline" aria-label="Ajustar a la pantalla" @click="fit" />
      </UTooltip>
      <UButton icon="i-lucide-x" color="neutral" variant="ghost" aria-label="Cerrar" @click="close" />
    </template>

    <template #body>
      <div
        ref="viewport"
        class="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden select-none active:cursor-grabbing"
        @wheel="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @dblclick="onDoubleClick"
      >
        <!-- SVG de Mermaid en modo 'strict' (ya limpio con DOMPurify). -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div
          ref="stage"
          class="absolute start-0 top-0 origin-top-left"
          :style="{ transform: `translate(${x}px, ${y}px) scale(${scale})` }"
          v-html="svgMarkup"
        />
        <p class="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-default/80 px-2 py-1 text-xs text-muted">
          Arrastra para moverte · rueda o pellizco para el zoom · doble clic para acercar
        </p>
      </div>
    </template>
  </UModal>
</template>
