/**
 * Diagramas Mermaid en la vista previa: un bloque ```mermaid se dibuja como
 * diagrama; con el cursor dentro, se edita su código (block-widgets.ts).
 *
 * La librería es grande: solo se descarga cuando una nota tiene un diagrama.
 * Se usa con securityLevel 'strict' (sin HTML ni clics que ejecuten código) y
 * con los colores del modo claro u oscuro de la app.
 */
import type { EditorState } from '@codemirror/state'
import { type EditorView, WidgetType } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import type { Mermaid } from 'mermaid'
import { blockWidgets, placeCursor } from './block-widgets'

type Drawing = { svg: string } | { error: string }

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
    try {
      const { svg } = await mermaid.render(`wick-mermaid-${++seq}`, code)
      return { svg }
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

/** Observadores del cambio de tema, para soltarlos cuando el widget desaparece. */
const themeObservers = new WeakMap<HTMLElement, MutationObserver>()

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
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-mermaid'
    wrap.setAttribute('role', 'img')
    wrap.setAttribute('aria-label', 'Diagrama')

    let dark = isDark()
    const show = (drawing: Drawing) => {
      if ('svg' in drawing) {
        // Mermaid en modo 'strict' ya limpia el SVG (DOMPurify).
        wrap.innerHTML = drawing.svg
      } else {
        const box = document.createElement('div')
        box.className = 'cm-md-mermaid-error'
        const title = document.createElement('strong')
        title.textContent = 'No se pudo dibujar el diagrama'
        const detail = document.createElement('span')
        detail.textContent = view.state.readOnly ? drawing.error : `${drawing.error} · Haz clic para editar el código.`
        box.append(title, detail)
        wrap.replaceChildren(box)
      }
      view.requestMeasure()
    }
    const render = () => {
      const current = dark
      void draw(this.code, current).then((drawing) => {
        if (current === dark) show(drawing) // si el tema cambió entretanto, ya viene otro
      })
    }

    const loading = document.createElement('div')
    loading.className = 'cm-md-mermaid-loading'
    loading.textContent = 'Dibujando diagrama…'
    wrap.append(loading)
    render()

    const observer = new MutationObserver(() => {
      if (isDark() === dark) return
      dark = isDark()
      render()
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    themeObservers.set(wrap, observer)

    wrap.addEventListener('mousedown', (event) => {
      if (event.button === 0 && placeCursor(view, wrap, this.codeOffset)) event.preventDefault()
    })
    return wrap
  }
  override destroy(dom: HTMLElement) {
    themeObservers.get(dom)?.disconnect()
  }
  override ignoreEvent() {
    return true
  }
}

/** Bloque ```mermaid completo (con su valla de cierre) y con código. */
function mermaidWidget(node: SyntaxNode, state: EditorState, from: number): MermaidWidget | null {
  const info = node.getChild('CodeInfo')
  if (!info || state.doc.sliceString(info.from, info.to).trim().toLowerCase() !== 'mermaid') return null
  // Sin valla de cierre se está escribiendo todavía: se queda como código.
  if (node.getChildren('CodeMark').length < 2) return null
  const text = node.getChild('CodeText')
  const code = text ? state.doc.sliceString(text.from, text.to) : ''
  if (!code.trim()) return null
  return new MermaidWidget(code, text!.from - from)
}

export const mermaidPreview = blockWidgets('FencedCode', (node, state, from) => mermaidWidget(node, state, from))
