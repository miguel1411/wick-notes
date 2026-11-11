import { extractText, getDocumentProxy } from 'unpdf'
import { describe, expect, it } from 'vitest'
import { markdownToTypst, noteToTypst, PdfRenderError, pdfFilename, renderNotePdf, renderTypstPdf } from '../src'

async function pdfText(pdf: Uint8Array): Promise<string> {
  const doc = await getDocumentProxy(pdf)
  const { text } = await extractText(doc, { mergePages: true })
  return text.replace(/\s+/g, ' ')
}

describe('Markdown → Typst', () => {
  it('escribe el texto siempre como cadena, nunca como marcado', () => {
    expect(markdownToTypst('Hola #read("/etc/passwd") $x$ "a" \\ b')).toBe(
      '#"Hola #read(\\"/etc/passwd\\") $x$ \\"a\\" \\\\ b";',
    )
  })

  it('traduce formato, encabezados, código y enlaces', () => {
    expect(markdownToTypst('## Título *a* **b** ~~c~~ `d`')).toBe(
      '#heading(level: 2)[#"Título ";#emph[#"a";]#" ";#strong[#"b";]#" ";#strike[#"c";]#" ";#raw("d")]',
    )
    expect(markdownToTypst('```bash\necho "hi"\n```')).toBe('#raw(block: true, lang: "bash", "echo \\"hi\\"")')
    expect(markdownToTypst('```a"b\nx\n```')).toBe('#raw(block: true, "x")')
    expect(markdownToTypst('[nota](/d/abc) [web](https://x.dev)', { baseUrl: 'http://wick:3120/' })).toBe(
      '#link("http://wick:3120/d/abc")[#"nota";]#" ";#link("https://x.dev")[#"web";]',
    )
  })

  it('traduce listas de tareas, tablas y citas', () => {
    expect(markdownToTypst('- [x] hecha\n- [ ] pendiente')).toBe(
      '#list(tight: true, marker: [], body-indent: 0pt, [#wick-task(true) #"hecha";], [#wick-task(false) #"pendiente";])',
    )
    expect(markdownToTypst('3. tres\n4. cuatro')).toBe('#enum(tight: true, start: 3, [#"tres";], [#"cuatro";])')
    expect(markdownToTypst('| a | b |\n|:-|-:|\n| 1 |\n')).toBe(
      '#table(columns: 2, align: (left, right,), table.header([#"a";], [#"b";]), [#"1";], [])',
    )
    expect(markdownToTypst('> cita')).toBe('#quote(block: true)[#"cita";]')
  })

  it('reparte el ancho de las columnas según la fila separadora', () => {
    expect(markdownToTypst('| a | b |\n|--|------|\n| 1 | 2 |')).toBe(
      '#table(columns: (2fr, 6fr), align: (left, left,), table.header([#"a";], [#"b";]), [#"1";], [#"2";])',
    )
    expect(markdownToTypst('> | a | b |\n> |:-|---:|\n> | 1 | 2 |')).toBe(
      '#quote(block: true)[#table(columns: (1fr, 3fr), align: (left, right,), table.header([#"a";], [#"b";]), [#"1";], [#"2";])]',
    )
  })

  it('omite comentarios HTML y no entra en bucle con notas al pie circulares', () => {
    expect(markdownToTypst('<!-- oculto -->')).toBe('')
    expect(markdownToTypst('a[^1]\n\n[^1]: b[^1]')).toBe('#"a";#footnote[#"b";#"[^1]";]')
  })
})

describe('PDF de una nota', () => {
  it('genera un PDF con el título y el contenido literal', async () => {
    const nasty = '#read("/etc/passwd") $x^2$ *no* <lbl> @ref = -- ... ~ \\ #{1+1}'
    const markdown = [
      'Texto con **negrita** y `código`.',
      '- [x] hecha',
      '| Herramienta | Uso |\n|---|---|\n| notes_read | lee |',
      '```ts\nconst a = "b"\n```',
      '    ' + nasty,
    ].join('\n\n')
    const pdf = await renderNotePdf({ title: 'Prueba «PDF»', subtitle: 'General', markdown })
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-')
    const text = await pdfText(pdf)
    for (const part of ['Prueba «PDF»', 'General', 'Texto con negrita y código', 'hecha', 'notes_read', 'const a = "b"', nasty]) {
      expect(text).toContain(part)
    }
  })

  it('genera PDF de notas vacías o con títulos raros', async () => {
    const text = await pdfText(await renderNotePdf({ title: '  ', markdown: '' }))
    expect(text).toContain('Sin título')
    expect(noteToTypst({ title: 'a"b', markdown: '' })).toContain('#set document(title: "a\\"b")')
  })

  it('un documento Typst inválido da PdfRenderError', async () => {
    await expect(renderTypstPdf('#let x = (')).rejects.toBeInstanceOf(PdfRenderError)
    // El compilador sigue funcionando después de un error.
    expect((await renderNotePdf({ title: 'Ok', markdown: 'x' })).length).toBeGreaterThan(0)
  })

  it('nombre de fichero seguro', () => {
    expect(pdfFilename('Red: casa/oficina?')).toBe('Red- casa-oficina.pdf')
    expect(pdfFilename('...')).toBe('nota.pdf')
  })
})
