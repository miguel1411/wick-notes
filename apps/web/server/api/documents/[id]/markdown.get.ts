import { getDocument, markdownFilename, withTitleHeading } from '@wick/core'

/**
 * Contenido de la nota en Markdown (sin el título).
 * Con ?download=1 devuelve un fichero .md con el título como `# Título`.
 */
export default defineEventHandler(async (event) => {
  const doc = await runCore(() => getDocument(requireUser(event), requireId(event)), event)
  const body = await getDocumentMarkdown(doc.id)
  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-store')

  if (getQuery(event).download) {
    const filename = markdownFilename(doc.title)
    setResponseHeader(
      event,
      'Content-Disposition',
      `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    )
    return withTitleHeading(doc.title, body)
  }
  return body
})
