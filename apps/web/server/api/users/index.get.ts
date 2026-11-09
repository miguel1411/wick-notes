import { listUsers } from '@wick/core'

export default defineEventHandler((event) => runCore(() => listUsers(requireUser(event)), event))
