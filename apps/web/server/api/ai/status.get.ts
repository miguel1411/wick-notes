import { getAiStatus } from '@wick/core'

/** Si «Nota desde foto» está disponible y cuántas notas con IA le quedan hoy al usuario. */
export default defineEventHandler((event) => runCore(() => getAiStatus(requireUser(event)), event))
