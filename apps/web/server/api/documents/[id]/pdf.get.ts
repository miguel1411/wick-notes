import { getDocument, PdfRenderError, pdfFilename, renderNotePdf } from '@wick/core'

/**
 * La nota como PDF (título, fecha de actualización y contenido), generado con
 * Typst dentro del servidor: sin navegador ni servicios externos.
 * Con ?download=1 se descarga como fichero; si no, el navegador lo muestra.
 */
export default defineEventHandler(async (event) => {
  const doc = await runCore(() => getDocument(requireUser(event), requireId(event)), event)
  const { markdown } = await getDocumentContent(doc.id)
  const { origin } = getRequestURL(event, { xForwardedHost: trustProxy(), xForwardedProto: trustProxy() })
  const updated = new Date(doc.updatedAt).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })

  let pdf: Uint8Array
  try {
    pdf = await renderNotePdf({
      title: doc.title,
      markdown,
      subtitle: `Actualizada el ${updated}`,
      baseUrl: origin,
      paper: useRuntimeConfig().pdfPaper === 'us-letter' ? 'us-letter' : 'a4',
    })
  } catch (err) {
    if (err instanceof PdfRenderError) {
      console.error(`[pdf] nota ${doc.id}:`, JSON.stringify(err.diagnostics))
      throw createError({ statusCode: 500, message: err.message })
    }
    throw err
  }

  setResponseHeader(event, 'Content-Type', 'application/pdf')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  if (getQuery(event).download) setAttachment(event, pdfFilename(doc.title))
  return Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength)
})
