import { WickApi } from '../api'
import { clearConfig, configPath, loadConfig, normalizeServer, saveConfig } from '../config'
import { colors } from '../format'
import { CliError, type IO } from '../io'
import type { Context } from '../main'

export async function login(ctx: Context, flags: { server?: string; token?: string }) {
  const { io } = ctx
  const saved = await loadConfig(io.env)
  const defaultServer = flags.server ?? io.env.WICK_SERVER ?? saved.server ?? 'http://localhost:3120'

  let server = flags.server ?? io.env.WICK_SERVER
  if (!server) {
    if (io.stdinIsTTY) server = (await io.prompt(`Servidor [${defaultServer}]: `)) || defaultServer
    else server = defaultServer
  }
  server = normalizeServer(server)

  let token = flags.token ?? io.env.WICK_TOKEN
  if (!token) {
    if (!io.stdinIsTTY) throw new CliError('Pasa el token con --token o la variable WICK_TOKEN')
    io.stderr(`Crea un token en ${server}/account → «Tokens de acceso».\n`)
    token = (await io.prompt('Token: ', { hidden: true })).trim()
  }
  if (!token) throw new CliError('No se indicó ningún token')

  const me = await new WickApi(server, token).me()
  const path = await saveConfig(io.env, { server, token })
  const c = colors(io)
  io.stdout(`${c.green('✔')} Conectado a ${server} como ${c.bold(me.name)} (@${me.username})\n`)
  io.stderr(c.dim(`Configuración guardada en ${path}\n`))
}

export async function logout(io: IO) {
  await clearConfig(io.env)
  io.stdout(`Sesión cerrada (se borró ${configPath(io.env)}).\nRevoca el token en la web si ya no lo vas a usar.\n`)
}

export async function whoami(ctx: Context, json: boolean) {
  const me = await ctx.api().me()
  if (json) return ctx.io.stdout(JSON.stringify({ ...me, server: ctx.server() }, null, 2) + '\n')
  ctx.io.stdout(`${me.name} (@${me.username}) · ${me.role === 'ADMIN' ? 'administrador' : 'miembro'} · ${ctx.server()}\n`)
}
