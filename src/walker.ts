import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { GitignoreMatcher } from './gitignore.js';
import type { Warning } from './types.js';

/** Directory names that are never descended into, at any depth. */
export const DEFAULT_SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  '.git',
  'venv',
  '.venv',
]);

export interface WalkOptions {
  /** Lower-case extensions including the dot, e.g. `.ts`. */
  extensions: ReadonlySet<string>;
  skipDirs?: ReadonlySet<string>;
  respectGitignore?: boolean;
}

export interface WalkResult {
  /** POSIX paths relative to the root, sorted. */
  files: string[];
  warnings: Warning[];
}

/**
 * Recursively list files under `root` whose extension is in `options.extensions`.
 * Honors .gitignore files at every level, never follows symlinks, and skips
 * `DEFAULT_SKIP_DIRS` regardless of .gitignore content.
 */
export async function walk(root: string, options: WalkOptions): Promise<WalkResult> {
  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  const respectGitignore = options.respectGitignore ?? true;
  const files: string[] = [];
  const warnings: Warning[] = [];

  async function visit(relDir: string, matcher: GitignoreMatcher): Promise<void> {
    const absDir = relDir === '' ? root : join(root, relDir);
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch (error) {
      warnings.push({ file: relDir || '.', message: `cannot read directory: ${errorMessage(error)}` });
      return;
    }

    if (respectGitignore && entries.some((e) => e.name === '.gitignore' && e.isFile())) {
      const source = await readFile(join(absDir, '.gitignore'), 'utf8');
      matcher = matcher.extend(relDir, source);
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`;

      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        if (respectGitignore && matcher.ignores(relPath, true)) continue;
        await visit(relPath, matcher);
      } else if (entry.isFile()) {
        if (!options.extensions.has(extname(entry.name).toLowerCase())) continue;
        if (respectGitignore && matcher.ignores(relPath, false)) continue;
        files.push(relPath);
      }
    }
  }

  await visit('', GitignoreMatcher.empty());
  files.sort();
  return { files, warnings };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
