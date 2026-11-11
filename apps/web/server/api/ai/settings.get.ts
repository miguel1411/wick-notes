import { getAiSettings } from '@wick/core'

/** Ajustes de la IA (solo administradores, con sesión de navegador). La clave nunca sale completa. */
export default defineEventHandler((event) => runCore(() => getAiSettings(requireUser(event)), event))
