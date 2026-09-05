/**
 * Apply `schema.postgres.sql` to a Neon database. Run as `bun run db:push`.
 *
 * SQLite creates its tables in the store's constructor. Postgres cannot: the
 * work is async, and the other consumer is a fleet of Vercel lambdas with no
 * coordination between them — concurrent `CREATE INDEX IF NOT EXISTS` on the
 * same table is a way to deadlock, not a way to bootstrap. So schema is an
 * explicit step that a human or a deploy runs once.
 *
 * Every statement is `IF NOT EXISTS`, so re-running is a no-op and a partial
 * failure is fixed by running it again.
 */

import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'


const SCHEMA = readFileSync(new URL('./store/schema.postgres.sql', import.meta.url), 'utf8')

/**
 * Neon's HTTP endpoint refuses multi-statement SQL, so the file is split rather
 * than sent whole. The naive split on `;` is safe *because* the schema is only
 * plain `CREATE … IF NOT EXISTS` statements with no function bodies and no `$$`
 * quoting — schema.postgres.sql says so at the top, which is the thing that
 * would have to stay true.
 */
export function statementsOf (sql: string): string[] {
  return sql
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean)
}

export async function pushSchema (connectionString: string): Promise<string[]> {
  const sql        = neon(connectionString)
  const statements = statementsOf(SCHEMA)

  // Sequentially rather than in one `transaction()`: a batch is all-or-nothing,
  // and when something does go wrong the statement that failed is the useful
  // half of the error message.
  for (const statement of statements)
    await sql.query(statement)

  return statements
}
