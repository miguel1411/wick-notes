import { createInterface } from 'node:readline'
import { run } from './main'
import type { IO } from './io'

function prompt(question: string, options: { hidden?: boolean } = {}): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true })
    if (options.hidden) {
      // No mostrar lo que se escribe (tokens).
      const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput
      ;(rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
        if (s.startsWith(question) || s === '\r\n' || s === '\n') write.call(rl, s)
      }
    }
    rl.question(question, (answer) => {
      rl.close()
      if (options.hidden) process.stderr.write('\n')
      resolve(answer)
    })
  })
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const io: IO = {
  stdout: (t) => void process.stdout.write(t),
  stderr: (t) => void process.stderr.write(t),
  env: process.env,
  cwd: process.cwd(),
  stdinIsTTY: !!process.stdin.isTTY,
  stdoutIsTTY: !!process.stdout.isTTY,
  columns: process.stdout.columns || 100,
  readStdin,
  prompt,
}

process.exitCode = await run(process.argv.slice(2), io)
