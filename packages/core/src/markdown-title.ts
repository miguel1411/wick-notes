import { DEFAULT_TITLE } from './schemas'

/**
 * El título de una nota vive aparte del contenido. En un fichero .md se
 * representa como un encabezado `# Título` al principio, para que el archivo
 * sea autoexplicativo y la importación lo recupere.
 */

const H1 = /^#[ \t]+(.+?)[ \t#]*$/

/** Si el Markdown empieza por un `# Encabezado`, lo separa del resto. */
export function splitTitleFromMarkdown(markdown: string): { title: string | null; body: string } {
  const text = markdown.replace(/^﻿/, '')
  const lines = text.split(/\r?\n/)
  let i = 0
  while (i < lines.length && lines[i]!.trim() === '') i++
  const match = lines[i]?.match(H1)
  if (!match) return { title: null, body: text }
  const body = lines.slice(i + 1).join('\n').replace(/^\s*\n/, '')
  return { title: match[1]!.trim(), body }
}

/** Fichero .md exportado: `# Título` seguido del contenido. */
export function withTitleHeading(title: string, body: string): string {
  const heading = `# ${title.replace(/\s+/g, ' ').trim() || DEFAULT_TITLE}`
  return body.trim() ? `${heading}\n\n${body.replace(/^\s+/, '')}` : `${heading}\n`
}

/** Título a partir de un nombre de fichero: «notas-de-red.md» → «notas-de-red». */
export function titleFromFilename(filename: string | undefined): string | null {
  if (!filename) return null
  const base = filename.split(/[\\/]/).pop()!.replace(/\.(md|markdown|mdown|txt)$/i, '').trim()
  return base || null
}

/** Nombre de fichero seguro para descargar una nota. */
export function markdownFilename(title: string): string {
  const safe = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .replace(/^[.\-\s]+|[.\-\s]+$/g, '')
  return `${safe || 'nota'}.md`
}
