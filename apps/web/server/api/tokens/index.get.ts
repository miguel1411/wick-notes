import { listApiTokens } from '@wick/core'

export default defineEventHandler((event) => runCore(() => listApiTokens(requireUser(event)), event))
