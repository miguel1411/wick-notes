import { z } from 'zod'

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'El usuario debe tener al menos 3 caracteres')
  .max(32, 'El usuario no puede superar 32 caracteres')
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'Usa solo letras sin acentos, números, punto, guion o guion bajo')

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Escribe un nombre')
  .max(80, 'El nombre no puede superar 80 caracteres')

export const passwordSchema = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(256, 'La contraseña no puede superar 256 caracteres')

export const roleSchema = z.enum(['ADMIN', 'MEMBER'])

export const loginInput = z.object({
  // Al iniciar sesión no se valida el formato: solo se compara.
  username: z.string().trim().toLowerCase().max(64),
  password: z.string().max(256),
})

export const setupInput = z.object({
  username: usernameSchema,
  name: displayNameSchema,
  password: passwordSchema,
})

export const createUserInput = z.object({
  username: usernameSchema,
  name: displayNameSchema,
  password: passwordSchema,
  role: roleSchema.default('MEMBER'),
})

export const updateUserInput = z
  .object({
    name: displayNameSchema.optional(),
    role: roleSchema.optional(),
    disabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No hay nada que cambiar')

export const resetPasswordInput = z.object({ password: passwordSchema })

export const changeOwnPasswordInput = z.object({
  currentPassword: z.string().max(256),
  newPassword: passwordSchema,
})

export type LoginInput = z.input<typeof loginInput>
export type SetupInput = z.input<typeof setupInput>
export type CreateUserInput = z.input<typeof createUserInput>
export type UpdateUserInput = z.input<typeof updateUserInput>
export type ChangeOwnPasswordInput = z.input<typeof changeOwnPasswordInput>
