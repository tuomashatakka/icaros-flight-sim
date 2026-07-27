import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Resolves the `@/*` alias from tsconfig, so tests import engine code the
    // same way the app does.
    tsconfigPaths: true,
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
