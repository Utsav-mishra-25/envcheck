import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const FIXTURE_SOURCE = fileURLToPath(new URL('./fixtures/project/', import.meta.url));

/**
 * Files envcheck must never scan. They are written into a temp copy of the fixture at run
 * time rather than committed: skip dirs and gitignored paths would need `git add -f`, and a
 * `.git` directory cannot be committed at all. The fixture's own .gitignore (`generated/`,
 * `*.local.ts`, `!keep.local.ts`) is what excludes the last two.
 */
const DECOYS: Readonly<Record<string, string>> = {
  'node_modules/fake-lib/index.js': 'module.exports = process.env.FROM_NODE_MODULES;\n',
  'dist/bundle.js': 'console.log(process.env.FROM_DIST);\n',
  'venv/lib/site.py': 'import os\nos.getenv("FROM_VENV")\n',
  '.venv/lib/site.py': 'import os\nos.getenv("FROM_DOT_VENV")\n',
  '.git/hooks/pre-commit.js': 'console.log(process.env.FROM_GIT_DIR);\n',
  'generated/client.ts': 'export const generated = process.env.FROM_GITIGNORED_DIR;\n',
  'src/drop.local.ts': 'export const dropped = process.env.FROM_GITIGNORED_FILE;\n',
};

/** Temp copy of tests/fixtures/project plus DECOYS; every fixture test runs here. */
let fixtureDir: string;

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'envcheck-fixture-'));
  await cp(FIXTURE_SOURCE, fixtureDir, { recursive: true });
  for (const [rel, content] of Object.entries(DECOYS)) {
    await mkdir(dirname(join(fixtureDir, rel)), { recursive: true });
    await writeFile(join(fixtureDir, rel), content);
  }
});

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run the built CLI as a child process, exactly as `npx envcheck` would. */
function envcheck(args: string[], cwd = fixtureDir): CliResult {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
  delete env.FORCE_COLOR;
  const result = spawnSync(process.execPath, [inject('cliPath'), ...args], { cwd, env, encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

interface JsonReport {
  summary: { missing: number; unused: number; mismatch: number; total: number };
  stats: { filesScanned: number; references: number; variables: number; envFiles: string[]; workflows: string[] };
  missing: Array<{ name: string; references: Array<{ file: string; line: number; column: number; syntax: string }> }>;
  unused: Array<{ name: string; definitions: Array<{ file: string; line: number }> }>;
  mismatch: Array<{ name: string; presentIn: string; missingFrom: string; line: number }>;
  mismatchSkipped: string | null;
  warnings: Array<{ file: string; line?: number; message: string }>;
}

function envcheckJson(args: string[] = [], cwd?: string): JsonReport {
  const { stdout, code } = envcheck(['--json', ...args], cwd);
  expect(code).toBe(0);
  return JSON.parse(stdout) as JsonReport;
}

const names = (items: Array<{ name: string }>) => items.map((i) => i.name);

const DEFAULT_MISSING = [
  'AWS_REGION',
  'CELERY_BROKER_URL',
  'DEPLOY_REGION',
  'GO_SERVICE_TOKEN',
  'KEPT_BY_NEGATION',
  'LOG_LEVEL',
  'MAILER_FROM',
  'MAILER_REPLY_TO',
  'NODE_OPTIONS',
  'SMTP_HOST',
  'SMTP_PASSWORD',
  'VITE_ANALYTICS_ID',
  'VITE_FEATURE_FLAG',
  'WORKER_CONCURRENCY',
  'WORKER_DEBUG',
];

describe('envcheck against the fixture project', () => {
  it('prints the grouped human report and exits 0 without --strict', () => {
    const { code, stdout, stderr } = envcheck([]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('envcheck · 8 files scanned · 24 references to 23 variables');
    expect(stdout).toContain('env files: .env, .env.example, .env.local');
    expect(stdout).toContain('MISSING (15) referenced but not defined in any env file');
    expect(stdout).toContain('UNUSED (4) defined in env files, never referenced');
    expect(stdout).toContain('MISMATCH (3) .env and .env.example disagree');
    expect(stdout).toContain('✖ 22 findings (15 missing · 4 unused · 3 mismatch)');
    expect(stdout).not.toMatch(/\u001b\[/); // NO_COLOR is honored
  });

  it('shows file:line under each missing variable', () => {
    const { stdout } = envcheck([]);
    expect(stdout).toContain('  AWS_REGION\n    src/server.ts:6\n');
    expect(stdout).toContain('  MAILER_REPLY_TO\n    lib/mailer.rb:6\n');
    expect(stdout).toContain('  GO_SERVICE_TOKEN\n    cmd/api/main.go:11\n');
    expect(stdout).toContain('  SLACK_WEBHOOK_URL  .env:9, .env.example:9');
    expect(stdout).toContain('  SENTRY_DSN        in .env.example:6, missing from .env');
  });

  it('finds every supported syntax and reports exact positions in JSON', () => {
    const report = envcheckJson();
    expect(names(report.missing)).toEqual(DEFAULT_MISSING);

    const where = (name: string) => report.missing.find((m) => m.name === name)?.references;
    expect(where('LOG_LEVEL')).toEqual([{ file: 'src/server.ts', line: 5, column: 18, syntax: 'process.env' }]);
    expect(where('AWS_REGION')).toEqual([{ file: 'src/server.ts', line: 6, column: 16, syntax: 'process.env' }]);
    expect(where('VITE_FEATURE_FLAG')?.[0]?.syntax).toBe('import.meta.env');
    expect(where('VITE_ANALYTICS_ID')?.[0]?.syntax).toBe('import.meta.env');
    expect(where('NODE_OPTIONS')?.[0]?.file).toBe('src/legacy.js');
    expect(where('CELERY_BROKER_URL')?.[0]?.syntax).toBe('os.environ');
    expect(where('WORKER_CONCURRENCY')?.[0]?.syntax).toBe('os.getenv');
    expect(where('WORKER_DEBUG')?.[0]?.syntax).toBe('os.environ');
    expect(where('GO_SERVICE_TOKEN')?.[0]?.syntax).toBe('os.Getenv');
    expect(where('DEPLOY_REGION')?.[0]?.syntax).toBe('os.LookupEnv');
    expect(where('SMTP_HOST')?.[0]?.syntax).toBe('ENV');
    expect(where('MAILER_FROM')?.[0]?.syntax).toBe('ENV');

    // Defined-and-used names never show up, whichever syntax referenced them.
    const all = [...names(report.missing), ...names(report.unused)];
    for (const used of ['DATABASE_URL', 'API_KEY', 'PORT', 'REDIS_URL', 'SESSION_SECRET', 'VITE_API_URL', 'SENTRY_DSN']) {
      expect(all).not.toContain(used);
    }
  });

  it('never scans decoys: skip dirs, gitignored paths, unsupported files, dynamic keys', () => {
    const { stdout } = envcheck(['--json']);
    const decoyNames = Object.values(DECOYS).map((content) => /FROM_[A-Z_]+/.exec(content)?.[0]);
    expect(decoyNames).not.toContain(undefined);
    // FROM_MARKDOWN lives in the fixture's README.md; NOT_DETECTED is a dynamic key in legacy.js.
    for (const decoy of [...decoyNames, 'FROM_MARKDOWN', 'NOT_DETECTED']) {
      expect(stdout).not.toContain(decoy);
    }
  });

  it('reports unused and mismatched definitions with their lines', () => {
    const report = envcheckJson();
    expect(report.unused).toEqual([
      { name: 'LEGACY_TOKEN', definitions: [{ file: '.env', line: 7 }] },
      { name: 'LOCAL_DEBUG', definitions: [{ file: '.env.local', line: 2 }] },
      { name: 'OLD_FEATURE_FLAG', definitions: [{ file: '.env.example', line: 7 }] },
      {
        name: 'SLACK_WEBHOOK_URL',
        definitions: [
          { file: '.env', line: 9 },
          { file: '.env.example', line: 9 },
        ],
      },
    ]);
    expect(report.mismatch).toEqual([
      { name: 'LEGACY_TOKEN', presentIn: '.env', missingFrom: '.env.example', line: 7 },
      { name: 'OLD_FEATURE_FLAG', presentIn: '.env.example', missingFrom: '.env', line: 7 },
      { name: 'SENTRY_DSN', presentIn: '.env.example', missingFrom: '.env', line: 6 },
    ]);
    expect(report.summary).toEqual({ missing: 15, unused: 4, mismatch: 3, total: 22 });
    expect(report.mismatchSkipped).toBeNull();
    expect(report.warnings).toEqual([]);
  });

  it('--env adds definitions from extra files', () => {
    const report = envcheckJson(['--env', 'config/extra.env']);
    expect(report.stats.envFiles).toEqual(['.env', '.env.example', '.env.local', 'config/extra.env']);
    expect(names(report.missing)).not.toContain('SMTP_HOST');
    expect(names(report.missing)).not.toContain('SMTP_PASSWORD');
    expect(names(report.missing)).not.toContain('MAILER_FROM');
    expect(names(report.missing)).toContain('MAILER_REPLY_TO');
  });

  it('--env is repeatable and ignores duplicates of default files', () => {
    const report = envcheckJson(['--env', 'config/extra.env', '--env', '.env']);
    expect(report.stats.envFiles).toEqual(['.env', '.env.example', '.env.local', 'config/extra.env']);
  });

  it('--ci reads workflow env: keys and secrets references', () => {
    const report = envcheckJson(['--ci']);
    expect(report.stats.workflows).toEqual(['.github/workflows/deploy.yml']);

    const missing = names(report.missing);
    expect(missing).not.toContain('DEPLOY_REGION'); // workflow-level env
    expect(missing).not.toContain('GO_SERVICE_TOKEN'); // job-level env
    expect(missing).not.toContain('GITHUB_TOKEN'); // built in
    expect(missing).not.toContain('NOT_A_DEFINITION'); // inside a run: script comment

    const deployKey = report.missing.find((m) => m.name === 'DEPLOY_KEY');
    expect(deployKey?.references).toEqual([
      { file: '.github/workflows/deploy.yml', line: 15, column: 13, syntax: 'secrets' },
      { file: '.github/workflows/deploy.yml', line: 20, column: 36, syntax: 'secrets' },
    ]);
    expect(report.missing.find((m) => m.name === 'SERVICE_TOKEN')?.references[0]?.line).toBe(11);

    // Used only by CI, so no longer unused.
    expect(names(report.unused)).not.toContain('SLACK_WEBHOOK_URL');
  });

  it('--ignore drops matching names from every section and is repeatable', () => {
    const report = envcheckJson(['--ignore', 'NODE_*', '--ignore', 'VITE_*', '--ignore', 'LEGACY_TOKEN']);
    const missing = names(report.missing);
    expect(missing).not.toContain('NODE_OPTIONS');
    expect(missing).not.toContain('VITE_ANALYTICS_ID');
    expect(missing).not.toContain('VITE_FEATURE_FLAG');
    expect(names(report.unused)).not.toContain('LEGACY_TOKEN');
    expect(names(report.mismatch)).not.toContain('LEGACY_TOKEN');
    expect(report.summary.total).toBe(22 - 3 - 2);
  });

  it('--strict exits 1 when there are findings', () => {
    const { code, stdout } = envcheck(['--strict']);
    expect(code).toBe(1);
    expect(stdout).toContain('✖ 22 findings');
    expect(envcheck(['--strict', '--json']).code).toBe(1);
  });

  it('combines all flags', () => {
    const { code, stdout } = envcheck(['--ci', '--env', 'config/extra.env', '--ignore', 'NODE_*']);
    expect(code).toBe(0);
    expect(stdout).toContain('workflows: .github/workflows/deploy.yml');
    expect(stdout).toContain('✖ 17 findings (11 missing · 3 unused · 3 mismatch)');
  });
});

describe('envcheck usage and edge cases', () => {
  it('exits 2 with a clear message for a missing --env file', () => {
    const { code, stderr, stdout } = envcheck(['--env', 'nope.env']);
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('envcheck: error: env file not found: nope.env');
  });

  it('exits 2 for unknown options and positional arguments', () => {
    expect(envcheck(['--bogus']).code).toBe(2);
    expect(envcheck(['some-dir']).code).toBe(2);
  });

  it('prints help and version with exit 0', () => {
    const help = envcheck(['--help']);
    expect(help.code).toBe(0);
    for (const flag of ['--json', '--strict', '--ignore <pattern>', '--env <path>', '--ci', '--no-color']) {
      expect(help.stdout).toContain(flag);
    }
    const version = envcheck(['--version']);
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('reports a clean project and passes --strict', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'envcheck-clean-'));
    try {
      await writeFile(join(dir, '.env'), 'API_URL=https://example.com\n');
      await writeFile(join(dir, '.env.example'), 'API_URL=\n');
      await writeFile(join(dir, 'index.ts'), 'fetch(process.env.API_URL!);\n');
      const { code, stdout } = envcheck(['--strict'], dir);
      expect(code).toBe(0);
      expect(stdout).toContain('✔ No issues found');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('explains a skipped mismatch check and surfaces env parse warnings on stderr', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'envcheck-warn-'));
    try {
      await writeFile(join(dir, '.env'), 'GOOD=1\nthis line is junk\n');
      const { code, stdout, stderr } = envcheck([], dir);
      expect(code).toBe(0);
      expect(stdout).toContain('skipped: .env.example not found');
      expect(stderr).toContain('warning .env:2: ignored a line that is not KEY=value');

      const json = envcheckJson([], dir);
      expect(json.mismatchSkipped).toBe('.env.example not found');
      expect(json.warnings).toEqual([{ file: '.env', line: 2, message: 'ignored a line that is not KEY=value' }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('warns when --ci is passed without a workflows directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'envcheck-noci-'));
    try {
      const json = envcheckJson(['--ci'], dir);
      expect(json.warnings[0]?.message).toMatch(/no workflows directory/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
