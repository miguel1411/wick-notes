import { listDocuments } from '@wick/core'

export default defineEventHandler((event) => runCore(() => listDocuments(requireUser(event)), event))
