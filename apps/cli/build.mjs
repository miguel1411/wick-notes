// Empaqueta la CLI en un único fichero sin dependencias: dist/wick.mjs
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

await build({
  entryPoints: [new URL('./src/bin.ts', import.meta.url).pathname],
  outfile: new URL('./dist/wick.mjs', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  define: { __WICK_VERSION__: JSON.stringify(version) },
  legalComments: 'none',
})
console.log(`dist/wick.mjs (v${version})`)
