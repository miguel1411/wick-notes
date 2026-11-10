import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { disconnectPrisma, getPrisma } from '@wick/db'
import {
  createDocument,
  extractPlainText,
  normalizeForSearch,
  reindexMissingDocuments,
  renameDocument,
  saveYjsState,
  searchDocuments,
  type AuthUser,
} from '../src'
import { makeUser, resetDatabase } from './helpers'

/** Estado Yjs con la misma forma que genera el editor (fragmento «prosemirror»). */
function docState(blocks: Array<[string, string] | [string, string, Record<string, string>]>): Uint8Array {
  const ydoc = new Y.Doc()
  const fragment = ydoc.getXmlFragment('prosemirror')
  for (const [name, text, attrs] of blocks) {
    const el = new Y.XmlElement(name)
    for (const [k, v] of Object.entries(attrs ?? {})) el.setAttribute(k, v)
    if (text) el.insert(0, [new Y.XmlText(text)])
    fragment.push([el])
  }
  return Y.encodeStateAsUpdate(ydoc)
}

let ana: AuthUser
beforeEach(async () => {
  await resetDatabase()
  ana = await makeUser()
})
afterAll(async () => {
  await disconnectPrisma()
})

describe('texto plano e índice', () => {
  it('normaliza mayúsculas y tildes', () => {
    expect(normalizeForSearch('Canción ÑANDÚ Über')).toBe('cancion nandu uber')
    expect(normalizeForSearch('Wi-Fi unless-stopped 192.168.1.10')).toBe('wifi unlessstopped 192.168.1.10')
  })

  it('extrae el texto de cada bloque en su línea, con alt de imágenes', () => {
    const state = docState([
      ['heading', 'Título'],
      ['paragraph', 'Primer párrafo'],
      ['image', '', { src: 'x.png', alt: 'diagrama de red' }],
    ])
    expect(extractPlainText(state)).toBe('Título\nPrimer párrafo\ndiagrama de red')
    expect(extractPlainText(null)).toBe('')
  })

  it('guardar, crear y renombrar mantienen el índice al día', async () => {
    const doc = await createDocument(ana, { title: 'Red de casa' }, docState([['paragraph', 'Router en la entrada']]))
    expect((await searchDocuments(ana, 'router')).map((r) => r.id)).toEqual([doc.id])

    await saveYjsState(doc.id, docState([['paragraph', 'Ahora hay un switch']]))
    expect(await searchDocuments(ana, 'router')).toEqual([])
    expect((await searchDocuments(ana, 'switch')).map((r) => r.id)).toEqual([doc.id])

    await renameDocument(ana, doc.id, { title: 'Oficina' })
    expect(await searchDocuments(ana, 'casa')).toEqual([])
    expect((await searchDocuments(ana, 'oficina')).map((r) => r.id)).toEqual([doc.id])
  })
})

describe('búsqueda', () => {
  it('exige todas las palabras, ignora tildes y mayúsculas', async () => {
    const a = await createDocument(ana, { title: 'Backups' }, docState([['paragraph', 'Configuración de PostgreSQL con réplica']]))
    await createDocument(ana, { title: 'Otra' }, docState([['paragraph', 'PostgreSQL sin más']]))
    const res = await searchDocuments(ana, 'postgresql REPLICA configuracion')
    expect(res.map((r) => r.id)).toEqual([a.id])
  })

  it('las coincidencias en el título van primero', async () => {
    const enContenido = await createDocument(ana, { title: 'Apuntes' }, docState([['paragraph', 'docker docker docker docker']]))
    const enTitulo = await createDocument(ana, { title: 'Docker en el NAS' }, docState([['paragraph', 'nada']]))
    const res = await searchDocuments(ana, 'docker')
    expect(res.map((r) => r.id)).toEqual([enTitulo.id, enContenido.id])
    expect(res[0]!.titleMatch).toBe(true)
    expect(res[1]!.titleMatch).toBe(false)
  })

  it('devuelve un fragmento alrededor de la coincidencia con el texto original', async () => {
    const long = 'Lorem ipsum '.repeat(30) + 'la contraseña del Wi-Fi está en el gestor' + ' dolor sit'.repeat(30)
    await createDocument(ana, { title: 'Casa' }, docState([['paragraph', long]]))
    const [r] = await searchDocuments(ana, 'contrasena wifi')
    expect(r!.snippet).toContain('la contraseña del Wi-Fi está en el gestor')
    expect(r!.snippet.startsWith('…')).toBe(true)
    expect(r!.snippet.endsWith('…')).toBe(true)
    expect(r!.snippet.length).toBeLessThan(230)
  })

  it('consulta vacía, sin resultados y límite', async () => {
    for (let i = 0; i < 5; i++) await createDocument(ana, { title: `Nota ${i}` })
    expect(await searchDocuments(ana, '   ')).toEqual([])
    expect(await searchDocuments(ana, 'inexistente')).toEqual([])
    expect(await searchDocuments(ana, 'nota', { limit: 2 })).toHaveLength(2)
  })

  it('reindexa notas creadas antes de existir la búsqueda', async () => {
    const doc = await createDocument(ana, { title: 'Antigua' })
    await getPrisma().document.update({
      where: { id: doc.id },
      data: { yjsState: new Uint8Array(docState([['paragraph', 'contenido histórico']])), contentText: '', contentSearch: '', titleSearch: '' },
    })
    const empty = await createDocument(ana, { title: 'Vacía' })
    await getPrisma().document.update({ where: { id: empty.id }, data: { yjsState: new Uint8Array([0, 0]) } })

    expect(await searchDocuments(ana, 'historico')).toEqual([])
    await reindexMissingDocuments()
    expect((await searchDocuments(ana, 'historico')).map((r) => r.id)).toEqual([doc.id])
    expect((await searchDocuments(ana, 'antigua')).map((r) => r.id)).toEqual([doc.id])
    // Una segunda pasada no tiene nada que hacer.
    expect(await reindexMissingDocuments()).toBe(0)
  })
})
