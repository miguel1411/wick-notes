import { getDocument } from '@wick/core'

export default defineEventHandler((event) => runCore(() => getDocument(requireUser(event), requireId(event)), event))
