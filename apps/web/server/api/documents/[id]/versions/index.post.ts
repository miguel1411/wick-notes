import { getDocument } from '@wick/core'

/** Guarda ahora una versión del contenido actual. */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const doc = await runCore(() => getDocument(user, requireId(event)), event)
  const version = await saveDocumentVersion(doc.id, user.id)
  setResponseStatus(event, 201)
  return version
})
