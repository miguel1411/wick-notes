import { deleteWorkspace } from '@wick/core'

/** Solo espacios vacíos, y solo propietarios. */
export default defineEventHandler(async (event) => {
  await runCore(() => deleteWorkspace(requireUser(event), requireId(event)), event)
  setResponseStatus(event, 204)
  return null
})
