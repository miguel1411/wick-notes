import { listVersions } from '@wick/core'

/** Historial de la nota, de la versión más reciente a la más antigua. */
export default defineEventHandler((event) => runCore(() => listVersions(requireUser(event), requireId(event)), event))
