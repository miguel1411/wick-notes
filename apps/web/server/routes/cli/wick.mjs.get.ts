import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Sirve la CLI empaquetada (apps/cli/dist/wick.mjs) para instalarla desde la
 * propia instancia, sin npm ni internet:
 *   curl -fsSL http://servidor:3120/cli/wick.mjs -o ~/.local/bin/wick && chmod +x ~/.local/bin/wick
 */
const CANDIDATES = [
  process.env.WICK_CLI_BUNDLE,
  resolve(process.cwd(), 'apps/cli/dist/wick.mjs'), // Docker (/app)
  resolve(process.cwd(), '../cli/dist/wick.mjs'), // pnpm dev (apps/web)
].filter(Boolean) as string[]

export default defineEventHandler(async (event) => {
  for (const path of CANDIDATES) {
    try {
      const code = await readFile(path, 'utf8')
      setResponseHeader(event, 'Content-Type', 'text/javascript; charset=utf-8')
      setResponseHeader(event, 'Cache-Control', 'no-cache')
      return code
    } catch {
      // probar la siguiente ruta
    }
  }
  throw createError({ statusCode: 404, message: 'La CLI no está compilada (pnpm --filter @wick/cli build)' })
})
