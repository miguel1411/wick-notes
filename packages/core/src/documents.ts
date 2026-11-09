import { getPrisma, Prisma } from '@wick/db'
import type { z } from 'zod'
import { NotFoundError, ValidationError } from './errors'
import {
  createDocumentInput,
  DEFAULT_TITLE,
  documentIdSchema,
  renameDocumentInput,
  type CreateDocumentInput,
  type RenameDocumentInput,
} from './schemas'

/** Metadatos de un documento, sin el estado Yjs (que puede ser grande). */
export interface DocumentSummary {
  id: string
  title: string
  createdAt: Date
  updatedAt: Date
}

const summarySelect = { id: true, title: true, createdAt: true, updatedAt: true } as const

function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message ?? 'Datos inválidos', result.error.issues)
  }
  return result.data
}

function isNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  return getPrisma().document.findMany({ select: summarySelect, orderBy: { updatedAt: 'desc' } })
}

export async function createDocument(input: CreateDocumentInput = {}): Promise<DocumentSummary> {
  const data = parse(createDocumentInput, input)
  return getPrisma().document.create({
    data: { title: data.title ?? DEFAULT_TITLE },
    select: summarySelect,
  })
}

export async function getDocument(id: string): Promise<DocumentSummary> {
  const doc = await getPrisma().document.findUnique({
    where: { id: parse(documentIdSchema, id) },
    select: summarySelect,
  })
  if (!doc) throw new NotFoundError('Documento')
  return doc
}

export async function documentExists(id: string): Promise<boolean> {
  const parsed = documentIdSchema.safeParse(id)
  if (!parsed.success) return false
  const count = await getPrisma().document.count({ where: { id: parsed.data } })
  return count > 0
}

export async function renameDocument(id: string, input: RenameDocumentInput): Promise<DocumentSummary> {
  const data = parse(renameDocumentInput, input)
  try {
    return await getPrisma().document.update({
      where: { id: parse(documentIdSchema, id) },
      data: { title: data.title },
      select: summarySelect,
    })
  } catch (err) {
    if (isNotFound(err)) throw new NotFoundError('Documento')
    throw err
  }
}

export async function deleteDocument(id: string): Promise<void> {
  try {
    await getPrisma().document.delete({ where: { id: parse(documentIdSchema, id) } })
  } catch (err) {
    if (isNotFound(err)) throw new NotFoundError('Documento')
    throw err
  }
}

/** Estado Yjs guardado, o null si el documento aún no tiene contenido. */
export async function loadYjsState(id: string): Promise<Uint8Array | null> {
  const doc = await getPrisma().document.findUnique({
    where: { id: parse(documentIdSchema, id) },
    select: { yjsState: true },
  })
  if (!doc) throw new NotFoundError('Documento')
  return doc.yjsState ? new Uint8Array(doc.yjsState) : null
}

export async function saveYjsState(id: string, state: Uint8Array): Promise<void> {
  try {
    await getPrisma().document.update({
      where: { id: parse(documentIdSchema, id) },
      data: { yjsState: new Uint8Array(state) },
    })
  } catch (err) {
    if (isNotFound(err)) throw new NotFoundError('Documento')
    throw err
  }
}
