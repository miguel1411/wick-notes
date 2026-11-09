import { z } from 'zod'

export const DEFAULT_TITLE = 'Sin título'

export const documentIdSchema = z.string().trim().min(1).max(64)

export const titleSchema = z
  .string()
  .trim()
  .max(200, 'El título no puede superar 200 caracteres')
  .transform((t) => t || DEFAULT_TITLE)

export const createDocumentInput = z.object({
  title: titleSchema.optional(),
})

export const renameDocumentInput = z.object({
  title: titleSchema,
})

export type CreateDocumentInput = z.input<typeof createDocumentInput>
export type RenameDocumentInput = z.input<typeof renameDocumentInput>
