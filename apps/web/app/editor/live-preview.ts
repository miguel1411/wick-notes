/**
 * Vista previa en vivo: el documento es texto Markdown y aquí
 * solo se decide cómo se ve. Los símbolos (`##`, `**`, `[]()`, `>`…) se ocultan
 * y el texto se muestra con formato; donde está el cursor reaparecen y se
 * editan como texto normal.
 *
 * - Marcas de bloque (títulos, citas, `---`): visibles en las líneas que toca la
 *   selección.
 * - Marcas en línea (negrita, cursiva, código, tachado, enlaces): visibles si la
 *   selección toca ese elemento.
 * - Imágenes (`![texto](url)`): se ve la imagen; si la selección la toca, aparece
 *   también el Markdown encima para editarlo.
 * - Tablas: se dibuja la tabla; si la selección toca sus líneas, el Markdown
 *   (table-preview.ts).
 * - Sin foco (o para un lector) no hay nada «activo»: todo se ve con formato.
 *
 * Nada de esto cambia el texto: la nota es siempre el Markdown tal cual.
 */
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

const hidden = Decoration.replace({})
const mark = Decoration.mark({ class: 'cm-md-mark' })
const inlineCode = Decoration.mark({ class: 'cm-md-code' })
const linkText = Decoration.mark({ class: 'cm-md-link' })
const quoteLine = Decoration.line({ class: 'cm-md-quote' })
const codeLine = Decoration.line({ class: 'cm-md-codeblock' })
const tableLine = Decoration.line({ class: 'cm-md-table' })
const headingLine = (level: string) => Decoration.line({ class: `cm-md-h cm-md-h${level}` })

class BulletWidget extends WidgetType {
  override eq() {
    return true
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-md-bullet'
    el.textContent = '•'
    return el
  }
}

class RuleWidget extends WidgetType {
  override eq() {
    return true
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-md-hr'
    return el
  }
}

/** Casilla de una tarea `- [ ]`: al pulsarla cambia `[ ]` ↔ `[x]` en el texto. */
class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  override eq(other: TaskWidget) {
    return other.checked === this.checked
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-md-task'
    box.checked = this.checked
    box.setAttribute('aria-label', this.checked ? 'Tarea hecha' : 'Tarea pendiente')
    if (view.state.readOnly) box.disabled = true
    box.addEventListener('mousedown', (event) => {
      event.preventDefault()
      if (view.state.readOnly) return
      const at = view.posAtDOM(box)
      const marker = view.state.sliceDoc(at, at + 3)
      if (!/^\[[ xX]\]$/.test(marker)) return
      view.dispatch({ changes: { from: at + 1, to: at + 2, insert: marker[1] === ' ' ? 'x' : ' ' } })
    })
    return box
  }
  override ignoreEvent() {
    return true
  }
}

/**
 * Imagen de `![texto](url)`. Solo URLs http(s), sin Referer (el servidor de la
 * imagen no ve la dirección de la nota) y con carga diferida. Si no carga, se
 * muestra un aviso con su descripción en lugar del icono roto.
 */
class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
    readonly title: string | null,
  ) {
    super()
  }
  override eq(other: ImageWidget) {
    return other.url === this.url && other.alt === this.alt && other.title === this.title
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('span')
    wrap.className = 'cm-md-image'
    const img = document.createElement('img')
    img.alt = this.alt
    if (this.title) img.title = this.title
    img.loading = 'lazy'
    img.decoding = 'async'
    img.referrerPolicy = 'no-referrer'
    img.draggable = false
    // La altura de la línea cambia al cargar: que el editor la vuelva a medir.
    img.addEventListener('load', () => view.requestMeasure())
    img.addEventListener('error', () => {
      const note = document.createElement('span')
      note.className = 'cm-md-image-error'
      note.textContent = this.alt ? `No se pudo cargar la imagen «${this.alt}»` : 'No se pudo cargar la imagen'
      wrap.replaceChildren(note)
      view.requestMeasure()
    })
    img.src = this.url
    wrap.append(img)
    return wrap
  }
  // Un clic en la imagen deja el cursor junto a ella y muestra su Markdown.
  override ignoreEvent() {
    return false
  }
}

/** Solo se cargan imágenes de http(s) (nunca `javascript:`, `data:` ni rutas locales). */
function safeImageUrl(raw: string): string | null {
  const url = raw.trim().replace(/^<|>$/g, '')
  return /^https?:\/\//i.test(url) ? url : null
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view
  const doc = state.doc
  // Sin foco no hay línea activa: un lector, o alguien que aún no ha hecho clic,
  // ve la nota entera con formato.
  const ranges = view.hasFocus ? state.selection.ranges : []
  const activeLines = new Set<number>()
  for (const r of ranges) {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) activeLines.add(n)
  }
  const lineActive = (pos: number) => activeLines.has(doc.lineAt(pos).number)
  const touches = (from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from)

  const out: Range<Decoration>[] = []
  const eachLine = (from: number, to: number, deco: Decoration) => {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos)
      out.push(deco.range(line.from))
      pos = line.to + 1
    }
  }
  /** Oculta una marca y el espacio que la sigue (`## `, `> `). */
  const hideWithSpace = (from: number, to: number) => {
    out.push(hidden.range(from, doc.sliceString(to, to + 1) === ' ' ? to + 1 : to))
  }
  /** Marcas de un elemento en línea: ocultas, o atenuadas si el cursor lo toca. */
  const inlineMark = (node: SyntaxNode, parent: SyntaxNode) => {
    out.push((touches(parent.from, parent.to) ? mark : hidden).range(node.from, node.to))
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        const node = ref.node
        const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name)
        if (heading) {
          out.push(headingLine(heading[1]!).range(doc.lineAt(node.from).from))
          return
        }
        switch (node.name) {
          case 'HeaderMark': {
            if (node.parent?.name.startsWith('Setext') || lineActive(node.from)) {
              out.push(mark.range(node.from, node.to))
              return
            }
            const line = doc.lineAt(node.from)
            if (!doc.sliceString(line.from, node.from).trim()) hideWithSpace(node.from, node.to)
            else {
              // Cierre opcional «## Título ##»: se oculta con los espacios de antes.
              let start = node.from
              while (start > line.from && doc.sliceString(start - 1, start) === ' ') start--
              out.push(hidden.range(start, node.to))
            }
            return
          }
          case 'EmphasisMark':
          case 'StrikethroughMark':
            if (node.parent) inlineMark(node, node.parent)
            return
          case 'InlineCode':
            out.push(inlineCode.range(node.from, node.to))
            return
          case 'CodeMark':
            if (node.parent?.name === 'InlineCode') inlineMark(node, node.parent)
            else out.push(mark.range(node.from, node.to)) // vallas ``` de un bloque
            return
          case 'CodeInfo':
            out.push(mark.range(node.from, node.to))
            return
          case 'FencedCode':
          case 'CodeBlock':
            eachLine(node.from, node.to, codeLine)
            return
          case 'Table':
            eachLine(node.from, node.to, tableLine)
            return
          case 'Blockquote':
            eachLine(node.from, node.to, quoteLine)
            return
          case 'QuoteMark':
            if (lineActive(node.from)) out.push(mark.range(node.from, node.to))
            else hideWithSpace(node.from, node.to)
            return
          case 'HorizontalRule':
            if (lineActive(node.from)) out.push(mark.range(node.from, node.to))
            else out.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to))
            return
          case 'Link':
            // Se sigue por dentro: puede haber negrita o código en el texto del enlace.
            decorateLink(node)
            return
          case 'Image':
            return decorateImage(node)
          case 'URL':
          case 'Autolink':
            // Enlace suelto (https://…) o <https://…>.
            if (node.parent?.name !== 'Link' && node.parent?.name !== 'Image') out.push(linkText.range(node.from, node.to))
            return node.name === 'URL'
          case 'ListMark':
            decorateListMark(node)
            return
          case 'TaskMarker': {
            if (touches(node.from, node.to)) return
            const checked = /x/i.test(doc.sliceString(node.from, node.to))
            out.push(Decoration.replace({ widget: new TaskWidget(checked) }).range(node.from, node.to))
            return
          }
        }
      },
    })
  }

  /** `[texto](url)`: fuera del cursor solo se ve «texto», como enlace. */
  function decorateLink(node: SyntaxNode) {
    const marks = childrenOf(node, 'LinkMark')
    const url = node.getChild('URL')
    const open = marks[0]
    const close = marks[1]
    if (open && close && close.from > open.to) out.push(linkText.range(open.to, close.from))
    // Enlaces por referencia ([texto][ref]) o incompletos: se quedan como texto.
    if (!url || !open || !close || touches(node.from, node.to)) {
      for (const m of marks) out.push(mark.range(m.from, m.to))
      if (url) out.push(mark.range(url.from, url.to))
      return
    }
    out.push(hidden.range(open.from, open.to))
    out.push(hidden.range(close.from, node.to))
  }

  /**
   * `![texto](url)`: fuera del cursor, la imagen en lugar del texto. Si el cursor
   * la toca, el Markdown (atenuado) y la imagen debajo, para no perderla de vista.
   * Devuelve false para no decorar por dentro lo que queda oculto.
   */
  function decorateImage(node: SyntaxNode): false | undefined {
    const urlNode = node.getChild('URL')
    const url = urlNode && safeImageUrl(doc.sliceString(urlNode.from, urlNode.to))
    const marks = childrenOf(node, 'LinkMark')
    const titleNode = node.getChild('LinkTitle')
    const showSyntax = () => {
      for (const m of marks) out.push(mark.range(m.from, m.to))
      if (urlNode) out.push(mark.range(urlNode.from, urlNode.to))
      if (titleNode) out.push(mark.range(titleNode.from, titleNode.to))
    }
    if (!url || !marks[0] || !marks[1]) {
      showSyntax() // sin URL o con una que no se carga: se queda como texto
      return
    }
    const alt = doc.sliceString(marks[0].to, marks[1].from).replace(/[*_`~]/g, '').trim()
    const title = titleNode ? doc.sliceString(titleNode.from + 1, titleNode.to - 1) : null
    const widget = new ImageWidget(url, alt, title)
    if (touches(node.from, node.to)) {
      showSyntax()
      out.push(Decoration.widget({ widget, side: 1 }).range(node.to))
      return
    }
    out.push(Decoration.replace({ widget }).range(node.from, node.to))
    return false
  }

  /** Viñetas: «•» en lugar de `-`; en tareas solo queda la casilla. */
  function decorateListMark(node: SyntaxNode) {
    const item = node.parent
    if (item?.parent?.name !== 'BulletList') {
      out.push(mark.range(node.from, node.to)) // números de una lista ordenada
      return
    }
    const task = item.getChild('Task')
    const marker = task?.getChild('TaskMarker')
    if (marker) {
      if (touches(node.from, marker.to)) out.push(mark.range(node.from, node.to))
      else hideWithSpace(node.from, node.to)
      return
    }
    if (touches(node.from, node.to + 1)) out.push(mark.range(node.from, node.to))
    else out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to))
  }

  return Decoration.set(out, true)
}

function childrenOf(node: SyntaxNode, name: string): SyntaxNode[] {
  const found: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) if (child.name === name) found.push(child)
  return found
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** Solo se abren enlaces web o de correo (nunca `javascript:` y similares). */
export function safeUrl(raw: string): string | null {
  const url = raw.trim().replace(/^<|>$/g, '')
  return /^(https?:|mailto:)/i.test(url) ? url : /^www\./i.test(url) ? `https://${url}` : null
}

/** URL del enlace que hay en `pos`, si lo hay. */
function linkAt(state: EditorState, pos: number): string | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === 'Link') {
      const url = node.getChild('URL')
      return url ? safeUrl(state.sliceDoc(url.from, url.to)) : null
    }
    if (node.name === 'URL' || node.name === 'Autolink') return safeUrl(state.sliceDoc(node.from, node.to))
  }
  return null
}

/**
 * Ctrl/Cmd + clic abre un enlace en otra pestaña (un clic normal sirve para
 * editarlo). En modo lectura basta un clic.
 */
export const linkClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.ctrlKey || event.metaKey || view.state.readOnly)) return false
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    const url = pos === null ? null : linkAt(view.state, pos)
    if (!url) return false
    event.preventDefault()
    window.open(url, '_blank', 'noopener,noreferrer')
    return true
  },
})
