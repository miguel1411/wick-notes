import { listUserDirectory } from '@wick/core'

/** Personas con cuenta activa (id, usuario y nombre), para añadir miembros a un espacio. */
export default defineEventHandler((event) => runCore(() => listUserDirectory(requireUser(event)), event))
