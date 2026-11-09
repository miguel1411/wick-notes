import { isSetupRequired } from '@wick/core'

/** Lo que la interfaz necesita saber al arrancar: ¿hay que crear el admin? ¿quién soy? */
export default defineEventHandler(async (event) => ({
  setupRequired: await isSetupRequired(),
  user: event.context.auth?.user ?? null,
}))
