import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'tsup';
import type { TestProject } from 'vitest/node';
import { buildOptions } from '../tsup.config.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Absolute path of the freshly built CLI entry (bin.js). */
    cliPath: string;
  }
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Build the real bundle once so the integration tests exercise exactly what ships (shebang,
 * ESM output, externalized deps). It goes under node_modules/.cache rather than dist/ so a
 * running `npm run dev` is not disturbed, and rather than the OS temp dir so that `commander`
 * and `picocolors` still resolve from the repo's node_modules.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const cacheDir = join(repoRoot, 'node_modules', '.cache');
  await mkdir(cacheDir, { recursive: true });
  const outDir = await mkdtemp(join(cacheDir, 'envcheck-cli-'));

  await build({ ...buildOptions, outDir, config: false, silent: true });
  // Files under node_modules/ do not inherit the root package.json "type": "module".
  await writeFile(join(outDir, 'package.json'), '{ "type": "module" }\n');

  project.provide('cliPath', join(outDir, 'bin.js'));
  return async () => {
    await rm(outDir, { recursive: true, force: true });
  };
}
