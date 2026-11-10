import { writeMarkdownInput, type WriteMarkdownInput } from '@wick/core'

/**
 * Escribe Markdown en la nota: `replace` (por defecto) la deja con ese contenido;
 * `append` lo añade al final. Se aplica sobre el documento vivo, así que se
 * integra con lo que otras personas estén escribiendo en ese momento.
 *
 * Con `baseRevision` (la cabecera X-Wick-Revision de la lectura), `replace` se
 * calcula sobre lo que se leyó: lo que otras personas escribieron desde entonces
 * se conserva. Si esa revisión ya no está disponible responde 409.
 *
 * Devuelve { revision, merged }: la revisión nueva y si se unió con cambios ajenos.
 */
export default defineEventHandler(async (event) => {
  assertBodySize(event)
  const user = requireUser(event)
  const doc = await requireWritableDocument(event, requireId(event))
  const input = await runCore(async () => parseInput(writeMarkdownInput, await readJson<WriteMarkdownInput>(event)), event)
  if (input.baseRevision && input.mode !== 'replace') {
    throw createError({ statusCode: 400, message: 'baseRevision solo vale con mode "replace"' })
  }
  return writeDocumentMarkdown(doc.id, user.id, input.markdown, input.mode, input.baseRevision)
})
