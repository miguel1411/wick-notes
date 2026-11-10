/** Repositorio oficial de wick notes. */
const OFFICIAL_SOURCE_URL = 'https://github.com/miguel1411/wick-notes'

/**
 * Dónde está el código fuente de esta instalación, para el enlace «Código fuente».
 * La AGPL-3.0 pide ofrecerlo a quien use la app por red; una copia modificada
 * indica la suya en NUXT_PUBLIC_SOURCE_URL.
 */
export function useSourceUrl(): string {
  return useRuntimeConfig().public.sourceUrl || OFFICIAL_SOURCE_URL
}
