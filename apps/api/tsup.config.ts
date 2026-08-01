import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // @da3wa/shared is TypeScript source, not a built package — inline it rather
  // than emitting an import Node cannot resolve at runtime.
  noExternal: ['@da3wa/shared'],
  // Native module; must stay an external require.
  external: ['@node-rs/argon2'],
});
