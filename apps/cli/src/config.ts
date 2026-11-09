import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface Config {
  server?: string
  token?: string
}

/** ~/.config/wick-notes/config.json (o %APPDATA%\\wick-notes\\config.json en Windows). */
export function configPath(env: NodeJS.ProcessEnv): string {
  if (env.WICK_CONFIG) return env.WICK_CONFIG
  if (process.platform === 'win32') {
    return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'wick-notes', 'config.json')
  }
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'wick-notes', 'config.json')
}

export async function loadConfig(env: NodeJS.ProcessEnv): Promise<Config> {
  try {
    return JSON.parse(await readFile(configPath(env), 'utf8')) as Config
  } catch {
    return {}
  }
}

export async function saveConfig(env: NodeJS.ProcessEnv, config: Config): Promise<string> {
  const path = configPath(env)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  // 0600: el token es una credencial.
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  return path
}

export async function clearConfig(env: NodeJS.ProcessEnv): Promise<void> {
  await rm(configPath(env), { force: true })
}

export function normalizeServer(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}
