import { getWorkspaceTrees } from '@wick/core'

/** Árbol completo (carpetas anidadas y notas) de mis espacios. ?workspace= para uno solo. */
export default defineEventHandler((event) => {
  const { workspace } = getQuery(event)
  return runCore(() => getWorkspaceTrees(requireUser(event), typeof workspace === 'string' && workspace ? workspace : undefined), event)
})
