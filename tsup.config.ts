import { defineConfig, type Options } from 'tsup';

/** Shared with tests/global-setup.ts, which builds the same bundle into a temp dir. */
export const buildOptions = {
  entry: ['src/bin.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
} satisfies Options;

export default defineConfig(buildOptions);
