/**
 * Diagramas Mermaid en la vista previa (block-widgets.ts):
 * - Fuera del cursor, un bloque ```mermaid se ve como diagrama, al ancho de la
 *   columna de texto. Un clic (o el botón «Ampliar») lo abre a pantalla
 *   completa con zoom (DiagramViewer.vue); «Editar código» lleva al código.
 * - Con el cursor dentro se edita el código y, debajo, se ve el diagrama
 *   actualizándose mientras se escribe (conserva el último dibujo correcto).
 *
 * La librería es grande: solo se descarga cuando una nota tiene un diagrama.
 * Se usa con securityLevel 'strict' (sin HTML ni clics que ejecuten código) y
 * con los colores del modo claro u oscuro de la app.
 */
import type { EditorState } from '@codemirror/state'
import { type EditorView, WidgetType } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import type { Mermaid } from 'mermaid'
import { OPEN_DIAGRAM_EVENT, type OpenDiagramDetail } from '../utils/diagram'
import { blockWidgets, placeCursor } from './block-widgets'

type Drawing = { svg: string; id: string } | { error: string }

let mermaidLoader: Promise<Mermaid> | null = null
const loadMermaid = () => (mermaidLoader ??= import('mermaid').then((m) => m.default))

const isDark = () => document.documentElement.classList.contains('dark')

// Mermaid no admite dos dibujos a la vez con distinta configuración: van en fila.
let queue: Promise<unknown> = Promise.resolve()
let configuredTheme: string | null = null
let seq = 0

/** Dibujos ya hechos (por tema y código), para no repetirlos al mover el cursor. */
const cache = new Map<string, Promise<Drawing>>()
const CACHE_SIZE = 50

function draw(code: string, dark: boolean): Promise<Drawing> {
  const key = `${dark ? 'dark' : 'light'}\n${code}`
  const hit = cache.get(key)
  if (hit) return hit

  const result = (queue = queue.then(async (): Promise<Drawing> => {
    const mermaid = await loadMermaid()
    const theme = dark ? 'dark' : 'default'
    if (configuredTheme !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        // Los errores los muestra wick; Mermaid no debe meter su aviso en la página.
        suppressErrorRendering: true,
        theme,
        fontFamily: getComputedStyle(document.body).fontFamily,
      })
      configuredTheme = theme
    }
    const id = `wick-mermaid-${++seq}`
    try {
      const { svg } = await mermaid.render(id, code)
      return { svg, id }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const line = /error on line (\d+)/i.exec(message)?.[1]
      if (line) return { error: `Hay un error en la línea ${line} del diagrama.` }
      if (/no diagram type detected/i.test(message)) return { error: 'La primera línea debe decir el tipo de diagrama (flowchart, sequenceDiagram, mindmap…).' }
      return { error: message.split('\n').find((l) => l.trim()) ?? 'Error desconocido.' }
    }
  })) as Promise<Drawing>

  cache.set(key, result)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
  return result
}

// --- Botones (iconos de Lucide, en línea: el widget no es un componente Vue) ---
const ICONS = {
  expand:
    '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
}

function button(icon: keyof typeof ICONS, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'cm-md-mermaid-btn'
  b.title = label
  b.setAttribute('aria-label', label)
  b.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`
  // mousedown: que CodeMirror no mueva el cursor ni le quite el foco al botón.
  b.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
  })
  b.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onClick()
  })
  return b
}

/**
 * Un diagrama dibujado y lo que lo rodea. Lo comparten el widget normal y la
 * vista previa mientras se edita.
 */
class DiagramBox {
  readonly root = document.createElement('div')
  private readonly canvas = document.createElement('div')
  private readonly note = document.createElement('div')
  private dark = isDark()
  private code = ''
  private last: { svg: string; id: string } | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly observer: MutationObserver

  constructor(
    private readonly view: EditorView,
    options: { className: string; onEdit?: () => void },
  ) {
    this.root.className = `cm-md-mermaid ${options.className}`
    this.canvas.className = 'cm-md-mermaid-canvas'
    this.canvas.setAttribute('role', 'img')
    this.canvas.setAttribute('aria-label', 'Diagrama')
    this.note.className = 'cm-md-mermaid-note'

    const toolbar = document.createElement('div')
    toolbar.className = 'cm-md-mermaid-toolbar'
    toolbar.append(button('expand', 'Ampliar diagrama', () => this.open()))
    if (options.onEdit && !view.state.readOnly) toolbar.append(button('code', 'Editar código', options.onEdit))

    // Un clic en el diagrama lo amplía.
    this.canvas.addEventListener('click', () => this.open())
    this.root.append(toolbar, this.canvas, this.note)

    this.observer = new MutationObserver(() => {
      if (isDark() === this.dark) return
      this.dark = isDark()
      this.render(this.code)
    })
    this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  }

  /** Dibuja `code`. Con `delayMs`, espera a que se deje de escribir. */
  render(code: string, delayMs = 0) {
    this.code = code
    if (this.timer) clearTimeout(this.timer)
    if (!this.last) this.setNote('Dibujando diagrama…', false)
    const run = () => {
      const dark = this.dark
      void draw(code, dark).then((drawing) => {
        // Si entretanto cambió el código o el tema, ya viene otro dibujo.
        if (code === this.code && dark === this.dark) this.show(drawing)
      })
    }
    if (delayMs) this.timer = setTimeout(run, delayMs)
    else run()
  }

  private show(drawing: Drawing) {
    if ('svg' in drawing) {
      this.last = drawing
      // Mermaid en modo 'strict' ya limpia el SVG (DOMPurify).
      this.canvas.innerHTML = drawing.svg
      const svg = this.canvas.querySelector('svg')
      const box = svg?.viewBox.baseVal
      if (svg && box?.width) {
        // Al ancho de la columna de texto (los pequeños, como mucho al doble de su
        // tamaño, para que el texto no salga enorme). Para verlo en grande, el visor.
        svg.style.maxWidth = 'none'
        svg.style.width = `min(100%, ${Math.ceil(box.width * 2)}px)`
        svg.style.height = 'auto'
      }
      this.setNote('', false)
    } else {
      // Con un error a medio escribir, se queda el último dibujo correcto.
      if (!this.last) this.canvas.replaceChildren()
      this.setNote(drawing.error, true)
    }
    this.view.requestMeasure()
  }

  private setNote(text: string, error: boolean) {
    this.note.textContent = text
    this.note.hidden = !text
    this.note.classList.toggle('cm-md-mermaid-error', error)
  }

  private open() {
    if (!this.last) return
    window.dispatchEvent(new CustomEvent<OpenDiagramDetail>(OPEN_DIAGRAM_EVENT, { detail: this.last }))
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer)
    this.observer.disconnect()
  }
}

const boxes = new WeakMap<HTMLElement, DiagramBox>()

/** El diagrama en lugar del bloque (fuera del cursor). */
class MermaidWidget extends WidgetType {
  constructor(
    readonly code: string,
    /** Inicio del código respecto al inicio del bloque (la valla ```mermaid). */
    readonly codeOffset: number,
  ) {
    super()
  }
  override eq(other: MermaidWidget) {
    return other.code === this.code && other.codeOffset === this.codeOffset
  }
  toDOM(view: EditorView) {
    const box = new DiagramBox(view, { className: 'cm-md-mermaid-block', onEdit: () => placeCursor(view, box.root, this.codeOffset) })
    boxes.set(box.root, box)
    box.render(this.code)
    return box.root
  }
  override destroy(dom: HTMLElement) {
    boxes.get(dom)?.destroy()
  }
  override ignoreEvent() {
    return true
  }
}

/** Vista previa debajo del código mientras se edita: se actualiza al dejar de escribir. */
class MermaidLivePreview extends WidgetType {
  constructor(readonly code: string) {
    super()
  }
  override eq(other: MermaidLivePreview) {
    return other.code === this.code
  }
  toDOM(view: EditorView) {
    const box = new DiagramBox(view, { className: 'cm-md-mermaid-live' })
    boxes.set(box.root, box)
    box.render(this.code)
    return box.root
  }
  /** Mismo DOM con el código nuevo: así no parpadea a cada tecla. */
  override updateDOM(dom: HTMLElement) {
    const box = boxes.get(dom)
    if (!box) return false
    box.render(this.code, 400)
    return true
  }
  override destroy(dom: HTMLElement) {
    boxes.get(dom)?.destroy()
  }
  override ignoreEvent() {
    return true
  }
}

/** Código de un bloque ```mermaid completo (con su valla de cierre), o null. */
function mermaidCode(node: SyntaxNode, state: EditorState): { code: string; from: number } | null {
  const info = node.getChild('CodeInfo')
  if (!info || state.doc.sliceString(info.from, info.to).trim().toLowerCase() !== 'mermaid') return null
  // Sin valla de cierre se está escribiendo todavía: se queda como código.
  if (node.getChildren('CodeMark').length < 2) return null
  const text = node.getChild('CodeText')
  const code = text ? state.doc.sliceString(text.from, text.to) : ''
  return code.trim() ? { code, from: text!.from } : null
}

export const mermaidPreview = blockWidgets(
  'FencedCode',
  (node, state, from) => {
    const m = mermaidCode(node, state)
    return m ? new MermaidWidget(m.code, m.from - from) : null
  },
  {
    whileEditing: (node, state) => {
      const m = mermaidCode(node, state)
      return m ? new MermaidLivePreview(m.code) : null
    },
  },
)
