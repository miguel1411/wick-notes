/**
 * Tablas en la vista previa en vivo: fuera del cursor se dibuja la tabla; si la
 * selección toca alguna de sus líneas, se ve y se edita el Markdown tal cual.
 * Un clic en una celda pone el cursor en esa celda. Los anchos de las columnas
 * salen de la fila separadora (`|---|------|`, ver parseTableDelimiter).
 *
 * Va aparte de live-preview.ts porque sustituye varias líneas de golpe, y eso
 * CodeMirror solo lo admite desde un StateField, no desde un ViewPlugin.
 */
import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { parseTableDelimiter } from '@wick/core/markdown-table'
import { safeUrl } from './live-preview'

interface Cell {
  /** Posición de la celda respecto al inicio de la tabla (para poner ahí el cursor). */
  offset: number
  node: SyntaxNode | null
}

// --- Foco ---
// Sin foco no hay nada «activo» y todas las tablas se dibujan, como en el resto de
// la vista previa. Un StateField no ve el foco de la vista: se lo pasa este efecto.
const setFocus = StateEffect.define<boolean>()
const focused = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(setFocus) ? e.value : v), value),
})
const trackFocus = EditorView.focusChangeEffect.of((_, focusing) => setFocus.of(focusing))

/** Celdas de una fila (cabecera o cuerpo), separadas por sus `|`. Las vacías no tienen nodo. */
function rowCells(row: SyntaxNode, tableFrom: number): Cell[] {
  const bounds: number[] = [row.from]
  const cellNodes: SyntaxNode[] = []
  for (let child = row.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableDelimiter') bounds.push(child.from, child.to)
    else if (child.name === 'TableCell') cellNodes.push(child)
  }
  bounds.push(row.to)
  const cells: Cell[] = []
  for (let i = 0; i < bounds.length; i += 2) {
    const from = bounds[i]!
    const to = bounds[i + 1]!
    const node = cellNodes.find((n) => n.from >= from && n.to <= to) ?? null
    // El `|` inicial y el final son opcionales: no abren una celda vacía.
    if (!node && (i === 0 || i === bounds.length - 2) && from === to) continue
    cells.push({ offset: (node?.from ?? Math.min(from + 1, to)) - tableFrom, node })
  }
  return cells
}

/** Dibuja el contenido en línea de una celda (negrita, cursiva, código, enlaces…) con nodos DOM, sin HTML. */
function renderInline(state: EditorState, node: SyntaxNode, parent: HTMLElement) {
  const doc = state.doc
  const text = (from: number, to: number) => {
    if (to > from) parent.append(doc.sliceString(from, to))
  }
  const el = (tag: string, className?: string) => {
    const e = document.createElement(tag)
    if (className) e.className = className
    parent.append(e)
    return e
  }

  let pos = node.from
  for (let child = node.firstChild; child; child = child.nextSibling) {
    text(pos, child.from)
    pos = child.to
    switch (child.name) {
      case 'StrongEmphasis':
        renderInline(state, child, el('strong'))
        break
      case 'Emphasis':
        renderInline(state, child, el('em'))
        break
      case 'Strikethrough':
        renderInline(state, child, el('s'))
        break
      case 'InlineCode': {
        const marks = child.getChildren('CodeMark')
        const from = marks[0]?.to ?? child.from
        const to = marks[1]?.from ?? child.to
        el('code', 'cm-md-code').textContent = doc.sliceString(from, to)
        break
      }
      case 'Link': {
        const url = child.getChild('URL')
        const href = url ? safeUrl(doc.sliceString(url.from, url.to)) : null
        const link = el('span', 'cm-md-link')
        if (href) {
          link.dataset.href = href
          link.title = href
        }
        renderInline(state, child, link)
        break
      }
      case 'Image': {
        // Dentro de una tabla, la imagen se queda en su descripción.
        const marks = child.getChildren('LinkMark')
        const alt = marks[1] ? doc.sliceString(marks[0]!.to, marks[1].from) : ''
        el('em').textContent = alt || 'imagen'
        break
      }
      case 'URL':
      case 'Autolink': {
        // La URL de `[texto](url)` no se ve: solo el texto.
        if (child.parent?.name === 'Link') break
        const raw = doc.sliceString(child.from, child.to).replace(/^<|>$/g, '')
        const href = safeUrl(raw)
        const link = el('span', 'cm-md-link')
        link.textContent = raw
        if (href) {
          link.dataset.href = href
          link.title = href
        }
        break
      }
      case 'Escape':
        text(child.from + 1, child.to)
        break
      // Marcas de sintaxis: no se ven.
      case 'EmphasisMark':
      case 'StrikethroughMark':
      case 'CodeMark':
      case 'LinkMark':
      case 'LinkTitle':
      case 'LinkLabel':
        break
      default:
        renderInline(state, child, parent)
    }
  }
  text(pos, node.to)
}

class TableWidget extends WidgetType {
  constructor(
    /** Markdown de la tabla: si no cambia, no se vuelve a dibujar. */
    readonly source: string,
    readonly build: () => HTMLElement,
  ) {
    super()
  }
  override eq(other: TableWidget) {
    return other.source === this.source
  }
  toDOM(view: EditorView) {
    const wrap = this.build()
    wrap.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement
      const href = target.closest<HTMLElement>('[data-href]')?.dataset.href
      // Enlaces: un clic en modo lectura, Ctrl/Cmd + clic al editar (como fuera de las tablas).
      if (href && (view.state.readOnly || event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        window.open(href, '_blank', 'noopener,noreferrer')
        return
      }
      if (view.state.readOnly) return
      event.preventDefault()
      const cell = target.closest<HTMLElement>('[data-offset]')
      const start = view.posAtDOM(wrap)
      const anchor = start + Number(cell?.dataset.offset ?? 0)
      view.dispatch({ selection: { anchor: Math.min(anchor, view.state.doc.length) }, scrollIntoView: true })
      view.focus()
    })
    return wrap
  }
  override ignoreEvent() {
    return true
  }
}

function tableWidget(state: EditorState, table: SyntaxNode, from: number, to: number): TableWidget {
  const header = table.getChild('TableHeader')
  const delimiter = table.getChild('TableDelimiter')
  const { align, widths } = delimiter ? parseTableDelimiter(state.doc.sliceString(delimiter.from, delimiter.to)) : { align: [], widths: null }
  const headerCells = header ? rowCells(header, from) : []
  const bodyRows = table.getChildren('TableRow').map((row) => rowCells(row, from))
  const columns = Math.max(1, headerCells.length)
  const fixed = widths?.length === columns ? widths : null

  const build = () => {
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-table-widget'
    const el = document.createElement('table')
    if (fixed) {
      // Anchos fijos: la tabla ocupa todo el ancho y cada columna su parte.
      el.className = 'cm-md-table-fixed'
      const total = fixed.reduce((a, b) => a + b, 0)
      const colgroup = document.createElement('colgroup')
      for (const w of fixed) {
        const col = document.createElement('col')
        col.style.width = `${((w / total) * 100).toFixed(2)}%`
        colgroup.append(col)
      }
      el.append(colgroup)
    }
    const addRow = (parent: HTMLElement, cells: Cell[], tag: 'th' | 'td') => {
      const tr = document.createElement('tr')
      for (let i = 0; i < columns; i++) {
        const cell = cells[i]
        const td = document.createElement(tag)
        if (align[i]) td.style.textAlign = align[i]!
        // Celdas que faltan en la fila: el cursor va al final de la fila.
        td.dataset.offset = String(cell ? cell.offset : (cells.at(-1)?.offset ?? 0))
        if (cell?.node) renderInline(state, cell.node, td)
        tr.append(td)
      }
      parent.append(tr)
    }
    const thead = document.createElement('thead')
    addRow(thead, headerCells, 'th')
    const tbody = document.createElement('tbody')
    for (const row of bodyRows) addRow(tbody, row, 'td')
    el.append(thead, tbody)
    wrap.append(el)
    return wrap
  }
  return new TableWidget(state.doc.sliceString(from, to), build)
}

/** Bloques que pueden contener una tabla; el resto no se recorre por dentro. */
const CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem'])

function buildTables(state: EditorState): DecorationSet {
  const doc = state.doc
  const ranges = state.field(focused) ? state.selection.ranges : []
  const out: Range<Decoration>[] = []
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== 'Table') return CONTAINERS.has(ref.name)
      const from = doc.lineAt(ref.from).from
      const to = doc.lineAt(ref.to).to
      // Con la selección en sus líneas, se edita como Markdown.
      if (!ranges.some((r) => r.from <= to && r.to >= from)) {
        out.push(Decoration.replace({ widget: tableWidget(state, ref.node, from, to), block: true }).range(from, to))
      }
      return false
    },
  })
  return Decoration.set(out, true)
}

const tables = StateField.define<DecorationSet>({
  create: buildTables,
  update(value, tr) {
    const focusChanged = tr.effects.some((e) => e.is(setFocus))
    if (tr.docChanged || tr.selection || focusChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return buildTables(tr.state)
    }
    return value
  },
  provide: (field) => EditorView.decorations.from(field),
})

export const tablePreview = [focused, trackFocus, tables]
