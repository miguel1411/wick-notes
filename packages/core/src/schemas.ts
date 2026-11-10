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
  /** Espacio de trabajo; por defecto, el primero en el que se puede escribir. */
  workspaceId: z.string().min(1).optional(),
  folderId: z.string().min(1).nullable().optional(),
})

export const renameDocumentInput = z.object({
  title: titleSchema,
})

/** Cambios de metadatos de una nota: título y/o ubicación. */
export const updateDocumentInput = z
  .object({
    title: titleSchema.optional(),
    workspaceId: z.string().min(1).optional(),
    folderId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No hay nada que cambiar')
export type UpdateDocumentInput = z.input<typeof updateDocumentInput>

export type CreateDocumentInput = z.input<typeof createDocumentInput>
export type RenameDocumentInput = z.input<typeof renameDocumentInput>

/** Tamaño máximo de un Markdown recibido (2 MB). */
export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024

export const markdownSchema = z
  .string({ error: 'Falta el contenido Markdown' })
  .refine((s) => Buffer.byteLength(s) <= MAX_MARKDOWN_BYTES, 'El Markdown supera el tamaño máximo (2 MB)')

export const writeMarkdownInput = z.object({
  markdown: markdownSchema,
  /** replace: el contenido pasa a ser exactamente este. append: se añade al final. */
  mode: z.enum(['replace', 'append']).default('replace'),
})

export const importMarkdownInput = z.object({
  markdown: markdownSchema,
  title: z.string().optional(),
  /** Nombre del fichero original; se usa como título si no hay otro. */
  filename: z.string().max(255).optional(),
  workspaceId: z.string().min(1).optional(),
  folderId: z.string().min(1).nullable().optional(),
})

export type WriteMarkdownInput = z.input<typeof writeMarkdownInput>
export type ImportMarkdownInput = z.input<typeof importMarkdownInput>
