import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Integration tests share one Postgres database; running files in parallel
    // makes them race on truncation. Unit tests are fast enough that serial is fine.
    fileParallelism: false,
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setup.ts'],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@da3wa/shared': r('../../packages/shared/src/index.ts'),
      '@': r('./src'),
    },
  },
});
