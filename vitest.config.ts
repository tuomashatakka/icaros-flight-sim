import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Resolves the `Δ*` and `@/*` aliases from tsconfig, so tests import engine
    // code the same way the app does.
    tsconfigPaths: true,
  },
  test: {
    // Server-package tests that stay off `bun:sqlite` run here too; the sqlite
    // store itself is covered by `bun test packages/server`, because vitest's
    // node runtime cannot import a bun: builtin.
    include: ['test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
