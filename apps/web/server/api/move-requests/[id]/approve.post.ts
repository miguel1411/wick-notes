import { decideMoveRequest } from '@wick/core'

/** Solo con sesión de navegador (el guardián de la API no deja pasar tokens aquí). */
export default defineEventHandler((event) => runCore(() => decideMoveRequest(requireUser(event), requireId(event), 'approve'), event))
