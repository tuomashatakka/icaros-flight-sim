/**
 * `bun run db:push` — apply the Postgres schema.
 *
 * A separate entry from `migrate.ts` so that module stays importable without a
 * top-level side effect: `migrate.ts` reads a `.sql` file off disk at load, and
 * anything that reaches it from a bundler (a Next route handler, say) would
 * have to resolve that read at build time.
 */

import { pushSchema } from './migrate'


// Unpooled when it is offered. DDL takes locks, and PgBouncer's transaction
// pooling is the wrong shape for that; the pooled URL is for the query path.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL

if (!url) {
  console.error('db:push needs DATABASE_URL (or DATABASE_URL_UNPOOLED). The Vercel Neon integration injects both.')
  process.exit(1)
}

const applied = await pushSchema(url)
console.info(`[db:push] applied ${applied.length} statements to ${url.replace(/^.*@/, '').split('/')[0]}`)
