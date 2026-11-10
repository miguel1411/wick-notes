/**
 * Aspecto del editor con los colores de Nuxt UI (variables CSS): el modo oscuro
 * funciona solo, sin cambiar de tema.
 */
import { HighlightStyle } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

export const wickTheme = EditorView.theme({
  '&': {
    color: 'var(--ui-text)',
    backgroundColor: 'transparent',
    fontSize: '1rem',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-sans)', lineHeight: '1.7', overflow: 'visible' },
  // Sin margen lateral: el texto se alinea con el título de la nota.
  '.cm-content': { padding: '1.5rem 0 40vh', caretColor: 'var(--ui-text-highlighted)' },
  '.cm-line': { padding: '0' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--ui-text-highlighted)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--ui-primary) 25%, transparent) !important',
  },
  '.cm-placeholder': { color: 'var(--ui-text-dimmed)' },

  // Títulos: el mismo tamaño con o sin el cursor (solo aparecen los #).
  '.cm-md-h': { color: 'var(--ui-text-highlighted)', fontWeight: '700', lineHeight: '1.3' },
  '.cm-md-h1': { fontSize: '2em', paddingTop: '0.6em', paddingBottom: '0.1em' },
  '.cm-md-h2': { fontSize: '1.6em', paddingTop: '0.55em', paddingBottom: '0.1em' },
  '.cm-md-h3': { fontSize: '1.35em', paddingTop: '0.5em' },
  '.cm-md-h4': { fontSize: '1.15em', paddingTop: '0.4em' },
  '.cm-md-h5': { fontSize: '1em', paddingTop: '0.35em' },
  '.cm-md-h6': { fontSize: '0.9em', paddingTop: '0.35em', color: 'var(--ui-text-muted)' },

  // Símbolos de Markdown visibles (donde está el cursor).
  '.cm-md-mark': { color: 'var(--ui-text-dimmed)', fontWeight: '400' },

  '.cm-md-code': {
    fontFamily: MONO,
    fontSize: '0.9em',
    backgroundColor: 'var(--ui-bg-elevated)',
    borderRadius: '4px',
    padding: '0.1em 0.25em',
  },
  '.cm-md-codeblock': {
    fontFamily: MONO,
    fontSize: '0.9em',
    backgroundColor: 'var(--ui-bg-muted)',
    padding: '0 1rem !important',
  },
  '.cm-md-table': { fontFamily: MONO, fontSize: '0.9em' },
  '.cm-md-quote': {
    borderLeft: '3px solid var(--ui-border-accented)',
    paddingLeft: '1rem !important',
    color: 'var(--ui-text-muted)',
  },
  '.cm-md-link': {
    color: 'var(--ui-primary)',
    textDecoration: 'underline',
    textUnderlineOffset: '3px',
  },
  '.cm-md-bullet': { color: 'var(--ui-text-muted)', padding: '0 0.15em' },
  '.cm-md-task': {
    width: '1em',
    height: '1em',
    margin: '0 0.35em 0 0',
    verticalAlign: '-0.12em',
    accentColor: 'var(--ui-primary)',
    cursor: 'pointer',
  },
  // Imágenes: ocupan su propia franja, sin pasar del ancho del texto. inline-block
  // (no block) para no dejar líneas vacías alrededor del widget.
  '.cm-md-image': { display: 'inline-block', width: '100%', verticalAlign: 'top', margin: '0.5em 0' },
  '.cm-md-image img': {
    display: 'block',
    maxWidth: '100%',
    maxHeight: '32rem',
    height: 'auto',
    borderRadius: '8px',
    border: '1px solid var(--ui-border)',
    cursor: 'text',
  },
  '.cm-md-image-error': {
    display: 'inline-block',
    fontSize: '0.85em',
    color: 'var(--ui-text-muted)',
    backgroundColor: 'var(--ui-bg-elevated)',
    borderRadius: '6px',
    padding: '0.2em 0.6em',
  },
  '.cm-md-hr': {
    display: 'inline-block',
    width: '100%',
    verticalAlign: 'middle',
    borderTop: '1px solid var(--ui-border-accented)',
  },

  // Cursores de otros colaboradores: el nombre siempre visible.
  '.cm-ySelectionInfo': {
    opacity: '1',
    top: '-1.35em',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.7rem',
    fontWeight: '600',
    lineHeight: '1.4',
    padding: '0 0.35em',
    borderRadius: '4px 4px 4px 0',
  },
  '.cm-ySelectionCaretDot': { display: 'none' },
})

/** Colores del texto Markdown y del código dentro de los bloques. */
export const wickHighlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--ui-primary)' },
  { tag: t.url, color: 'var(--ui-text-muted)' },
  { tag: t.processingInstruction, color: 'var(--ui-text-dimmed)' },
  { tag: t.quote, color: 'var(--ui-text-muted)' },
  { tag: t.monospace, fontFamily: MONO },
  // Código
  { tag: [t.keyword, t.controlKeyword, t.modifier, t.operatorKeyword], color: 'var(--ui-chart-3)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--ui-chart-2)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--ui-chart-4)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--ui-text-dimmed)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--ui-chart-6)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--ui-chart-5)' },
  { tag: [t.tagName, t.attributeName, t.propertyName], color: 'var(--ui-chart-6)' },
  { tag: [t.meta, t.documentMeta], color: 'var(--ui-text-muted)' },
])
