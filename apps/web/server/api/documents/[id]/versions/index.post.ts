/** Guarda ahora una versión del contenido actual. */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const doc = await requireWritableDocument(event, requireId(event))
  const version = await saveDocumentVersion(doc.id, user.id)
  setResponseStatus(event, 201)
  return version
})
