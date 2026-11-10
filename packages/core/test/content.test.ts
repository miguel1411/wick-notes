import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  appendUpdate,
  CONTENT_KEY,
  isLegacyState,
  readMarkdown,
  replaceUpdate,
  restoreUpdate,
  stateFromMarkdown,
} from '../src'

const apply = (doc: Y.Doc, update: Uint8Array) => Y.applyUpdate(doc, update)
const docFrom = (state: Uint8Array) => {
  const d = new Y.Doc()
  Y.applyUpdate(d, state)
  return d
}

describe('contenido Markdown en Yjs', () => {
  it('guarda el texto exactamente como se escribió', () => {
    const md = '# Título\n\n  sangría y  espacios  \n\n* lista\n- otra\n\n```bash\n\techo hola\n```\n\nñandú 🚀'
    expect(readMarkdown(stateFromMarkdown(md))).toBe(md)
    expect(readMarkdown(null)).toBe('')
  })

  it('normaliza saltos de línea de Windows y el BOM', () => {
    expect(readMarkdown(stateFromMarkdown('﻿uno\r\ndos\rtres'))).toBe('uno\ndos\ntres')
  })

  it('reemplazar por diferencias no pisa una edición simultánea', () => {
    // Dos réplicas: el servidor y un navegador.
    const server = docFrom(stateFromMarkdown('Párrafo A\n\nPárrafo B\n\nPárrafo C'))
    const browser = docFrom(Y.encodeStateAsUpdate(server))

    // Un agente cambia el párrafo A mientras alguien escribe al final del C.
    const agent = replaceUpdate(Y.encodeStateAsUpdate(server), 'Párrafo A editado\n\nPárrafo B\n\nPárrafo C')
    const text = browser.getText(CONTENT_KEY)
    text.insert(text.length, ' (y más)')

    apply(server, agent)
    apply(server, Y.encodeStateAsUpdate(browser))
    apply(browser, Y.encodeStateAsUpdate(server))
    expect(server.getText(CONTENT_KEY).toString()).toBe('Párrafo A editado\n\nPárrafo B\n\nPárrafo C (y más)')
    expect(browser.getText(CONTENT_KEY).toString()).toBe(server.getText(CONTENT_KEY).toString())
  })

  it('reemplazar por el mismo texto no genera cambios de contenido', () => {
    const state = stateFromMarkdown('igual')
    const d = docFrom(state)
    apply(d, replaceUpdate(state, 'igual'))
    expect(d.getText(CONTENT_KEY).toString()).toBe('igual')
  })

  it('añade al final con una línea en blanco de separación', () => {
    const d = docFrom(stateFromMarkdown('# Notas\n\nPrimera'))
    apply(d, appendUpdate(Y.encodeStateAsUpdate(d), '## Segunda\n\n* punto'))
    expect(d.getText(CONTENT_KEY).toString()).toBe('# Notas\n\nPrimera\n\n## Segunda\n\n* punto')

    const conSalto = docFrom(stateFromMarkdown('Primera\n'))
    apply(conSalto, appendUpdate(Y.encodeStateAsUpdate(conSalto), 'Otra'))
    expect(conSalto.getText(CONTENT_KEY).toString()).toBe('Primera\n\nOtra')

    const vacia = new Y.Doc()
    apply(vacia, appendUpdate(null, 'Hola'))
    expect(vacia.getText(CONTENT_KEY).toString()).toBe('Hola')

    const enBlanco = docFrom(stateFromMarkdown('\n\n'))
    apply(enBlanco, appendUpdate(Y.encodeStateAsUpdate(enBlanco), 'Hola'))
    expect(enBlanco.getText(CONTENT_KEY).toString()).toBe('Hola')
  })

  it('restaura otra versión por diferencias, también a una nota vacía', () => {
    const v1 = stateFromMarkdown('# Plan\n\n* uno\n* dos')
    const live = docFrom(v1)
    apply(live, replaceUpdate(Y.encodeStateAsUpdate(live), '# Plan nuevo\n\nTodo distinto.'))
    expect(live.getText(CONTENT_KEY).toString()).toBe('# Plan nuevo\n\nTodo distinto.')

    apply(live, restoreUpdate(Y.encodeStateAsUpdate(live), v1))
    expect(live.getText(CONTENT_KEY).toString()).toBe('# Plan\n\n* uno\n* dos')

    apply(live, restoreUpdate(Y.encodeStateAsUpdate(live), null))
    expect(live.getText(CONTENT_KEY).toString()).toBe('')
  })

  it('reconoce el formato anterior (fragmento de ProseMirror sin texto)', () => {
    const legacy = new Y.Doc()
    const p = new Y.XmlElement('paragraph')
    p.insert(0, [new Y.XmlText('viejo')])
    legacy.getXmlFragment('prosemirror').push([p])
    expect(isLegacyState(Y.encodeStateAsUpdate(legacy))).toBe(true)
    expect(isLegacyState(stateFromMarkdown('nuevo'))).toBe(false)
    expect(isLegacyState(null)).toBe(false)
    expect(isLegacyState(Y.encodeStateAsUpdate(new Y.Doc()))).toBe(false)
  })
})
