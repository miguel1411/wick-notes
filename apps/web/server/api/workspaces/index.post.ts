import { createWorkspace, type CreateWorkspaceInput } from '@wick/core'

/** Cualquier usuario puede crear un espacio; queda como propietario. */
export default defineEventHandler(async (event) => {
  const body = await readJson<CreateWorkspaceInput>(event)
  const ws = await runCore(() => createWorkspace(requireUser(event), body), event)
  setResponseStatus(event, 201)
  return ws
})
