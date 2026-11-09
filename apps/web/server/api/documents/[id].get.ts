import { getDocument } from '@wick/core'

export default defineEventHandler((event) => runCore(() => getDocument(requireId(event))))
