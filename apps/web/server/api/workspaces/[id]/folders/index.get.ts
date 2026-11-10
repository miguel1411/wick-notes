import { listFolders } from '@wick/core'

export default defineEventHandler((event) => runCore(() => listFolders(requireUser(event), requireId(event)), event))
