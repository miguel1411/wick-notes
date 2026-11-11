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
    setAttachment(event, markdownFilename(doc.title))
    return withTitleHeading(doc.title, body)
  }
  return body
})
