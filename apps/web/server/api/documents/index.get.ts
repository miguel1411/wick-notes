import { listDocuments } from '@wick/core'

export default defineEventHandler(() => runCore(() => listDocuments()))
