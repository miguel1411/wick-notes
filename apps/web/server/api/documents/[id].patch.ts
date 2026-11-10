import { updateDocument, type UpdateDocumentInput } from '@wick/core'

/** Cambia el título y/o mueve la nota: { title?, workspaceId?, folderId? } */

export default defineEventHandler(async (event) => {
  const body = await readJson<UpdateDocumentInput>(event)
  return runCore(() => updateDocument(requireUser(event), requireId(event), body), event)
})
