import { moveFolder, renameFolder, type FolderSummary } from '@wick/core'

/** { name? } para renombrar y/o { parentId: string | null } para mover. */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const id = requireId(event)
  const body = await readJson<{ name?: string; parentId?: string | null }>(event)
  let folder: FolderSummary | undefined
  if (body.name !== undefined) folder = await runCore(() => renameFolder(user, id, body.name!), event)
  if (body.parentId !== undefined) folder = await runCore(() => moveFolder(user, id, body.parentId ?? null), event)
  if (!folder) throw createError({ statusCode: 400, message: 'No hay nada que cambiar' })
  return folder
})
