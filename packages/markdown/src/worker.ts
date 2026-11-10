/**
 * Hilo de conversión del formato ANTERIOR de las notas (Y.XmlFragment de
 * Milkdown) a Markdown. Solo para la migración; ver index.ts.
 *
 * Usa el mismo editor que el navegador (Milkdown Crepe, con las mismas funciones
 * activas) sobre un DOM simulado (happy-dom). Así el esquema es idéntico al de la
 * web y lo que se exporta se vuelve a importar igual.
 *
 * Vive en un worker para que los globales del DOM simulado (window, document…)
 * no contaminen el proceso principal.
 *
 * Este archivo se ejecuta directamente con Node (o tsx): solo usa sintaxis de
 * TypeScript que se puede eliminar sin compilar e importa únicamente paquetes.
 */
import { parentPort } from 'node:worker_threads'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

GlobalRegistrator.register({ url: 'http://localhost/' })

// KaTeX avisa del "quirks mode" del DOM simulado; no afecta a la conversión.
const originalWarn = console.warn
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('quirks mode')) return
  originalWarn(...args)
}

const { Crepe, CrepeFeature } = await import('@milkdown/crepe')
const { parserCtx, schemaCtx, serializerCtx } = await import('@milkdown/kit/core')
const { Transform } = await import('@milkdown/kit/prose/transform')
const Y = await import('yjs')
const { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } = await import('y-prosemirror')

type Node = ReturnType<ReturnType<typeof getParser>>

// Misma configuración que tenía el editor web (Milkdown Crepe) en ese formato.
const root = document.createElement('div')
document.body.appendChild(root)
const crepe = new Crepe({
  root,
  defaultValue: '',
  features: {
    [CrepeFeature.AI]: false,
    [CrepeFeature.ImageBlock]: false,
    [CrepeFeature.TopBar]: false,
  },
})
await crepe.create()

function getParser() {
  return crepe.editor.ctx.get(parserCtx)
}
const parser = getParser()
const serializer = crepe.editor.ctx.get(serializerCtx)
const schema = crepe.editor.ctx.get(schemaCtx)

/** Nombre del fragmento Yjs que usa el editor colaborativo (y-prosemirror). */
const FRAGMENT = 'prosemirror'

function loadDoc(state: Uint8Array | null): InstanceType<typeof Y.Doc> {
  const ydoc = new Y.Doc()
  if (state && state.length) Y.applyUpdate(ydoc, state)
  return ydoc
}

function docToNode(ydoc: InstanceType<typeof Y.Doc>): Node | null {
  const fragment = ydoc.getXmlFragment(FRAGMENT)
  if (fragment.length === 0) return null
  return yXmlFragmentToProseMirrorRootNode(fragment, schema) as Node
}

/**
 * Quita los espacios y tabuladores del principio y del final de cada línea de
 * texto (párrafos, encabezados…, y alrededor de los saltos de línea). En Markdown
 * no significan nada, y el serializador los escaparía como `&#x20;` o `&#x9;`.
 * No toca bloques de código ni código en línea, donde sí importan.
 */
function trimLineWhitespace(doc: Node): Node {
  const ranges: [number, number][] = []
  const hasCode = (n: Node) => n.marks.some((m) => m.type.spec.code)

  doc.descendants((block, pos) => {
    if (!block.isTextblock) return true
    if (block.type.spec.code) return false
    // Tramos de la línea separados por saltos de línea (hardbreak).
    const segments: { node: Node; from: number }[][] = [[]]
    block.forEach((child, offset) => {
      if (child.type.name === 'hardbreak') segments.push([])
      else segments.at(-1)!.push({ node: child, from: pos + 1 + offset })
    })
    for (const seg of segments) {
      const first = seg[0]
      const last = seg.at(-1)
      if (first?.node.isText && !hasCode(first.node)) {
        const lead = first.node.text!.match(/^[ \t]+/)?.[0].length ?? 0
        if (lead) ranges.push([first.from, first.from + lead])
      }
      if (last?.node.isText && !hasCode(last.node)) {
        const text = last.node.text!
        const trail = text.match(/[ \t]+$/)?.[0].length ?? 0
        // Si el tramo es solo espacios, ya lo cubre el recorte del principio.
        const start = last.from + text.length - trail
        if (trail && !(last === first && trail === text.length)) ranges.push([start, last.from + text.length])
      }
    }
    return false
  })

  if (!ranges.length) return doc
  const tr = new Transform(doc)
  for (const [from, to] of ranges.sort((a, b) => b[0] - a[0])) tr.delete(from, to)
  return tr.doc as Node
}

/**
 * Quita los párrafos vacíos (líneas en blanco o solo con espacios). El
 * serializador los escribiría como `<br />` para conservar el hueco. Si un
 * contenedor (lista, cita…) solo tiene párrafos vacíos, se conserva uno, porque
 * el esquema exige al menos un bloque.
 */
function dropEmptyParagraphs(doc: Node): Node {
  const ranges: [number, number][] = []
  const isEmpty = (n: Node) => n.type.name === 'paragraph' && n.content.size === 0

  const visit = (parent: Node, contentStart: number) => {
    const empties: [number, number][] = []
    parent.forEach((child, offset) => {
      const from = contentStart + offset
      if (isEmpty(child)) empties.push([from, from + child.nodeSize])
      else if (!child.isTextblock && !child.isLeaf) visit(child, from + 1)
    })
    // Si todos los hijos están vacíos, se deja el primero.
    ranges.push(...(empties.length === parent.childCount ? empties.slice(1) : empties))
  }
  visit(doc, 0)

  if (!ranges.length) return doc
  const tr = new Transform(doc)
  for (const [from, to] of ranges.sort((a, b) => b[0] - a[0])) tr.delete(from, to)
  return tr.doc as Node
}

function toMarkdown(state: Uint8Array | null): string {
  const node = docToNode(loadDoc(state))
  if (!node) return ''
  const markdown = serializer(dropEmptyParagraphs(trimLineWhitespace(node)))
  // Un documento sin nada más que líneas en blanco queda vacío.
  return markdown.trim() === '<br />' ? '' : markdown
}

/** Estado completo de un documento nuevo con este Markdown. */
function fromMarkdown(markdown: string): Uint8Array {
  const ydoc = new Y.Doc()
  prosemirrorToYXmlFragment(parser(markdown), ydoc.getXmlFragment(FRAGMENT))
  return Y.encodeStateAsUpdate(ydoc)
}

type Request =
  | { id: number; op: 'toMarkdown'; state: Uint8Array | null }
  | { id: number; op: 'fromMarkdown'; markdown: string }

function handle(req: Request): string | Uint8Array {
  switch (req.op) {
    case 'toMarkdown':
      return toMarkdown(req.state)
    case 'fromMarkdown':
      return fromMarkdown(req.markdown)
  }
}

parentPort!.on('message', (req: Request) => {
  try {
    const result = handle(req)
    parentPort!.postMessage({ id: req.id, ok: true, result })
  } catch (err) {
    parentPort!.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})

parentPort!.postMessage({ ready: true })
