import { deleteDocument } from '@wick/core'

export default defineEventHandler(async (event) => {
  await runCore(() => deleteDocument(requireId(event)))
  setResponseStatus(event, 204)
  return null
})
