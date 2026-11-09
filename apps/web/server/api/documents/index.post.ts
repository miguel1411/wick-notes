import { createDocument, type CreateDocumentInput } from '@wick/core'

export default defineEventHandler(async (event) => {
  const body = await readJson<CreateDocumentInput>(event)
  const doc = await runCore(() => createDocument(requireUser(event), body), event)
  setResponseStatus(event, 201)
  return doc
})
