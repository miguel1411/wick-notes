import type { FormError } from '@nuxt/ui'

/**
 * Validación extra para UForm: error en el campo «confirm» si no coincide con
 * la contraseña. El resto de reglas viene de los esquemas de @wick/core/auth/schemas,
 * los mismos que aplica el servidor.
 */
export function passwordsMatch(password?: string, confirm?: string): FormError[] {
  return password && confirm && password !== confirm ? [{ name: 'confirm', message: 'Las contraseñas no coinciden' }] : []
}
