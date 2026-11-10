import { listWorkspaces } from '@wick/core'

export default defineEventHandler((event) => runCore(() => listWorkspaces(requireUser(event)), event))
