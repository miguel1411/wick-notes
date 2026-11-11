import { updateAiSettings, type UpdateAiSettingsInput } from '@wick/core'

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const body = await readJson<UpdateAiSettingsInput>(event)
  return runCore(() => updateAiSettings(user, body), event)
})
