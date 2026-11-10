import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  appendUpdate,
  CONTENT_KEY,
  ContentEditError,
  editUpdate,
  isLegacyState,
  mergeUpdate,
  readMarkdown,
  replaceUpdate,
  restoreUpdate,
  stateFromMarkdown,
  stateIncludes,
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

describe('escrituras de agentes sin pisar a nadie', () => {
  /** Nota viva, lo que leyó el agente y lo que una persona escribe después. */
  function scenario() {
    const live = docFrom(stateFromMarkdown('# Servidor\n\nIP: 10.0.0.1\n\nNotas pendientes.\n'))
    const read = Y.encodeStateAsUpdate(live)
    const t = live.getText(CONTENT_KEY)
    t.insert(t.toString().indexOf('Notas'), 'Puerto SSH: 2222\n\n')
    t.delete(t.toString().indexOf(' pendientes'), ' pendientes'.length)
    return { live, read }
  }
  const agentText = '# Servidor (producción)\n\nIP: 10.0.0.1\n\nNotas pendientes.\n\n## Copias\nDiarias.\n'

  it('reemplazar sin la lectura borra lo escrito después (el problema)', () => {
    const { live } = scenario()
    apply(live, replaceUpdate(Y.encodeStateAsUpdate(live), agentText))
    expect(live.getText(CONTENT_KEY).toString()).toBe(agentText)
  })

  it('fusionar desde la lectura conserva lo de la persona y lo del agente', () => {
    const { live, read } = scenario()
    apply(live, mergeUpdate(read, agentText, Y.encodeStateAsUpdate(live)))
    expect(live.getText(CONTENT_KEY).toString()).toBe(
      '# Servidor (producción)\n\nIP: 10.0.0.1\n\nPuerto SSH: 2222\n\nNotas.\n\n## Copias\nDiarias.\n',
    )
  })

  it('sin cambios ajenos, fusionar deja exactamente el texto del agente', () => {
    const live = docFrom(stateFromMarkdown('uno\ndos'))
    apply(live, mergeUpdate(Y.encodeStateAsUpdate(live), 'uno\ndos\ntres', Y.encodeStateAsUpdate(live)))
    expect(live.getText(CONTENT_KEY).toString()).toBe('uno\ndos\ntres')
  })

  it('fusionar es igual de seguro si llega antes que lo escrito por la persona', () => {
    const live = docFrom(stateFromMarkdown('a\n\nb'))
    const read = Y.encodeStateAsUpdate(live)
    const browser = docFrom(read)
    browser.getText(CONTENT_KEY).insert(1, ' (persona)')
    apply(live, mergeUpdate(read, 'a\n\nb (agente)', read))
    apply(live, Y.encodeStateAsUpdate(browser))
    expect(live.getText(CONTENT_KEY).toString()).toBe('a (persona)\n\nb (agente)')
  })

  it('si escriben a la vez en el mismo punto, lo de la persona queda delante', () => {
    // Ids de navegador: bajo, medio y justo por debajo de la franja de los agentes.
    for (const person of [7, 0x7fffffff, 0xffefffff]) {
      const live = docFrom(stateFromMarkdown('Fin.'))
      live.clientID = person
      const read = Y.encodeStateAsUpdate(live)
      live.getText(CONTENT_KEY).insert(4, ' Ana')
      apply(live, mergeUpdate(read, 'Fin.\n\n## Agente', Y.encodeStateAsUpdate(live)))
      // También al añadir al final con la persona escribiendo (aún sin llegar).
      const browser = docFrom(Y.encodeStateAsUpdate(live))
      browser.clientID = 7
      browser.getText(CONTENT_KEY).insert(browser.getText(CONTENT_KEY).length, ' Sigo.')
      apply(live, appendUpdate(Y.encodeStateAsUpdate(live), 'Anexo'))
      apply(live, Y.encodeStateAsUpdate(browser))
      expect(live.getText(CONTENT_KEY).toString()).toBe('Fin. Ana\n\n## Agente Sigo.\n\nAnexo')
    }
  })

  it('los cambios externos nunca reutilizan un cliente de la nota', () => {
    const live = docFrom(stateFromMarkdown('x'))
    const clients = () => [...Y.decodeStateVector(Y.encodeStateVector(live)).keys()]
    for (let i = 0; i < 5; i++) apply(live, appendUpdate(Y.encodeStateAsUpdate(live), `${i}`))
    const ids = clients()
    expect(new Set(ids).size).toBe(6)
    expect(ids.filter((c) => c >= 0xfff00000)).toHaveLength(5)
  })

  it('reconoce si una lectura es anterior a la nota actual', () => {
    const { live, read } = scenario()
    expect(stateIncludes(Y.encodeStateAsUpdate(live), read)).toBe(true)
    expect(stateIncludes(read, Y.encodeStateAsUpdate(live))).toBe(false)
    expect(stateIncludes(Y.encodeStateAsUpdate(live), stateFromMarkdown('otra nota'))).toBe(false)
    expect(stateIncludes(null, Y.encodeStateAsUpdate(new Y.Doc()))).toBe(true)
  })

  it('cambios puntuales: solo el fragmento, en orden', () => {
    const live = docFrom(stateFromMarkdown('# Red\n\nGateway: 192.168.1.1\nDNS: 1.1.1.1\n'))
    const t = live.getText(CONTENT_KEY)
    apply(
      live,
      editUpdate(Y.encodeStateAsUpdate(live), [
        { find: 'DNS: 1.1.1.1', replace: 'DNS: 9.9.9.9' },
        { find: '# Red\n', replace: '# Red de casa\n' },
      ]),
    )
    expect(t.toString()).toBe('# Red de casa\n\nGateway: 192.168.1.1\nDNS: 9.9.9.9\n')
  })

  it('cambios puntuales: conservan lo escrito a la vez en el mismo párrafo', () => {
    const live = docFrom(stateFromMarkdown('Hay que revisar el disco y la RAM.'))
    const read = Y.encodeStateAsUpdate(live)
    live.getText(CONTENT_KEY).insert(live.getText(CONTENT_KEY).length, ' Urgente.')
    apply(live, editUpdate(read, [{ find: 'el disco', replace: 'el disco SSD' }]))
    expect(live.getText(CONTENT_KEY).toString()).toBe('Hay que revisar el disco SSD y la RAM. Urgente.')
  })

  it('cambios puntuales: todo o nada si un fragmento no está o se repite', () => {
    const state = stateFromMarkdown('uno dos uno')
    expect(() => editUpdate(state, [{ find: 'dos', replace: '2' }, { find: 'tres', replace: '3' }])).toThrow(ContentEditError)
    expect(() => editUpdate(state, [{ find: 'tres', replace: '3' }])).toThrow(/no está en la nota/)
    expect(() => editUpdate(state, [{ find: 'uno', replace: '1' }])).toThrow(/aparece varias veces/)
    expect(() => editUpdate(state, [{ find: '', replace: 'x' }])).toThrow(ContentEditError)
    // Un fragmento puede volverse único tras un cambio anterior.
    const live = docFrom(state)
    apply(live, editUpdate(state, [{ find: 'uno dos', replace: 'one dos' }, { find: 'uno', replace: '1' }]))
    expect(live.getText(CONTENT_KEY).toString()).toBe('one dos 1')
    // Saltos de línea de Windows en el fragmento.
    const crlf = docFrom(stateFromMarkdown('a\nb'))
    apply(crlf, editUpdate(Y.encodeStateAsUpdate(crlf), [{ find: 'a\r\nb', replace: 'a\r\nc' }]))
    expect(crlf.getText(CONTENT_KEY).toString()).toBe('a\nc')
  })
})
