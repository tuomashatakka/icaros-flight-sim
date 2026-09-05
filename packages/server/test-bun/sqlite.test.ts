/**
 * The SQLite `Store`.
 *
 * Runs under `bun test` because it imports `bun:sqlite` — the last thing in the
 * repo that has to. The suite itself is `store-contract.ts`, shared with the
 * implementations in `@crash-velocity/data`, because an interface only buys
 * anything if everything behind it answers the same way.
 */
import { describe, expect, it } from 'bun:test'
// Reaches across into the sibling package's tests on purpose: the contract is
// one file so that three implementations cannot quietly diverge, and this is
// the only one of the three that cannot run under vitest.
import { runStoreContract, uniqueName } from '../../data/test/store-contract'
import { SqliteStore } from '../src/store/sqlite'


runStoreContract('SqliteStore', () => new SqliteStore(':memory:'), { describe, expect, it })

describe('SqliteStore durability', () => {
  it('keeps accounts across reopening the same file', async () => {
    // The point of keeping sqlite at all: developing offline, where the whole
    // database is a file, and restarting must not lose everyone's account.
    const path     = `/tmp/cv-store-${crypto.randomUUID()}.sqlite`
    const username = uniqueName()
    const first    = new SqliteStore(path)
    const made     = await first.createAccount(username, 'hashed')
    first.close()

    const second = new SqliteStore(path)
    expect((await second.findAccount(username))?.id).toBe(made!.id)
    second.close()
  })
})
