/**
 * `NeonStore` against the shared contract, when there is a database to run it
 * against.
 *
 * Gated on `TEST_DATABASE_URL` rather than `DATABASE_URL`, so pointing a local
 * shell at a real Neon branch to run the app cannot make `bun run test` start
 * writing to it. `skipIf` rather than a bare `if`, so the skip is visible in
 * the report instead of the file silently doing nothing.
 *
 *     TEST_DATABASE_URL='postgres://...' bun run test
 *
 * This is the only place the driver's type handling is actually exercised —
 * `bigint` and `count()` come back as strings unless something coerces them,
 * and no amount of memory-store agreement will tell you that.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { runStoreContract } from './store-contract'
import { NeonStore } from '../src/store/neon'
import { pushSchema } from '../src/migrate'


const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('NeonStore', () => {
  beforeAll(async () => {
    // Idempotent, so running the suite against a branch that already has the
    // schema costs one no-op round trip.
    await pushSchema(url as string)
  })

  runStoreContract('NeonStore', () => new NeonStore(url as string), { describe, expect, it })
})
