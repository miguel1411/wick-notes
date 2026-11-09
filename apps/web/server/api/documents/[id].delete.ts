import { deleteDocument } from '@wick/core'

export default defineEventHandler(async (event) => {
  await runCore(() => deleteDocument(requireUser(event), requireId(event)), event)
  setResponseStatus(event, 204)
  return null
})
