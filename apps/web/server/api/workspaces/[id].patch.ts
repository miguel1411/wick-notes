import { updateWorkspace, type UpdateWorkspaceInput } from '@wick/core'

/** { name?, everyone? } — solo propietarios. */
export default defineEventHandler(async (event) => {
  const body = await readJson<UpdateWorkspaceInput>(event)
  return runCore(() => updateWorkspace(requireUser(event), requireId(event), body), event)
})
