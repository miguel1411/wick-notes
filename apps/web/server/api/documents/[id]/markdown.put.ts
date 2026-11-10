import { writeMarkdownInput, type WriteMarkdownInput } from '@wick/core'

/**
 * Escribe Markdown en la nota: `replace` (por defecto) la deja con exactamente ese
 * contenido; `append` lo añade al final. Se aplica sobre el documento vivo, así que
 * se integra con lo que otras personas estén escribiendo en ese momento.
 */
export default defineEventHandler(async (event) => {
  assertBodySize(event)
  const user = requireUser(event)
  const doc = await requireWritableDocument(event, requireId(event))
  const input = await runCore(async () => parseInput(writeMarkdownInput, await readJson<WriteMarkdownInput>(event)), event)
  await writeDocumentMarkdown(doc.id, user.id, input.markdown, input.mode)
  setResponseStatus(event, 204)
  return null
})
