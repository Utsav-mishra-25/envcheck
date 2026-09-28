import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Definition, Reference, Warning } from './types.js';

export const WORKFLOWS_DIR = '.github/workflows';

/** Secrets GitHub provides automatically; referencing them never needs a definition. */
export const BUILTIN_SECRETS: ReadonlySet<string> = new Set(['GITHUB_TOKEN']);

export interface WorkflowParseResult {
  /** Keys of every `env:` mapping (workflow, job, step, container, service level). */
  definitions: Definition[];
  /** `secrets.X` / `secrets['X']` uses inside `${{ }}` expressions and `if:` conditions. */
  references: Reference[];
}

const NAME = '[A-Za-z_][A-Za-z0-9_]*';
const ENV_KEY = /^(\s*)(-\s+)?env\s*:\s*(.*)$/;
const MAPPING_KEY = new RegExp(`^\\s*(["']?)(${NAME})\\1\\s*:(?:\\s|$)`);
const FLOW_KEY = new RegExp(`(?:^|[{,])\\s*(["']?)(${NAME})\\1\\s*:`, 'g');
const BLOCK_SCALAR = /^\s*(?:-\s+)?[^\s#][^#]*?:\s*[|>][-+0-9]*\s*$/;
const IF_KEY = /^\s*(?:-\s+)?if\s*:(.*)$/;
const EXPRESSION = /\$\{\{(.*?)\}\}/g;
const SECRET = new RegExp(`(?<![\\w.])secrets(?:\\.(${NAME})|\\[\\s*(["'])(${NAME})\\2\\s*\\])`, 'g');

/**
 * Line-based parser for GitHub Actions workflow YAML. It understands just enough YAML to
 * find `env:` mappings (block and single-line flow style) and to skip block scalars such as
 * `run: |` scripts. Anchors, aliases and multi-line flow mappings are not supported.
 */
export function parseWorkflow(source: string, file: string): WorkflowParseResult {
  const definitions: Definition[] = [];
  const references: Reference[] = [];
  const lines = source.split(/\r?\n/);

  /** Indent of the `env` key whose mapping we are inside, or null. */
  let envIndent: number | null = null;
  /** Indent of that mapping's keys, fixed by its first entry. */
  let envChildIndent: number | null = null;
  /** Indent of the key that opened a `|` / `>` block scalar we are inside, or null. */
  let scalarIndent: number | null = null;

  for (let index = 0; index < lines.length; index++) {
    const line = stripComment(lines[index] as string);
    if (line.trim() === '') continue;
    const lineNo = index + 1;
    const indent = line.length - line.trimStart().length;

    collectSecrets(line, file, lineNo, references);

    if (scalarIndent !== null) {
      if (indent > scalarIndent) continue;
      scalarIndent = null;
    }

    if (envIndent !== null) {
      if (indent > envIndent) {
        envChildIndent ??= indent;
        if (indent === envChildIndent) {
          const key = MAPPING_KEY.exec(line);
          if (key) definitions.push({ name: key[2] as string, file, line: lineNo, kind: 'ci' });
          if (BLOCK_SCALAR.test(line)) scalarIndent = indent;
        }
        continue;
      }
      envIndent = null;
      envChildIndent = null;
    }

    const env = ENV_KEY.exec(line);
    if (env) {
      const keyIndent = (env[1] as string).length + (env[2]?.length ?? 0);
      const rest = (env[3] ?? '').trim();
      if (rest === '') {
        envIndent = keyIndent;
      } else if (rest.startsWith('{')) {
        for (const match of rest.matchAll(FLOW_KEY)) {
          definitions.push({ name: match[2] as string, file, line: lineNo, kind: 'ci' });
        }
      }
      continue;
    }

    // For `- run: |` the owning key sits after the dash, so measure to the key itself.
    if (BLOCK_SCALAR.test(line)) scalarIndent = (/^\s*(?:-\s+)?/.exec(line)?.[0].length ?? indent);
  }

  return { definitions, references };
}

/** Collect `secrets.X` inside `${{ }}` spans, or anywhere in an `if:` value (implicit expression). */
function collectSecrets(line: string, file: string, lineNo: number, out: Reference[]): void {
  const spans: Array<{ text: string; offset: number }> = [];
  const ifMatch = IF_KEY.exec(line);
  if (ifMatch) {
    const value = ifMatch[1] as string;
    spans.push({ text: value, offset: line.length - value.length });
  } else {
    for (const match of line.matchAll(EXPRESSION)) {
      spans.push({ text: match[1] as string, offset: (match.index ?? 0) + 3 });
    }
  }

  for (const span of spans) {
    for (const match of span.text.matchAll(SECRET)) {
      const name = (match[1] ?? match[3]) as string;
      if (BUILTIN_SECRETS.has(name)) continue;
      out.push({
        name,
        file,
        line: lineNo,
        column: span.offset + (match.index ?? 0) + 1,
        syntax: 'secrets',
      });
    }
  }
}

/** Drop a trailing `# comment`, ignoring `#` inside quotes. Full-line comments become ''. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1] as string))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

export interface WorkflowScanResult extends WorkflowParseResult {
  files: string[];
  warnings: Warning[];
}

/** Parse every `.yml` / `.yaml` file directly inside `.github/workflows`. */
export async function scanWorkflows(root: string): Promise<WorkflowScanResult> {
  const dir = join(root, WORKFLOWS_DIR);
  const result: WorkflowScanResult = { definitions: [], references: [], files: [], warnings: [] };

  let names: string[];
  try {
    names = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && /\.ya?ml$/i.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    result.warnings.push({ file: WORKFLOWS_DIR, message: '--ci was passed but no workflows directory was found' });
    return result;
  }

  for (const name of names) {
    const file = `${WORKFLOWS_DIR}/${name}`;
    const parsed = parseWorkflow(await readFile(join(root, file), 'utf8'), file);
    result.files.push(file);
    result.definitions.push(...parsed.definitions);
    result.references.push(...parsed.references);
  }
  return result;
}
