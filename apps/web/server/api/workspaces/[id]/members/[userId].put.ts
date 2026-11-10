import { setWorkspaceMember, type WorkspaceRole } from '@wick/core'

/** Añade o cambia el rol de un miembro: { role: "owner" | "editor" | "viewer" } */
export default defineEventHandler(async (event) => {
  const { role } = await readJson<{ role: WorkspaceRole }>(event)
  return runCore(
    () => setWorkspaceMember(requireUser(event), requireId(event), getRouterParam(event, 'userId') ?? '', role),
    event,
  )
})
