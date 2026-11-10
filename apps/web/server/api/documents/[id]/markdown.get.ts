import { getDocument, markdownFilename, REVISION_HEADER, withTitleHeading } from '@wick/core'

/**
 * Contenido de la nota en Markdown (sin el título).
 * Con ?download=1 devuelve un fichero .md con el título como `# Título`.
 *
 * La cabecera X-Wick-Revision identifica lo leído: al reescribir la nota con
 * `baseRevision`, se conserva lo que otras personas escriban mientras tanto.
 */
export default defineEventHandler(async (event) => {
  const doc = await runCore(() => getDocument(requireUser(event), requireId(event)), event)
  const { markdown: body, revision } = await getDocumentContent(doc.id)
  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, REVISION_HEADER, revision)

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
