import { listDocuments } from '@wick/core'

/** ?q= filtra por título; ?workspace= solo un espacio; ?limit= máximo de resultados. */
export default defineEventHandler((event) => {
  const { q, limit, workspace } = getQuery(event)
  return runCore(
    () =>
      listDocuments(requireUser(event), {
        query: typeof q === 'string' ? q : undefined,
        workspaceId: typeof workspace === 'string' && workspace ? workspace : undefined,
        limit: typeof limit === 'string' ? Number(limit) || undefined : undefined,
      }),
    event,
  )
})
