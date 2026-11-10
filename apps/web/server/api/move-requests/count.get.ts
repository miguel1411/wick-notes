import { countPendingMoveRequests } from '@wick/core'

export default defineEventHandler(async (event) => ({ pending: await runCore(() => countPendingMoveRequests(requireUser(event)), event) }))
