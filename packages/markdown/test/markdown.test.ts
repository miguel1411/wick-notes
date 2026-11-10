import { afterAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { LegacyMarkdownConverter } from '../src'

const converter = new LegacyMarkdownConverter()
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

// Conversor del formato anterior (solo para la migración de notas antiguas).
describe('conversión del formato anterior a Markdown', () => {
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

  it('no deja &#x20; ni &#x9; por espacios al principio o al final de una línea', async () => {
    // Estado con la forma que genera el editor (fragmento «prosemirror»).
    const state = (blocks: Array<[string, string | null]>) => {
      const d = new Y.Doc()
      const f = d.getXmlFragment('prosemirror')
      for (const [name, text] of blocks) {
        const el = new Y.XmlElement(name)
        if (text !== null) el.insert(0, [new Y.XmlText(text)])
        f.push([el])
      }
      return Y.encodeStateAsUpdate(d)
    }
    const md = await converter.toMarkdown(
      state([
        ['paragraph', ' Hola '],
        ['paragraph', '\tsangrado'],
        ['paragraph', '   '],
        ['heading', '  Título  '],
        ['paragraph', 'entre   palabras se respeta'],
      ]),
    )
    expect(md).not.toMatch(/&#x(20|9);/)
    expect(md).toContain('Hola\n')
    expect(md).toContain('sangrado\n')
    expect(md).toContain('# Título\n')
    expect(md).toContain('entre   palabras se respeta')
  })

  it('no deja <br /> por líneas en blanco', async () => {
    const state = (texts: (string | null)[]) => {
      const d = new Y.Doc()
      for (const t of texts) {
        const el = new Y.XmlElement('paragraph')
        if (t !== null) el.insert(0, [new Y.XmlText(t)])
        d.getXmlFragment('prosemirror').push([el])
      }
      return Y.encodeStateAsUpdate(d)
    }
    expect(await converter.toMarkdown(state(['Antes', null, null, '   ', 'Después', null]))).toBe('Antes\n\nDespués\n')
    expect(await converter.toMarkdown(state([null, '  ']))).toBe('')
    // En listas y citas tampoco quedan restos.
    const md = await converter.toMarkdown(await converter.fromMarkdown('* uno\n\n  <br />\n* dos\n\n> cita'))
    expect(md).not.toContain('<br />')
  })

  it('respeta los espacios dentro de código', async () => {
    // (`` ` x ` `` sería «x» según CommonMark; con espacios a un solo lado se conservan.)
    const md = await converter.toMarkdown(await converter.fromMarkdown('```\n  sangrado\n```\n\n`  x` al inicio'))
    expect(md).toContain('```\n  sangrado\n```')
    expect(md).toContain('`  x` al inicio')
  })

  it('quita espacios alrededor de los saltos de línea', async () => {
    const md = await converter.toMarkdown(await converter.fromMarkdown('uno\\\n dos'))
    expect(md).not.toMatch(/&#x20;/)
    expect(md).toMatch(/uno\\?\n\s*dos|uno\s+dos/)
  })

  it('convierte documentos grandes en un tiempo razonable', async () => {
    const big = Array.from({ length: 2000 }, (_, i) => `## Sección ${i}\n\nTexto de la sección ${i} con **algo** de formato.`).join('\n\n')
    const t0 = Date.now()
    const md = await converter.toMarkdown(await converter.fromMarkdown(big))
    expect(md).toContain('## Sección 1999')
    expect(Date.now() - t0).toBeLessThan(10_000)
  })
})
