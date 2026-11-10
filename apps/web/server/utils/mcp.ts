import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  createDocument,
  getWorkspaceTrees,
  listDocuments,
  listMoveRequests,
  listVersions,
  listWorkspaces,
  requestMove,
  resolveFolder,
  renameDocument,
  requireDocumentAccess,
  searchDocuments,
  WickError,
  type AuthUser,
  type DocumentSummary,
  type TokenScope,
  type TreeFolderNode,
  type TreeNote,
} from '@wick/core'
import { z } from 'zod'

/**
 * Servidor MCP de wick notes para un usuario concreto.
 *
 * Las herramientas usan las mismas reglas que la API (todo pasa por @wick/core y
 * por el servidor de colaboración), y con un token de solo lectura las de
 * escritura ni siquiera se registran: el agente solo ve lo que puede hacer.
 */
export function createWickMcpServer(opts: { user: AuthUser; scope: TokenScope; tokenId?: string; origin: string; version: string }) {
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
  let wsNames: Map<string, string> | undefined
  const workspaceName = async (id: string) => {
    wsNames ??= new Map((await listWorkspaces(user)).map((w) => [w.id, w.name]))
    return wsNames.get(id) ?? id
  }
  const line = async (d: DocumentSummary) =>
    `- ${d.title} (id: ${d.id}; espacio: ${await workspaceName(d.workspaceId)}; actualizada ${d.updatedAt.toISOString()}${d.createdBy ? `; creada por ${d.createdBy.name}` : ''})`
  const lines = async (docs: DocumentSummary[]) => (await Promise.all(docs.map(line))).join('\n')

  /** Espacio por id o nombre (sin distinguir mayúsculas). */
  const resolveWorkspace = async (ref: string) => {
    const all = await listWorkspaces(user)
    const ws = all.find((w) => w.id === ref) ?? all.find((w) => w.name.toLowerCase() === ref.trim().toLowerCase())
    if (!ws) throw new WickError(`No hay ningún espacio «${ref}». Espacios disponibles: ${all.map((w) => w.name).join(', ')}`, 'VALIDATION')
    return ws
  }
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
      description:
        'Lista las notas, de la más recientemente modificada a la más antigua. Las notas se organizan en espacios de trabajo; sin `workspace` lista las de todos los que puedes ver.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe('Máximo de notas (por defecto 50)'),
        workspace: z.string().optional().describe('Nombre o id de un espacio de trabajo'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ limit, workspace }) => {
      const workspaceId = workspace ? (await resolveWorkspace(workspace)).id : undefined
      const docs = await listDocuments(user, { limit: limit ?? 50, workspaceId })
      return text(docs.length ? await lines(docs) : 'No hay notas.')
    }),
  )

  server.registerTool(
    'notes_search',
    {
      title: 'Buscar notas',
      description:
        'Busca en el título y el contenido de las notas. Devuelve las que contienen todas las palabras (sin distinguir mayúsculas ni tildes), con un fragmento de contexto.',
      inputSchema: {
        query: z.string().min(1).describe('Palabras a buscar'),
        limit: z.number().int().min(1).max(50).optional().describe('Máximo de resultados (por defecto 10)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ query, limit }) => {
      const results = await searchDocuments(user, query, { limit: limit ?? 10 })
      if (!results.length) return text(`Ninguna nota contiene «${query}».`)
      return text(
        (await Promise.all(results.map(async (r) => `${await line(r)}${r.snippet ? `\n  > ${r.snippet}` : ''}`))).join('\n'),
      )
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
          `<!-- id: ${doc.id} · espacio: ${await workspaceName(doc.workspaceId)} · actualizada ${doc.updatedAt.toISOString()}${doc.createdBy ? ` · creada por ${doc.createdBy.name}` : ''} · ${noteUrl(doc.id)} -->`,
          '',
          body.trim() || '_(nota vacía)_',
        ].join('\n'),
      )
    }),
  )

  server.registerTool(
    'notes_tree',
    {
      title: 'Árbol de carpetas y notas',
      description:
        'Muestra la estructura completa: cada espacio de trabajo con sus carpetas anidadas y sus notas (con ids). Úsalo para entender cómo está organizado todo antes de proponer movimientos.',
      inputSchema: { workspace: z.string().optional().describe('Nombre o id de un espacio (por defecto, todos)') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ workspace }) => {
      const workspaceId = workspace ? (await resolveWorkspace(workspace)).id : undefined
      const trees = await getWorkspaceTrees(user, workspaceId)
      const ROLE = { owner: 'propietario', editor: 'editor', viewer: 'solo lectura' }
      const out: string[] = []
      const note = (n: TreeNote, depth: number) => out.push(`${'  '.repeat(depth)}- ${n.title} (id: ${n.id})`)
      const folder = (f: TreeFolderNode, depth: number) => {
        out.push(`${'  '.repeat(depth)}${f.name}/ (carpeta, id: ${f.id})`)
        for (const sub of f.folders) folder(sub, depth + 1)
        for (const n of f.notes) note(n, depth + 1)
        if (!f.folders.length && !f.notes.length) out.push(`${'  '.repeat(depth + 1)}(vacía)`)
      }
      for (const t of trees) {
        out.push(`# ${t.name} (${t.everyone ? 'para todos' : 'privado'}; tu rol: ${ROLE[t.role]}; id: ${t.id})`)
        for (const f of t.folders) folder(f, 0)
        for (const n of t.notes) note(n, 0)
        if (!t.folders.length && !t.notes.length) out.push('(espacio vacío)')
        out.push('')
      }
      return text(out.join('\n').trim() || 'No tienes acceso a ningún espacio de trabajo.')
    }),
  )

  server.registerTool(
    'notes_move_requests',
    {
      title: 'Solicitudes de movimiento',
      description:
        'Lista las solicitudes de mover notas hechas con notes_move y su estado: pendiente (esperando a que una persona la apruebe en wick notes), aprobada, rechazada, fallida o sustituida.',
      inputSchema: {
        status: z.enum(['pending', 'approved', 'rejected', 'failed', 'superseded']).optional().describe('Filtrar por estado'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ status }) => {
      const requests = await listMoveRequests(user, { status, limit: 30 })
      if (!requests.length) return text('No hay solicitudes de movimiento.')
      const STATUS = { pending: 'pendiente', approved: 'aprobada', rejected: 'rechazada', failed: 'fallida', superseded: 'sustituida' }
      return text(
        requests
          .map(
            (r) =>
              `- «${r.document.title}»: ${r.from.path} → ${r.to.path} · ${STATUS[r.status]}${r.error ? ` (${r.error})` : ''} · ${r.createdAt.toISOString()} (solicitud: ${r.id})`,
          )
          .join('\n'),
      )
    }),
  )

  server.registerTool(
    'notes_history',
    {
      title: 'Historial de una nota',
      description:
        'Sin `version`: lista las versiones guardadas de una nota (más reciente primero), con fecha, motivo y autor. Con `version`: devuelve el Markdown de esa versión.',
      inputSchema: {
        note: z.string().min(1).describe('Id o título de la nota'),
        version: z.string().optional().describe('Id de una versión para ver su contenido'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ note, version }) => {
      const doc = await resolveNote(user, note)
      if (version) {
        const md = await getVersionMarkdown(doc.id, version)
        return text(md.trim() || '_(versión vacía)_')
      }
      const versions = await listVersions(user, doc.id)
      if (!versions.length) return text(`«${doc.title}» todavía no tiene versiones guardadas.`)
      const reason = { auto: 'edición', manual: 'guardada a mano', before_replace: 'antes de un reemplazo', before_restore: 'antes de restaurar' }
      return text(
        versions
          .map((v) => `- ${v.createdAt.toISOString()} · ${reason[v.reason]}${v.author ? ` · ${v.author.name}` : ''} (version: ${v.id})${v.preview ? `\n  > ${v.preview}` : ''}`)
          .join('\n'),
      )
    }),
  )

  if (scope !== 'write') return server

  // ------------------------------------------------------------- escritura

  server.registerTool(
    'notes_create',
    {
      title: 'Crear nota',
      description:
        'Crea una nota nueva con un título y, opcionalmente, contenido Markdown. Sin `workspace` va al primer espacio en el que puedes escribir.',
      inputSchema: {
        title: z.string().min(1).max(200).describe('Título de la nota'),
        workspace: z.string().optional().describe('Nombre o id del espacio de trabajo'),
        markdown: z.string().optional().describe('Contenido en Markdown (sin repetir el título como # encabezado)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ title, markdown, workspace }) => {
      const workspaceId = workspace ? (await resolveWorkspace(workspace)).id : undefined
      const state = markdown?.trim() ? await markdownToYjsState(markdown) : undefined
      const doc = await createDocument(user, { title, workspaceId }, state)
      return text(`Nota creada: «${doc.title}» (id: ${doc.id}; espacio: ${await workspaceName(doc.workspaceId)}) · ${noteUrl(doc.id)}`)
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
      await requireDocumentAccess(user, doc.id, 'write')
      await writeDocumentMarkdown(doc.id, user.id, markdown, 'append')
      return text(`Añadido al final de «${doc.title}» (id: ${doc.id}).`)
    }),
  )

  server.registerTool(
    'notes_move',
    {
      title: 'Proponer mover una nota',
      description:
        'NO mueve la nota: crea una solicitud que una persona debe aprobar en wick notes. Indica la nota, la carpeta de destino (id o ruta como «Infra/Servidores») y, si es otro espacio, el espacio. Sin carpeta, el destino es la raíz del espacio. Explica en `reason` por qué. Consulta el resultado con notes_move_requests.',
      inputSchema: {
        note: z.string().min(1).describe('Id o título de la nota'),
        folder: z.string().optional().describe('Carpeta de destino: id o ruta («Infra/Servidores»). Sin indicar: raíz del espacio'),
        workspace: z.string().optional().describe('Espacio de destino (nombre o id); por defecto, el de la nota'),
        reason: z.string().max(500).optional().describe('Por qué propones moverla (lo verá la persona que aprueba)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    safe(async ({ note, folder, workspace, reason }) => {
      const doc = await resolveNote(user, note)
      const workspaceId = workspace ? (await resolveWorkspace(workspace)).id : doc.workspaceId
      const folderId = folder ? await resolveFolder(user, workspaceId, folder) : null
      const req = await requestMove(user, { documentId: doc.id, workspaceId, folderId, reason }, { tokenId: opts.tokenId })
      return text(
        [
          `Solicitud creada (pendiente de aprobación): «${req.document.title}»: ${req.from.path} → ${req.to.path}.`,
          `La nota NO se ha movido todavía. Pide a la persona que la apruebe en ${origin}/moves.`,
          `Id de la solicitud: ${req.id}`,
        ].join('\n'),
      )
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
      await requireDocumentAccess(user, doc.id, 'write')
      await writeDocumentMarkdown(doc.id, user.id, markdown, 'replace')
      const final = title && title !== doc.title ? await renameDocument(user, doc.id, { title }) : doc
      return text(`Nota actualizada: «${final.title}» (id: ${doc.id}) · ${noteUrl(doc.id)}`)
    }),
  )

  return server
}
