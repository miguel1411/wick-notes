import type { z } from 'zod'
import { ValidationError } from './errors'

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message ?? 'Datos inválidos', result.error.issues)
  }
  return result.data
}
