import { listWorkspaceMembers } from '@wick/core'

export default defineEventHandler((event) => runCore(() => listWorkspaceMembers(requireUser(event), requireId(event)), event))
