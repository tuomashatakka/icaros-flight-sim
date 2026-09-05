/**
 * `bun run db:migrate` — apply generated migrations to Neon.
 *
 * Prefers the unpooled endpoint: DDL takes locks, and transaction pooling is
 * the wrong shape for that.
 */

import { migrateNeon } from './migrate'


const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL

if (!url) {
  console.error('DATABASE_URL_UNPOOLED or DATABASE_URL must be set')
  process.exit(1)
}

try {
  await migrateNeon(url)
  console.log('migrations applied')
}
catch (error) {
  console.error('migration failed:', error instanceof Error ? error.message : error)
  process.exit(1)
}
