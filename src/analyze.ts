import type { EnvEntry } from './env-parser.js';
import { createNameFilter } from './glob.js';
import type { Definition, Reference } from './types.js';

/** The two files compared for MISMATCH, by their path relative to the scan root. */
export const MISMATCH_PAIR = ['.env', '.env.example'] as const;

export interface LoadedEnvFile {
  /** Display path, relative to the scan root. */
  file: string;
  entries: EnvEntry[];
}

export interface AnalyzeInput {
  /** Code references plus, with --ci, workflow `secrets.X` references. */
  references: Reference[];
  envFiles: LoadedEnvFile[];
  /** Workflow `env:` keys (only with --ci). They satisfy references but are never UNUSED. */
  ciDefinitions: Definition[];
  /** Variable-name globs to drop from every section. */
  ignore: readonly string[];
}

export interface MissingFinding {
  name: string;
  /** Every place the variable is referenced, sorted by file then position. */
  references: Reference[];
}

export interface UnusedFinding {
  name: string;
  /** First definition of the variable in each env file that defines it. */
  definitions: Array<{ file: string; line: number }>;
}

export interface MismatchFinding {
  name: string;
  presentIn: string;
  missingFrom: string;
  /** Line in `presentIn`. */
  line: number;
}

export interface Findings {
  missing: MissingFinding[];
  unused: UnusedFinding[];
  mismatch: MismatchFinding[];
}

/**
 * Pure core of envcheck: compare references against definitions.
 *
 * - MISSING: referenced, but defined neither in an env file nor (with --ci) a workflow env.
 * - UNUSED: defined in an env file, never referenced.
 * - MISMATCH: in `.env` but not `.env.example`, or the reverse. Only computed when both exist.
 */
export function analyze(input: AnalyzeInput): Findings {
  const isIgnored = createNameFilter(input.ignore);
  const references = input.references.filter((r) => !isIgnored(r.name));

  const envDefinitions = new Map<string, Array<{ file: string; line: number }>>();
  for (const envFile of input.envFiles) {
    const seenInFile = new Set<string>();
    for (const { key, line } of envFile.entries) {
      if (isIgnored(key) || seenInFile.has(key)) continue;
      seenInFile.add(key);
      const list = envDefinitions.get(key) ?? [];
      list.push({ file: envFile.file, line });
      envDefinitions.set(key, list);
    }
  }
  const ciDefined = new Set(input.ciDefinitions.map((d) => d.name));

  const referencesByName = new Map<string, Reference[]>();
  for (const ref of references) {
    const list = referencesByName.get(ref.name) ?? [];
    list.push(ref);
    referencesByName.set(ref.name, list);
  }

  const missing: MissingFinding[] = [];
  for (const [name, refs] of referencesByName) {
    if (envDefinitions.has(name) || ciDefined.has(name)) continue;
    missing.push({ name, references: [...refs].sort(compareLocation) });
  }

  const unused: UnusedFinding[] = [];
  for (const [name, definitions] of envDefinitions) {
    if (!referencesByName.has(name)) unused.push({ name, definitions });
  }

  return {
    missing: missing.sort(byName),
    unused: unused.sort(byName),
    mismatch: findMismatches(input.envFiles, isIgnored),
  };
}

function findMismatches(envFiles: LoadedEnvFile[], isIgnored: (name: string) => boolean): MismatchFinding[] {
  const [leftName, rightName] = MISMATCH_PAIR;
  const left = envFiles.find((f) => f.file === leftName);
  const right = envFiles.find((f) => f.file === rightName);
  if (!left || !right) return [];

  const onlyIn = (a: LoadedEnvFile, b: LoadedEnvFile): MismatchFinding[] => {
    const inB = new Set(b.entries.map((e) => e.key));
    const seen = new Set<string>();
    const result: MismatchFinding[] = [];
    for (const { key, line } of a.entries) {
      if (inB.has(key) || seen.has(key) || isIgnored(key)) continue;
      seen.add(key);
      result.push({ name: key, presentIn: a.file, missingFrom: b.file, line });
    }
    return result.sort(byName);
  };

  return [...onlyIn(left, right), ...onlyIn(right, left)];
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function compareLocation(a: Reference, b: Reference): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.line - b.line || a.column - b.column;
}
