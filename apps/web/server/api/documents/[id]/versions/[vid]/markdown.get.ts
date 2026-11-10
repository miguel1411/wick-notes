import { getDocument } from '@wick/core'

/** Contenido de una versión en Markdown. */
export default defineEventHandler(async (event) => {
  const doc = await runCore(() => getDocument(requireUser(event), requireId(event)), event)
  const markdown = await getVersionMarkdown(doc.id, getRouterParam(event, 'vid') ?? '')
  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  return markdown
})
