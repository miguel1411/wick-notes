import { renameDocument } from '@wick/core'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) ?? {}
  return runCore(() => renameDocument(requireId(event), body))
})
