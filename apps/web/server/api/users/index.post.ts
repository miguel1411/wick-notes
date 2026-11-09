import { createUser, type CreateUserInput } from '@wick/core'

export default defineEventHandler(async (event) => {
  const body = await readJson<CreateUserInput>(event)
  const user = await runCore(() => createUser(requireUser(event), body), event)
  setResponseStatus(event, 201)
  return user
})
