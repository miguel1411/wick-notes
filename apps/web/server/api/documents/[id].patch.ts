import { renameDocument, type RenameDocumentInput } from '@wick/core'

export default defineEventHandler(async (event) => {
  const body = await readJson<RenameDocumentInput>(event)
  return runCore(() => renameDocument(requireUser(event), requireId(event), body), event)
})
