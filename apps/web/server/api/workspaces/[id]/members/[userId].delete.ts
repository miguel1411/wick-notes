import { removeWorkspaceMember } from '@wick/core'

export default defineEventHandler(async (event) => {
  await runCore(() => removeWorkspaceMember(requireUser(event), requireId(event), getRouterParam(event, 'userId') ?? ''), event)
  setResponseStatus(event, 204)
  return null
})
