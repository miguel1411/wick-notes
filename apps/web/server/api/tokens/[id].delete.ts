import { revokeApiToken } from '@wick/core'

export default defineEventHandler(async (event) => {
  await runCore(() => revokeApiToken(requireUser(event), requireId(event)), event)
  setResponseStatus(event, 204)
  return null
})
