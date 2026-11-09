import {
  createDocument,
  DEFAULT_TITLE,
  importMarkdownInput,
  splitTitleFromMarkdown,
  titleFromFilename,
  type ImportMarkdownInput,
} from '@wick/core'

/**
 * Crea una nota a partir de un Markdown. Título: el indicado; si no, el `# Título`
 * con el que empiece el fichero (que se quita del contenido); si no, el nombre del fichero.
 */
export default defineEventHandler(async (event) => {
  assertBodySize(event)
  const user = requireUser(event)
  const input = await runCore(async () => parseInput(importMarkdownInput, await readJson<ImportMarkdownInput>(event)), event)

  const { title: heading, body } = splitTitleFromMarkdown(input.markdown)
  const explicit = input.title?.trim()
  const title = explicit || heading || titleFromFilename(input.filename) || DEFAULT_TITLE
  // Si el # inicial coincide con el título (o se usó como título), no se duplica en el contenido.
  const content = heading && (!explicit || heading === explicit) ? body : input.markdown

  const state = await markdownToYjsState(content)
  const doc = await runCore(() => createDocument(user, { title }, state), event)
  setResponseStatus(event, 201)
  return doc
})
