import { isLegacyState } from '@wick/core'
import { getPrisma } from '@wick/db'

const BATCH = 50

/** Última versión de wick notes que convierte las notas del editor anterior. */
export const LAST_CONVERTER_VERSION = 'c1cbd76'

/**
 * Avisa si hay notas o versiones guardadas con el editor anterior (Milkdown).
 * Solo pasa si se restaura una copia de seguridad anterior al editor actual: se
 * verían vacías. No las toca: siguen en la base de datos y basta con arrancar
 * una vez la versión que las convierte (ver README, «Actualizar»).
 */
export async function warnLegacyContent(log: (msg: string) => void = console.warn): Promise<{ documents: number; versions: number }> {
  const prisma = getPrisma()
  const found = { documents: 0, versions: 0 }

  let cursor: string | undefined
  for (;;) {
    const docs = await prisma.document.findMany({
      where: { yjsState: { not: null } },
      select: { id: true, yjsState: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    found.documents += docs.filter((d) => isLegacyState(new Uint8Array(d.yjsState!))).length
    if (docs.length < BATCH) break
    cursor = docs.at(-1)!.id
  }

  cursor = undefined
  for (;;) {
    const versions: { id: string; yjsState: Uint8Array }[] = await prisma.documentVersion.findMany({
      select: { id: true, yjsState: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    found.versions += versions.filter((v) => isLegacyState(new Uint8Array(v.yjsState))).length
    if (versions.length < BATCH) break
    cursor = versions.at(-1)!.id
  }

  if (found.documents || found.versions) {
    log(
      `[collab] AVISO: ${found.documents} notas y ${found.versions} versiones están en el formato del editor anterior y se verán vacías. ` +
        `No se han tocado. Para convertirlas, arranca una vez la versión ${LAST_CONVERTER_VERSION} de wick notes (ver README, «Actualizar»).`,
    )
  }
  return found
}
