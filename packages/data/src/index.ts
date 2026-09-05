/**
 * Accounts and persistence, as a package.
 *
 * Everything in here depends on `node:crypto` and `@neondatabase/serverless` and
 * nothing else — no Bun builtins, no DOM, no `Δ…` reach into the app. That is
 * the point of it being a package rather than a directory, and its tsconfig
 * enforces it with empty `types` and `paths`: this code has to run unchanged in
 * a Next route handler on Vercel's Node runtime and in the Bun battle server,
 * and neither is allowed to be special.
 *
 * The SQLite adapter is the one deliberate exception. It imports `bun:sqlite`,
 * so it stays in `packages/server` and layers itself on top of `openStore`.
 */

export { MemoryStore } from './store/memory'
export { NeonStore } from './store/neon'
export { DEFAULT_DB_PATH, openStore, resolveDriver, storeDescription } from './store/open'
export { SESSION_TTL_MS } from './store/store'

export type { StoreDriver, StoreOptions } from './store/open'
export type {
  Account,
  AccountStats,
  MatchPlayerRecord,
  MatchRecord,
  Session,
  Store,
} from './store/store'

export { login, register, validCredentials } from './auth/accounts'
export type { AuthResult } from './auth/accounts'

export { dummyHash, hashPassword, verifyPassword } from './auth/hash'

// `./migrate` is deliberately NOT re-exported: it reads `schema.postgres.sql`
// off disk when the module loads, and this barrel is what a Next route handler
// imports. Reach it as `@crash-velocity/data/migrate` from a real process.
