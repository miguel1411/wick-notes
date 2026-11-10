/**
 * Restaura una versión (contenido y título). Antes se guarda la versión actual,
 * y el cambio llega en vivo a quien tenga la nota abierta.
 */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const doc = await requireWritableDocument(event, requireId(event))
  await restoreDocumentVersion(doc.id, getRouterParam(event, 'vid') ?? '', user.id)
  setResponseStatus(event, 204)
  return null
})
