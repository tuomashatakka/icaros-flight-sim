/**
 * `MemoryStore` against the shared contract.
 *
 * The one implementation every other server test runs against, so it is also
 * the one whose agreement with the others matters most.
 */
import { describe, expect, it } from 'vitest'
import { runStoreContract } from './store-contract'
import { MemoryStore } from '../src/store/memory'


runStoreContract('MemoryStore', () => new MemoryStore(), { describe, expect, it })
