import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { analyze, MISMATCH_PAIR, type Findings, type LoadedEnvFile } from './analyze.js';
import { scanWorkflows } from './ci-parser.js';
import { parseEnv } from './env-parser.js';
import { createNameFilter } from './glob.js';
import { scanProject } from './scanner.js';
import type { Definition, Reference, Warning } from './types.js';

/** Env files read from the scan root when present. Missing ones are silently skipped. */
export const DEFAULT_ENV_FILES = ['.env', '.env.example', '.env.local'] as const;

export interface AuditOptions {
  /** Absolute directory to scan. Env files and workflows are looked up here too. */
  root: string;
  /** Extra env files (--env), relative to `root` or absolute. They must exist. */
  envPaths?: readonly string[];
  /** Include GitHub Actions workflows (--ci). */
  ci?: boolean;
  /** Variable-name globs to skip (--ignore). */
  ignore?: readonly string[];
}

export interface AuditStats {
  filesScanned: number;
  /** References counted after --ignore is applied. */
  references: number;
  /** Distinct referenced names after --ignore is applied. */
  variables: number;
  envFiles: string[];
  workflows: string[];
}

export interface AuditReport extends Findings {
  stats: AuditStats;
  /** Why MISMATCH was not computed, or null when it was. */
  mismatchSkipped: string | null;
  warnings: Warning[];
}

/** Raised for problems caused by the user's input (e.g. a missing --env file). Exit code 2. */
export class UsageError extends Error {
  override name = 'UsageError';
}

export async function audit(options: AuditOptions): Promise<AuditReport> {
  const root = options.root;
  const ignore = options.ignore ?? [];
  const warnings: Warning[] = [];

  const envFiles = await loadEnvFiles(root, options.envPaths ?? [], warnings);

  const scan = await scanProject(root);
  warnings.push(...scan.warnings);

  let references: Reference[] = scan.references;
  let ciDefinitions: Definition[] = [];
  let workflows: string[] = [];
  if (options.ci) {
    const ci = await scanWorkflows(root);
    references = [...references, ...ci.references];
    ciDefinitions = ci.definitions;
    workflows = ci.files;
    warnings.push(...ci.warnings);
  }

  const findings = analyze({ references, envFiles, ciDefinitions, ignore });

  const isIgnored = createNameFilter(ignore);
  const counted = references.filter((r) => !isIgnored(r.name));
  const loadedNames = new Set(envFiles.map((f) => f.file));
  const absent = MISMATCH_PAIR.filter((name) => !loadedNames.has(name));

  return {
    ...findings,
    stats: {
      filesScanned: scan.files.length,
      references: counted.length,
      variables: new Set(counted.map((r) => r.name)).size,
      envFiles: envFiles.map((f) => f.file),
      workflows,
    },
    mismatchSkipped: absent.length > 0 ? `${absent.join(' and ')} not found` : null,
    warnings,
  };
}

async function loadEnvFiles(root: string, extra: readonly string[], warnings: Warning[]): Promise<LoadedEnvFile[]> {
  const loaded: LoadedEnvFile[] = [];
  const seen = new Set<string>();

  const load = async (path: string, required: boolean): Promise<void> => {
    const absolute = resolve(root, path);
    if (seen.has(absolute)) return;

    let source: string;
    try {
      source = await readFile(absolute, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' && !required) return;
      if (code === 'ENOENT') throw new UsageError(`env file not found: ${path}`);
      throw new UsageError(`cannot read env file ${path}: ${(error as Error).message}`);
    }

    seen.add(absolute);
    const file = relative(root, absolute).split(sep).join('/');
    const { entries, invalid } = parseEnv(source);
    for (const { line } of invalid) {
      warnings.push({ file, line, message: 'ignored a line that is not KEY=value' });
    }
    loaded.push({ file, entries });
  };

  for (const name of DEFAULT_ENV_FILES) await load(name, false);
  for (const path of extra) await load(path, true);
  return loaded;
}
