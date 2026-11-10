import { createFolder } from '@wick/core'

/** { name, parentId? } */
export default defineEventHandler(async (event) => {
  const body = await readJson<{ name: string; parentId?: string | null }>(event)
  const folder = await runCore(() => createFolder(requireUser(event), requireId(event), body), event)
  setResponseStatus(event, 201)
  return folder
})
