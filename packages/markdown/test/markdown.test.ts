import { afterAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MarkdownConverter } from '../src'

const converter = new MarkdownConverter()
afterAll(() => converter.close())

const SAMPLE = `# Servidor de backups

Notas con **negrita**, *cursiva*, \`código\`, ~~tachado~~ y un [enlace](https://example.com).

## Pasos

1. Instalar \`restic\`
2. Configurar el repositorio
   * con contraseña
   * y cifrado

* [ ] revisar cron
* [x] probar restauración

> Importante: nunca borrar el último snapshot.

\`\`\`bash
restic -r /srv/backups snapshots
\`\`\`

| Servicio | Puerto |
| -------- | ------ |
| restic   | 8000   |
| ñandú 🚀 | 443    |

Fórmula: $e^{i\\pi} + 1 = 0$

***

![diagrama](https://example.com/diagrama.png)
`

describe('conversión Markdown ↔ Yjs', () => {
  it('un documento vacío da Markdown vacío', async () => {
    expect(await converter.toMarkdown(null)).toBe('')
    expect(await converter.toMarkdown(Y.encodeStateAsUpdate(new Y.Doc()))).toBe('')
  })

  it('conserva todo el contenido en la ida y vuelta', async () => {
    const md = await converter.toMarkdown(await converter.fromMarkdown(SAMPLE))
    for (const fragment of [
      '# Servidor de backups',
      '**negrita**',
      '*cursiva*',
      '`código`',
      '~~tachado~~',
      '[enlace](https://example.com)',
      '## Pasos',
      '1. Instalar `restic`',
      '  * con contraseña',
      '* [ ] revisar cron',
      '* [x] probar restauración',
      '> Importante: nunca borrar el último snapshot.',
      '```bash\nrestic -r /srv/backups snapshots\n```',
      '| ñandú 🚀 |',
      '$e^{i\\pi} + 1 = 0$',
      '![diagrama](https://example.com/diagrama.png)',
    ]) {
      expect(md).toContain(fragment)
    }
  })

  it('es estable: convertir de nuevo no cambia nada', async () => {
    const once = await converter.toMarkdown(await converter.fromMarkdown(SAMPLE))
    const twice = await converter.toMarkdown(await converter.fromMarkdown(once))
    expect(twice).toBe(once)
  })

  it('el estado generado usa el fragmento del editor colaborativo', async () => {
    const ydoc = new Y.Doc()
    Y.applyUpdate(ydoc, await converter.fromMarkdown('# Hola'))
    expect(ydoc.getXmlFragment('prosemirror').toString()).toContain('<heading')
  })

  it('añade Markdown al final sin tocar lo anterior', async () => {
    const ydoc = new Y.Doc()
    Y.applyUpdate(ydoc, await converter.fromMarkdown('# Diario\n\nPrimera entrada.'))
    Y.applyUpdate(ydoc, await converter.appendUpdate(Y.encodeStateAsUpdate(ydoc), '## Segunda\n\n* punto'))
    expect(await converter.toMarkdown(Y.encodeStateAsUpdate(ydoc))).toBe(
      '# Diario\n\nPrimera entrada.\n\n## Segunda\n\n* punto\n',
    )
  })

  it('añadir a un documento vacío equivale a escribirlo', async () => {
    const update = await converter.appendUpdate(null, 'Hola')
    const ydoc = new Y.Doc()
    Y.applyUpdate(ydoc, update)
    expect(await converter.toMarkdown(Y.encodeStateAsUpdate(ydoc))).toBe('Hola\n')
  })

  it('reemplazar por diferencias no pisa una edición simultánea', async () => {
    // Dos réplicas del mismo documento (como el servidor y un navegador).
    const server = new Y.Doc()
    Y.applyUpdate(server, await converter.fromMarkdown('Párrafo A\n\nPárrafo B\n\nPárrafo C'))
    const browser = new Y.Doc()
    Y.applyUpdate(browser, Y.encodeStateAsUpdate(server))

    // Un agente reemplaza el contenido cambiando solo el párrafo A…
    const agentUpdate = await converter.replaceUpdate(
      Y.encodeStateAsUpdate(server),
      'Párrafo A editado\n\nPárrafo B\n\nPárrafo C',
    )
    // …mientras alguien escribe al final del párrafo C en el navegador.
    const paragraphC = browser.getXmlFragment('prosemirror').get(2) as Y.XmlElement
    ;(paragraphC.get(0) as Y.XmlText).insert('Párrafo C'.length, ' (y más)')

    Y.applyUpdate(server, agentUpdate)
    Y.applyUpdate(server, Y.encodeStateAsUpdate(browser))
    Y.applyUpdate(browser, Y.encodeStateAsUpdate(server))

    const result = await converter.toMarkdown(Y.encodeStateAsUpdate(server))
    expect(result).toBe('Párrafo A editado\n\nPárrafo B\n\nPárrafo C (y más)\n')
    expect(await converter.toMarkdown(Y.encodeStateAsUpdate(browser))).toBe(result)
  })

  it('restaura otra versión por diferencias, también a un documento vacío', async () => {
    const v1 = await converter.fromMarkdown('# Plan\n\n* uno\n* dos')
    const live = new Y.Doc()
    Y.applyUpdate(live, v1)
    Y.applyUpdate(live, await converter.replaceUpdate(Y.encodeStateAsUpdate(live), '# Plan nuevo\n\nTodo distinto.'))
    expect(await converter.toMarkdown(Y.encodeStateAsUpdate(live))).toBe('# Plan nuevo\n\nTodo distinto.\n')

    Y.applyUpdate(live, await converter.restoreUpdate(Y.encodeStateAsUpdate(live), v1))
    expect(await converter.toMarkdown(Y.encodeStateAsUpdate(live))).toBe('# Plan\n\n* uno\n* dos\n')

    Y.applyUpdate(live, await converter.restoreUpdate(Y.encodeStateAsUpdate(live), Y.encodeStateAsUpdate(new Y.Doc())))
    expect((await converter.toMarkdown(Y.encodeStateAsUpdate(live))).trim()).toBe('')
  })

  it('convierte documentos grandes en un tiempo razonable', async () => {
    const big = Array.from({ length: 2000 }, (_, i) => `## Sección ${i}\n\nTexto de la sección ${i} con **algo** de formato.`).join('\n\n')
    const t0 = Date.now()
    const md = await converter.toMarkdown(await converter.fromMarkdown(big))
    expect(md).toContain('## Sección 1999')
    expect(Date.now() - t0).toBeLessThan(10_000)
  })
})
