import type { Context } from '../main'
import { colors } from '../format'
import { resolveWorkspace } from './notes'

interface TreeNote {
  id: string
  title: string
}
interface TreeFolder {
  id: string
  name: string
  folders: TreeFolder[]
  notes: TreeNote[]
}
interface WorkspaceTree {
  id: string
  name: string
  role: 'owner' | 'editor' | 'viewer'
  everyone: boolean
  folders: TreeFolder[]
  notes: TreeNote[]
}

const ROLE = { owner: 'propietario', editor: 'editor', viewer: 'solo lectura' }

/**
 * `wick tree`: árbol jerárquico de espacios, carpetas y notas.
 *
 *   General  (para todos · editor)
 *   ├── Infra/
 *   │   ├── Servidores/
 *   │   │   └── dev-home
 *   │   └── Router
 *   └── Acta 2024
 */
export async function tree(ctx: Context, flags: { workspace?: string; ids?: boolean; json?: boolean }) {
  const { io } = ctx
  const workspaceId = await resolveWorkspace(ctx, flags.workspace)
  const trees = (await ctx.api().tree(workspaceId)) as WorkspaceTree[]
  if (flags.json) return io.stdout(JSON.stringify(trees, null, 2) + '\n')

  const c = colors(io)
  const id = (value: string) => (flags.ids ? `  ${c.dim(value)}` : '')
  let folders = 0
  let notes = 0

  const lines: string[] = []
  const walk = (items: { folder?: TreeFolder; note?: TreeNote }[], prefix: string) => {
    items.forEach((item, i) => {
      const last = i === items.length - 1
      const branch = prefix + (last ? '└── ' : '├── ')
      const childPrefix = prefix + (last ? '    ' : '│   ')
      if (item.folder) {
        folders++
        const f = item.folder
        lines.push(`${c.dim(branch)}${c.bold(c.cyan(`${f.name}/`))}${id(f.id)}`)
        walk(children(f), childPrefix)
      } else {
        notes++
        lines.push(`${c.dim(branch)}${item.note!.title}${id(item.note!.id)}`)
      }
    })
  }
  const children = (node: { folders: TreeFolder[]; notes: TreeNote[] }) => [
    ...node.folders.map((folder) => ({ folder })),
    ...node.notes.map((note) => ({ note })),
  ]

  trees.forEach((t, i) => {
    if (i > 0) lines.push('')
    lines.push(`${c.bold(t.name)}  ${c.dim(`(${t.everyone ? 'para todos' : 'privado'} · ${ROLE[t.role]})`)}${id(t.id)}`)
    const items = children(t)
    if (items.length) walk(items, '')
    else lines.push(c.dim('└── (vacío)'))
  })
  io.stdout(lines.join('\n') + '\n')
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  io.stderr(c.dim(`\n${n(trees.length, 'espacio', 'espacios')} · ${n(folders, 'carpeta', 'carpetas')} · ${n(notes, 'nota', 'notas')}\n`))
}
