import { createDocument } from '@wick/core'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) ?? {}
  setResponseStatus(event, 201)
  return runCore(() => createDocument(body))
})
