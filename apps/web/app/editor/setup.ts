/**
 * Configuración del editor de notas (CodeMirror 6): Markdown con vista previa en
 * vivo, atajos de formato y colaboración (la añade CollabEditor.vue).
 */
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage, pasteURLAsLink } from '@codemirror/lang-markdown'
import { syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder, type Command } from '@codemirror/view'
import { yUndoManagerKeymap } from 'y-codemirror.next'
import { linkClick, livePreview } from './live-preview'
import { mermaidPreview } from './mermaid-preview'
import { tablePreview } from './table-preview'
import { wickHighlight, wickTheme } from './theme'

/**
 * Pone o quita `marker` alrededor de cada selección (`**` negrita, `*` cursiva…).
 * Sin selección, deja el cursor entre las dos marcas para escribir.
 */
function toggleWrap(marker: string): Command {
  return (view) => {
    if (view.state.readOnly) return false
    const n = marker.length
    view.dispatch(
      view.state.changeByRange((range) => {
        const { from, to } = range
        const doc = view.state.doc
        const wrapped = doc.sliceString(from - n, from) === marker && doc.sliceString(to, to + n) === marker
        if (wrapped) {
          return {
            changes: [
              { from: from - n, to: from },
              { from: to, to: to + n },
            ],
            range: EditorSelection.range(from - n, to - n),
          }
        }
        return {
          changes: [
            { from, insert: marker },
            { from: to, insert: marker },
          ],
          range: EditorSelection.range(from + n, to + n),
        }
      }),
      { scrollIntoView: true, userEvent: 'input.format' },
    )
    return true
  }
}

/** `[texto](url)` con «url» seleccionada para escribirla. */
const insertLink: Command = (view) => {
  if (view.state.readOnly) return false
  view.dispatch(
    view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to)
      const insert = `[${text}](url)`
      const urlStart = range.from + text.length + 3
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(urlStart, urlStart + 3) }
    }),
    { scrollIntoView: true, userEvent: 'input.format' },
  )
  return true
}

export function editorExtensions(options: { readonly: boolean }): Extension[] {
  return [
    // Markdown con GFM (tablas, tareas, tachado) y resaltado del código de los
    // bloques. Incluye Enter que continúa listas y citas, y Backspace que quita
    // la marca de la lista.
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(wickHighlight),
    livePreview,
    tablePreview,
    mermaidPreview,
    linkClick,
    pasteURLAsLink,
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': 'Contenido de la nota', spellcheck: 'true' }),
    placeholder('Escribe en Markdown…'),
    keymap.of([
      { key: 'Mod-b', run: toggleWrap('**') },
      { key: 'Mod-i', run: toggleWrap('*') },
      { key: 'Mod-Shift-x', run: toggleWrap('~~') },
      { key: 'Mod-e', run: toggleWrap('`') },
      { key: 'Mod-k', run: insertLink },
      indentWithTab,
      // Deshacer/rehacer lo da Yjs: solo los cambios propios, no los de otros.
      ...yUndoManagerKeymap,
      ...defaultKeymap,
    ]),
    wickTheme,
    options.readonly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
  ]
}
