import { describe, expect, it } from 'vitest'
import { markdownFilename, splitTitleFromMarkdown, titleFromFilename, withTitleHeading } from '../src'

describe('título en ficheros Markdown', () => {
  it('separa un # inicial como título', () => {
    expect(splitTitleFromMarkdown('# Red de casa\n\nRouter en .1')).toEqual({ title: 'Red de casa', body: 'Router en .1' })
    expect(splitTitleFromMarkdown('﻿\n\n#  Con espacios  #\nTexto')).toEqual({ title: 'Con espacios', body: 'Texto' })
  })

  it('no toma como título un ## ni texto normal', () => {
    expect(splitTitleFromMarkdown('## Sub\n\nx').title).toBeNull()
    expect(splitTitleFromMarkdown('Hola\n# Luego').title).toBeNull()
    expect(splitTitleFromMarkdown('#etiqueta').title).toBeNull()
  })

  it('exportar e importar conserva título y contenido', () => {
    const file = withTitleHeading('Backups', '* uno\n* dos\n')
    expect(file).toBe('# Backups\n\n* uno\n* dos\n')
    expect(splitTitleFromMarkdown(file)).toEqual({ title: 'Backups', body: '* uno\n* dos\n' })
    expect(withTitleHeading('Vacía', '')).toBe('# Vacía\n')
  })

  it('obtiene títulos y nombres de fichero seguros', () => {
    expect(titleFromFilename('/tmp/notas de red.md')).toBe('notas de red')
    expect(titleFromFilename('README.markdown')).toBe('README')
    expect(titleFromFilename('.md')).toBeNull()
    expect(markdownFilename('Red: casa/oficina?')).toBe('Red- casa-oficina.md')
    expect(markdownFilename('...')).toBe('nota.md')
    expect(markdownFilename('Ñandú 🚀')).toBe('Ñandú 🚀.md')
  })
})
