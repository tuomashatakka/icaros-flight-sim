import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema:  './packages/data/src/schema.ts',
  out:     './packages/data/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // DDL takes locks that PgBouncer's transaction pooling is the wrong shape
    // for, so migrations go to the direct endpoint when there is one.
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? '',
  },
  casing: 'snake_case',
})
