import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  createDocument,
  listDocuments,
  renameDocument,
  WickError,
  type AuthUser,
  type DocumentSummary,
  type TokenScope,
} from '@wick/core'
import { z } from 'zod'

/**
 * Servidor MCP de wick notes para un usuario concreto.
 *
 * Las herramientas usan las mismas reglas que la API (todo pasa por @wick/core y
 * por el servidor de colaboración), y con un token de solo lectura las de
 * escritura ni siquiera se registran: el agente solo ve lo que puede hacer.
 */
export function createWickMcpServer(opts: { user: AuthUser; scope: TokenScope; origin: string; version: string }) {
  const { user, scope, origin } = opts
  const server = new McpServer(
    { name: 'wick-notes', title: 'wick notes', version: opts.version },
    {
      instructions: [
        'wick notes es la base de conocimiento en Markdown, privada y autoalojada, de este usuario y su equipo.',
        'Busca antes de crear: si ya existe una nota sobre el tema, léela y añade o actualiza en lugar de duplicar.',
        'Las notas se identifican por id o por título. El contenido es Markdown (CommonMark + GFM).',
        'Los cambios se ven al momento en el editor de cualquier persona que tenga la nota abierta.',
        scope === 'read' ? 'Este acceso es de solo lectura.' : '',
      ]
        .filter(Boolean)
        .join(' '),
    },
  )

  const noteUrl = (id: string) => `${origin}/d/${id}`
  const line = (d: DocumentSummary) =>
    `- ${d.title} (id: ${d.id}; actualizada ${d.updatedAt.toISOString()}${d.createdBy ? `; creada por ${d.createdBy.name}` : ''})`
  const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })

  /** Traduce errores de negocio a respuestas de herramienta legibles por el agente. */
  const safe =
    <A,>(fn: (args: A) => Promise<ReturnType<typeof text>>) =>
    async (args: A) => {
      try {
        return await fn(args)
      } catch (err) {
        const message =
          err instanceof WickError
            ? err.message
            : (err as { statusMessage?: string; message?: string }).message ?? 'Error inesperado'
        return { ...text(`Error: ${message}`), isError: true }
      }
    }

  // ------------------------------------------------------------- lectura

  server.registerTool(
    'notes_list',
    {
      title: 'Listar notas',
      description: 'Lista las notas, de la más recientemente modificada a la más antigua.',
      inputSchema: { limit: z.number().int().min(1).max(200).optional().describe('Máximo de notas (por defecto 50)') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ limit }) => {
      const docs = await listDocuments(user, { limit: limit ?? 50 })
      return text(docs.length ? docs.map(line).join('\n') : 'No hay notas todavía.')
    }),
  )

  server.registerTool(
    'notes_search',
    {
      title: 'Buscar notas',
      description: 'Busca notas cuyo título contenga el texto indicado (sin distinguir mayúsculas).',
      inputSchema: { query: z.string().min(1).describe('Texto a buscar') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ query }) => {
      const docs = await listDocuments(user, { query, limit: 50 })
      return text(docs.length ? docs.map(line).join('\n') : `Ninguna nota coincide con «${query}».`)
    }),
  )

  server.registerTool(
    'notes_read',
    {
      title: 'Leer nota',
      description: 'Devuelve el contenido Markdown de una nota, con su título y metadatos.',
      inputSchema: { note: z.string().min(1).describe('Id o título de la nota') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ note }) => {
      const doc = await resolveNote(user, note)
      const body = await getDocumentMarkdown(doc.id)
      return text(
        [
          `# ${doc.title}`,
          '',
          `<!-- id: ${doc.id} · actualizada ${doc.updatedAt.toISOString()}${doc.createdBy ? ` · creada por ${doc.createdBy.name}` : ''} · ${noteUrl(doc.id)} -->`,
          '',
          body.trim() || '_(nota vacía)_',
        ].join('\n'),
      )
    }),
  )

  if (scope !== 'write') return server

  // ------------------------------------------------------------- escritura

  server.registerTool(
    'notes_create',
    {
      title: 'Crear nota',
      description: 'Crea una nota nueva con un título y, opcionalmente, contenido Markdown.',
      inputSchema: {
        title: z.string().min(1).max(200).describe('Título de la nota'),
        markdown: z.string().optional().describe('Contenido en Markdown (sin repetir el título como # encabezado)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ title, markdown }) => {
      const state = markdown?.trim() ? await markdownToYjsState(markdown) : undefined
      const doc = await createDocument(user, { title }, state)
      return text(`Nota creada: «${doc.title}» (id: ${doc.id}) · ${noteUrl(doc.id)}`)
    }),
  )

  server.registerTool(
    'notes_append',
    {
      title: 'Añadir a una nota',
      description:
        'Añade Markdown al final de una nota existente sin tocar el resto. Es la forma más segura de aportar a una nota que otras personas pueden estar editando.',
      inputSchema: {
        note: z.string().min(1).describe('Id o título de la nota'),
        markdown: z.string().min(1).describe('Markdown a añadir al final'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ note, markdown }) => {
      const doc = await resolveNote(user, note)
      await writeDocumentMarkdown(doc.id, user.id, markdown, 'append')
      return text(`Añadido al final de «${doc.title}» (id: ${doc.id}).`)
    }),
  )

  server.registerTool(
    'notes_update',
    {
      title: 'Reescribir una nota',
      description:
        'Sustituye el contenido de una nota por el Markdown indicado (y opcionalmente cambia el título). Lee la nota antes con notes_read: lo que no incluyas se elimina. Se aplica por diferencias, así que no afecta a las partes que no cambias.',
      inputSchema: {
        note: z.string().min(1).describe('Id o título de la nota'),
        markdown: z.string().describe('Contenido completo nuevo en Markdown (sin el título)'),
        title: z.string().min(1).max(200).optional().describe('Nuevo título (opcional)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    safe(async ({ note, markdown, title }) => {
      const doc = await resolveNote(user, note)
      await writeDocumentMarkdown(doc.id, user.id, markdown, 'replace')
      const final = title && title !== doc.title ? await renameDocument(user, doc.id, { title }) : doc
      return text(`Nota actualizada: «${final.title}» (id: ${doc.id}) · ${noteUrl(doc.id)}`)
    }),
  )

  return server
}
