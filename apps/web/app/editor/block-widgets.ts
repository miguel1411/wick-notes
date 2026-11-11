/**
 * Bloques que la vista previa dibuja en lugar de su Markdown (tablas, diagramas):
 * fuera del cursor se ve el widget; si la selección toca alguna de sus líneas, se
 * ve y se edita el Markdown tal cual. Sin foco (o para un lector) se dibujan todos.
 *
 * Va aparte de live-preview.ts porque sustituye varias líneas de golpe, y eso
 * CodeMirror solo lo admite desde un StateField, no desde un ViewPlugin.
 */
import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, type Range, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, type WidgetType } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

// Un StateField no ve el foco de la vista: se lo pasa este efecto.
const setFocus = StateEffect.define<boolean>()
const focused = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(setFocus) ? e.value : v), value),
})
const focusTracking = [focused, EditorView.focusChangeEffect.of((_, focusing) => setFocus.of(focusing))]

/** Bloques que pueden contener otros bloques; el resto no se recorre por dentro. */
const CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem'])

type MakeWidget = (node: SyntaxNode, state: EditorState, from: number, to: number) => WidgetType | null

/**
 * Dibuja con un widget cada nodo `nodeName` para el que `widget` devuelva uno
 * (`from`/`to`: inicio de su primera línea y final de la última). Con
 * `whileEditing`, mientras la selección está en el bloque se ve su Markdown y,
 * debajo, ese otro widget (por ejemplo, la vista previa de un diagrama).
 */
export function blockWidgets(nodeName: string, widget: MakeWidget, options: { whileEditing?: MakeWidget } = {}): Extension {
  const build = (state: EditorState): DecorationSet => {
    const doc = state.doc
    const ranges = state.field(focused) ? state.selection.ranges : []
    const out: Range<Decoration>[] = []
    syntaxTree(state).iterate({
      enter: (ref) => {
        if (ref.name !== nodeName) return CONTAINERS.has(ref.name)
        const from = doc.lineAt(ref.from).from
        const to = doc.lineAt(ref.to).to
        if (ranges.some((r) => r.from <= to && r.to >= from)) {
          const below = options.whileEditing?.(ref.node, state, from, to)
          if (below) out.push(Decoration.widget({ widget: below, block: true, side: 1 }).range(to))
          return false
        }
        const w = widget(ref.node, state, from, to)
        if (w) out.push(Decoration.replace({ widget: w, block: true }).range(from, to))
        return false
      },
    })
    return Decoration.set(out, true)
  }

  const field = StateField.define<DecorationSet>({
    create: build,
    update(value, tr) {
      const focusChanged = tr.effects.some((e) => e.is(setFocus))
      if (tr.docChanged || tr.selection || focusChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
        return build(tr.state)
      }
      return value
    },
    provide: (f) => EditorView.decorations.from(f),
  })
  // focusTracking es el mismo objeto en todos: CodeMirror lo añade una sola vez.
  return [focusTracking, field]
}

/**
 * Un clic en el widget lleva el cursor a `offset` (relativo al inicio del bloque),
 * y así el bloque vuelve a su Markdown. Devuelve false si el clic no es para editar.
 */
export function placeCursor(view: EditorView, widgetDom: HTMLElement, offset: number): boolean {
  if (view.state.readOnly) return false
  const anchor = view.posAtDOM(widgetDom) + offset
  view.dispatch({ selection: { anchor: Math.min(anchor, view.state.doc.length) }, scrollIntoView: true })
  view.focus()
  return true
}
