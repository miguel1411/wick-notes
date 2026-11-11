import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NodeCompiler } from '@myriaddreamin/typst-ts-node-compiler'
import type { AlignType, Definition, FootnoteDefinition, List, ListItem, Nodes, PhrasingContent, RootContent, Table } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { DEFAULT_TITLE } from './schemas'
import { parseTableDelimiter } from './markdown-table'
import { markdownFilename } from './markdown-title'

/**
 * Exportación a PDF: Markdown → Typst → PDF, sin navegador.
 *
 * Typst se ejecuta dentro del proceso (binario nativo del paquete npm) y trae
 * sus propias fuentes (Libertinus Serif, DejaVu Sans Mono), así que funciona sin
 * internet y sin fuentes instaladas en el servidor.
 *
 * Seguridad: el texto de la nota nunca se escribe como marcado Typst. Todo va
 * dentro de cadenas (`#"…";`), así que `#read(…)`, `$…$` o `*` salen tal cual y
 * no se ejecutan. Además el compilador trabaja en una carpeta vacía.
 */

export interface NotePdfInput {
  title: string
  markdown: string
  /** Línea bajo el título, p. ej. «Actualizada el 10 de noviembre de 2026». */
  subtitle?: string
  /** Origen de la instancia, para convertir enlaces relativos (`/d/…`) en absolutos. */
  baseUrl?: string
  paper?: PdfPaper
}

export type PdfPaper = 'a4' | 'us-letter'

// ---------------------------------------------------------------- Typst seguro

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

/** Literal de cadena Typst (modo código). */
function lit(value: string): string {
  const escaped = value
    .replace(CONTROL_CHARS, '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
  return `"${escaped}"`
}

/** Texto literal dentro de marcado. El `;` cierra la expresión para que lo que siga no la continúe. */
function text(value: string): string {
  return value ? `#${lit(value)};` : ''
}

/** Lenguaje de un bloque de código, solo si es un nombre razonable. */
function codeLang(lang: string | null | undefined): string | null {
  return lang && /^[\w+#.-]{1,32}$/.test(lang) ? lang : null
}

const ALIGN: Record<NonNullable<AlignType>, string> = { left: 'left', center: 'center', right: 'right' }

// ---------------------------------------------------------------- Markdown → Typst

class Converter {
  private readonly definitions = new Map<string, Definition>()
  private readonly footnotes = new Map<string, FootnoteDefinition>()
  private readonly activeFootnotes = new Set<string>()

  private source = ''

  constructor(private readonly baseUrl: string | undefined) {}

  convert(markdown: string): string {
    this.source = markdown
    const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
    this.collect(tree)
    return this.blocks(tree.children)
  }

  /** Definiciones de enlaces (`[x]: url`) y notas al pie, que se usan desde otros sitios. */
  private collect(node: Nodes) {
    if (node.type === 'definition') this.definitions.set(node.identifier, node)
    if (node.type === 'footnoteDefinition') this.footnotes.set(node.identifier, node)
    if ('children' in node) for (const child of node.children) this.collect(child as Nodes)
  }

  private url(raw: string): string {
    if (this.baseUrl && raw.startsWith('/') && !raw.startsWith('//')) return this.baseUrl.replace(/\/+$/, '') + raw
    return raw
  }

  blocks(nodes: RootContent[], separator = '\n\n'): string {
    return nodes
      .map((n) => this.block(n))
      .filter(Boolean)
      .join(separator)
  }

  private block(node: RootContent): string {
    switch (node.type) {
      case 'paragraph':
        return this.inline(node.children)
      case 'heading':
        return `#heading(level: ${node.depth})[${this.inline(node.children)}]`
      case 'thematicBreak':
        return '#line(length: 100%, stroke: 0.5pt + luma(200))'
      case 'blockquote':
        return `#quote(block: true)[${this.blocks(node.children)}]`
      case 'list':
        return this.list(node)
      case 'code': {
        const lang = codeLang(node.lang)
        return `#raw(block: true, ${lang ? `lang: ${lit(lang)}, ` : ''}${lit(node.value)})`
      }
      case 'table':
        return this.table(node)
      case 'html':
        // Los comentarios no se ven en la vista previa; el resto de HTML se muestra como código.
        if (/^<!--[\s\S]*-->$/.test(node.value.trim())) return ''
        return `#raw(block: true, lang: "html", ${lit(node.value)})`
      case 'definition':
      case 'footnoteDefinition':
        return ''
      default:
        // Contenido en línea suelto (no debería pasar en un árbol válido).
        return 'children' in node || 'value' in node ? this.inline([node as PhrasingContent]) : ''
    }
  }

  private list(node: List): string {
    const allTasks = node.children.length > 0 && node.children.every((item) => typeof item.checked === 'boolean')
    const args: string[] = [`tight: ${!node.spread}`]
    if (node.ordered) args.push(`start: ${node.start ?? 1}`)
    // En una lista solo de tareas, la casilla hace de viñeta.
    if (allTasks && !node.ordered) args.push('marker: []', 'body-indent: 0pt')
    const items = node.children.map((item) => `[${this.listItem(item, node.spread === true)}]`)
    return `#${node.ordered ? 'enum' : 'list'}(${[...args, ...items].join(', ')})`
  }

  private listItem(item: ListItem, spread: boolean): string {
    const body = this.blocks(item.children, spread || item.spread ? '\n\n' : '\n')
    if (typeof item.checked !== 'boolean') return body
    return `#wick-task(${item.checked}) ${body}`
  }

  private table(node: Table): string {
    const columns = Math.max(1, ...node.children.map((row) => row.children.length))
    const align = Array.from({ length: columns }, (_, i) => ALIGN[node.align?.[i] ?? 'left'] ?? 'left')
    // Anchos según la fila separadora (`|---|------|`), que el árbol no guarda: se lee del texto.
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    const delimiter = start !== undefined && end !== undefined ? this.source.slice(start, end).split('\n')[1] : undefined
    const widths = delimiter ? parseTableDelimiter(delimiter).widths : null
    const rows = node.children.map((row) => {
      const cells = row.children.map((cell) => `[${this.inline(cell.children)}]`)
      while (cells.length < columns) cells.push('[]')
      return cells.slice(0, columns).join(', ')
    })
    const [header, ...body] = rows
    const cols = widths?.length === columns ? `(${widths.map((w) => `${w}fr`).join(', ')})` : `${columns}`
    const parts = [`columns: ${cols}`, `align: (${align.join(', ')},)`, `table.header(${header})`, ...body]
    return `#table(${parts.join(', ')})`
  }

  inline(nodes: PhrasingContent[]): string {
    return nodes.map((n) => this.phrasing(n)).join('')
  }

  private phrasing(node: PhrasingContent): string {
    switch (node.type) {
      case 'text':
        // Saltos de línea simples = espacio, como en la vista previa.
        return text(node.value.replace(/[ \t]*\r?\n[ \t]*/g, ' '))
      case 'emphasis':
        return `#emph[${this.inline(node.children)}]`
      case 'strong':
        return `#strong[${this.inline(node.children)}]`
      case 'delete':
        return `#strike[${this.inline(node.children)}]`
      case 'inlineCode':
        return `#raw(${lit(node.value)})`
      case 'break':
        return '#linebreak()'
      case 'html':
        return text(node.value)
      case 'link':
        return this.link(node.url, node.children.length ? this.inline(node.children) : text(node.url))
      case 'image':
        return this.image(node.url, node.alt)
      case 'linkReference': {
        const def = this.definitions.get(node.identifier)
        if (def) return this.link(def.url, this.inline(node.children))
        return text('[') + this.inline(node.children) + text(this.referenceSuffix(node.referenceType, node.label))
      }
      case 'imageReference': {
        const def = this.definitions.get(node.identifier)
        if (def) return this.image(def.url, node.alt)
        return text(`![${node.alt ?? ''}${this.referenceSuffix(node.referenceType, node.label)}`)
      }
      case 'footnoteReference': {
        const def = this.footnotes.get(node.identifier)
        // Una nota al pie que se cita a sí misma se queda como texto.
        if (!def || this.activeFootnotes.has(node.identifier)) return text(`[^${node.label ?? node.identifier}]`)
        this.activeFootnotes.add(node.identifier)
        const body = this.blocks(def.children)
        this.activeFootnotes.delete(node.identifier)
        return `#footnote[${body}]`
      }
      default:
        return ''
    }
  }

  private referenceSuffix(type: 'full' | 'collapsed' | 'shortcut', label: string | null | undefined): string {
    if (type === 'full') return `][${label ?? ''}]`
    if (type === 'collapsed') return '][]'
    return ']'
  }

  private link(rawUrl: string, content: string): string {
    const url = this.url(rawUrl)
    return url ? `#link(${lit(url)})[${content}]` : content
  }

  /** Las imágenes no se descargan (la instancia puede no tener internet): se dejan como enlace. */
  private image(rawUrl: string, alt: string | null | undefined): string {
    const label = `#emph[${text(`[Imagen: ${alt?.trim() || rawUrl}]`)}]`
    return /^https?:\/\//i.test(this.url(rawUrl)) ? this.link(rawUrl, label) : label
  }
}

/** Cuerpo de la nota (Markdown) traducido a marcado Typst. */
export function markdownToTypst(markdown: string, options: { baseUrl?: string } = {}): string {
  return new Converter(options.baseUrl).convert(markdown)
}

/** Documento Typst completo: estilos, título y contenido. */
export function noteToTypst(input: NotePdfInput): string {
  const title = input.title.replace(/\s+/g, ' ').trim() || DEFAULT_TITLE
  const body = markdownToTypst(input.markdown, { baseUrl: input.baseUrl })
  const paper = input.paper === 'us-letter' ? 'us-letter' : 'a4'
  return `${preamble(title, paper)}
#block(below: 1em, par(justify: false, text(size: 2em, weight: "bold", hyphenate: false)[${text(title)}]))
${input.subtitle ? `#block(below: 1em, text(size: 0.9em, fill: luma(110))[${text(input.subtitle)}])\n` : ''}#line(length: 100%, stroke: 0.5pt + luma(210))

${body}
`
}

function preamble(title: string, paper: PdfPaper): string {
  return `#set document(title: ${lit(title)})
#set page(paper: "${paper}", margin: (x: 2.2cm, top: 2.2cm, bottom: 2.4cm), numbering: "1 / 1", number-align: center)
#set text(font: "Libertinus Serif", size: 10.5pt, lang: "es")
#set par(justify: true, leading: 0.62em)
#show heading: set block(above: 1.4em, below: 0.75em)
#show heading.where(level: 1): set text(size: 1.45em)
#show heading.where(level: 2): set text(size: 1.25em)
#show heading.where(level: 3): set text(size: 1.1em)
#show raw: set text(font: "DejaVu Sans Mono", size: 0.86em)
#show raw.where(block: false): box.with(fill: luma(242), inset: (x: 3pt), outset: (y: 2.5pt), radius: 2pt)
#show raw.where(block: true): set par(justify: false)
#show raw.where(block: true): block.with(width: 100%, fill: luma(246), stroke: 0.5pt + luma(222), inset: 9pt, radius: 4pt)
#show quote.where(block: true): it => block(stroke: (left: 2pt + luma(205)), inset: (left: 10pt, y: 3pt), text(fill: luma(70), it.body))
#show link: set text(fill: rgb("#1d4ed8"))
#set table(stroke: 0.5pt + luma(205), inset: (x: 6pt, y: 5pt))
#show table: set par(justify: false)
#show table.cell.where(y: 0): set text(weight: "bold")
#let wick-task(done) = box(width: 0.8em, height: 0.8em, baseline: 0.08em, stroke: 0.6pt + luma(110), radius: 1.5pt, fill: if done { luma(232) } else { none }, if done { align(center + horizon, text(size: 0.75em, font: "DejaVu Sans Mono", "✓")) })
`
}

// ---------------------------------------------------------------- PDF

let compiler: Promise<NodeCompiler> | null = null

/**
 * Un único compilador por proceso (cargar fuentes cuesta), creado al primer PDF.
 * Trabaja en una carpeta vacía: aunque el documento intentara leer ficheros, no hay ninguno.
 */
function getCompiler(): Promise<NodeCompiler> {
  compiler ??= (async () => {
    const { NodeCompiler } = await import('@myriaddreamin/typst-ts-node-compiler')
    const workspace = await mkdtemp(join(tmpdir(), 'wick-pdf-'))
    return NodeCompiler.create({ workspace })
  })().catch((err) => {
    compiler = null
    throw err
  })
  return compiler
}

export class PdfRenderError extends Error {
  constructor(readonly diagnostics: unknown) {
    super('No se pudo generar el PDF de esta nota')
  }
}

/** Compila un documento Typst a PDF. */
export async function renderTypstPdf(source: string): Promise<Uint8Array> {
  const c = await getCompiler()
  try {
    const result = c.compile({ mainFileContent: source })
    if (result.hasError() || !result.result) {
      const error = result.takeError()
      throw new PdfRenderError(error ? c.fetchDiagnostics(error) : null)
    }
    return new Uint8Array(c.pdf(result.result))
  } finally {
    // Libera lo memorizado de compilaciones anteriores (cada nota es distinta).
    c.evictCache(10)
  }
}

/** PDF de una nota: título, línea opcional bajo el título y contenido. */
export function renderNotePdf(input: NotePdfInput): Promise<Uint8Array> {
  return renderTypstPdf(noteToTypst(input))
}

/** Nombre de fichero seguro para el PDF de una nota. */
export function pdfFilename(title: string): string {
  return markdownFilename(title).replace(/\.md$/, '.pdf')
}
