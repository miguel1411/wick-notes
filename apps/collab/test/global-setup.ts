import { prepareTestDatabase } from '@wick/db/testing'

export default async function setup() {
  await prepareTestDatabase()
}
