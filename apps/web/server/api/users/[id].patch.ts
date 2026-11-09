import { updateUser, type UpdateUserInput } from '@wick/core'

export default defineEventHandler(async (event) => {
  const body = await readJson<UpdateUserInput>(event)
  return runCore(() => updateUser(requireUser(event), requireId(event), body), event)
})
