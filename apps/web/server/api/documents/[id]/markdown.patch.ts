import { editMarkdownInput, type EditMarkdownInput } from '@wick/core'

/**
 * Cambios puntuales en la nota: { edits: [{ find, replace }] }. Cada `find` debe
 * aparecer exactamente una vez en el contenido actual y pasa a ser `replace`; el
 * resto de la nota no se toca. Todo o nada: si un fragmento no está o se repite,
 * responde 409 sin cambiar nada.
 *
 * Devuelve { revision, merged }.
 */
export default defineEventHandler(async (event) => {
  assertBodySize(event)
  const user = requireUser(event)
  const doc = await requireWritableDocument(event, requireId(event))
  const input = await runCore(async () => parseInput(editMarkdownInput, await readJson<EditMarkdownInput>(event)), event)
  return editDocumentMarkdown(doc.id, user.id, input.edits)
})
