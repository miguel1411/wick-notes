/**
 * Hilo de conversión Markdown ↔ Yjs.
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
const Y = await import('yjs')
const { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } = await import('y-prosemirror')

type Node = ReturnType<ReturnType<typeof getParser>>

// Debe coincidir con la configuración del editor en apps/web (CollabEditor.vue).
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

function toMarkdown(state: Uint8Array | null): string {
  const node = docToNode(loadDoc(state))
  return node ? serializer(node) : ''
}

/** Estado completo de un documento nuevo con este Markdown. */
function fromMarkdown(markdown: string): Uint8Array {
  const ydoc = new Y.Doc()
  prosemirrorToYXmlFragment(parser(markdown), ydoc.getXmlFragment(FRAGMENT))
  return Y.encodeStateAsUpdate(ydoc)
}

/**
 * Cambios Yjs que convierten el documento `state` en `markdown`.
 * Se calcula por diferencias, así que se puede aplicar sobre el documento vivo
 * aunque otras personas lo estén editando a la vez.
 */
function replaceUpdate(state: Uint8Array | null, markdown: string): Uint8Array {
  const ydoc = loadDoc(state)
  const before = Y.encodeStateVector(ydoc)
  prosemirrorToYXmlFragment(parser(markdown), ydoc.getXmlFragment(FRAGMENT))
  return Y.encodeStateAsUpdate(ydoc, before)
}

/** Cambios Yjs que añaden `markdown` al final del documento. */
function appendUpdate(state: Uint8Array | null, markdown: string): Uint8Array {
  const ydoc = loadDoc(state)
  const current = docToNode(ydoc)
  const added = parser(markdown)
  if (!current) return replaceUpdate(state, markdown)

  // Si el documento termina en un párrafo vacío (el que deja el editor), se reutiliza.
  let content = current.content
  const last = content.lastChild
  if (last && last.type.name === 'paragraph' && last.content.size === 0) {
    content = content.cut(0, content.size - last.nodeSize)
  }
  const combined = schema.topNodeType.create(current.attrs, content.append(added.content))

  const before = Y.encodeStateVector(ydoc)
  prosemirrorToYXmlFragment(combined, ydoc.getXmlFragment(FRAGMENT))
  return Y.encodeStateAsUpdate(ydoc, before)
}

/**
 * Cambios Yjs que llevan el documento `state` al contenido de `target` (otra
 * versión de la misma nota). Por diferencias, igual que replaceUpdate.
 */
function restoreUpdate(state: Uint8Array | null, target: Uint8Array): Uint8Array {
  const node = docToNode(loadDoc(target)) ?? schema.topNodeType.createAndFill()!
  const ydoc = loadDoc(state)
  const before = Y.encodeStateVector(ydoc)
  prosemirrorToYXmlFragment(node, ydoc.getXmlFragment(FRAGMENT))
  return Y.encodeStateAsUpdate(ydoc, before)
}

type Request =
  | { id: number; op: 'toMarkdown'; state: Uint8Array | null }
  | { id: number; op: 'fromMarkdown'; markdown: string }
  | { id: number; op: 'replaceUpdate'; state: Uint8Array | null; markdown: string }
  | { id: number; op: 'appendUpdate'; state: Uint8Array | null; markdown: string }
  | { id: number; op: 'restoreUpdate'; state: Uint8Array | null; target: Uint8Array }

function handle(req: Request): string | Uint8Array {
  switch (req.op) {
    case 'toMarkdown':
      return toMarkdown(req.state)
    case 'fromMarkdown':
      return fromMarkdown(req.markdown)
    case 'replaceUpdate':
      return replaceUpdate(req.state, req.markdown)
    case 'appendUpdate':
      return appendUpdate(req.state, req.markdown)
    case 'restoreUpdate':
      return restoreUpdate(req.state, req.target)
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
