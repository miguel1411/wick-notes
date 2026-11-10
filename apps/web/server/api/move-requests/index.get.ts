import { listMoveRequests, type MoveRequestStatus } from '@wick/core'

/** Solicitudes de mis agentes. ?status=pending para las que esperan aprobación. */
export default defineEventHandler((event) => {
  const { status } = getQuery(event)
  return runCore(
    () => listMoveRequests(requireUser(event), { status: typeof status === 'string' ? (status as MoveRequestStatus) : undefined }),
    event,
  )
})
