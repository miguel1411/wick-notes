import { deleteFolder } from '@wick/core'

/** Borra la carpeta; su contenido pasa a la carpeta superior. */
export default defineEventHandler(async (event) => {
  await runCore(() => deleteFolder(requireUser(event), requireId(event)), event)
  setResponseStatus(event, 204)
  return null
})
