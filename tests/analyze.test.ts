import { describe, expect, it } from 'vitest';
import { analyze, type AnalyzeInput, type LoadedEnvFile } from '../src/analyze.js';
import { createNameFilter, nameGlobToRegExp } from '../src/glob.js';
import type { Definition, Reference } from '../src/types.js';

function ref(name: string, file = 'src/a.ts', line = 1, column = 1): Reference {
  return { name, file, line, column, syntax: 'process.env' };
}

function envFile(file: string, keys: string[]): LoadedEnvFile {
  return { file, entries: keys.map((key, i) => ({ key, value: '', line: i + 1 })) };
}

function ciDef(name: string): Definition {
  return { name, file: '.github/workflows/ci.yml', line: 1, kind: 'ci' };
}

function run(partial: Partial<AnalyzeInput>) {
  return analyze({ references: [], envFiles: [], ciDefinitions: [], ignore: [], ...partial });
}

describe('nameGlobToRegExp / createNameFilter', () => {
  it('supports * and ? and anchors the match', () => {
    const filter = createNameFilter(['NODE_*', 'AWS_?EY', '*_DEBUG']);
    expect(filter('NODE_ENV')).toBe(true);
    expect(filter('NODE_')).toBe(true);
    expect(filter('MY_NODE_ENV')).toBe(false);
    expect(filter('AWS_KEY')).toBe(true);
    expect(filter('AWS_KKEY')).toBe(false);
    expect(filter('APP_DEBUG')).toBe(true);
    expect(filter('APP_DEBUGGER')).toBe(false);
  });

  it('treats regex metacharacters literally and is case-sensitive', () => {
    expect(nameGlobToRegExp('A.B').test('AxB')).toBe(false);
    expect(nameGlobToRegExp('A.B').test('A.B')).toBe(true);
    expect(nameGlobToRegExp('node_*').test('NODE_ENV')).toBe(false);
  });

  it('matches nothing with no patterns', () => {
    expect(createNameFilter([])('ANYTHING')).toBe(false);
  });
});

describe('analyze', () => {
  it('reports references missing from every env file, grouped and sorted', () => {
    const { missing } = run({
      references: [ref('ZED', 'b.ts', 3), ref('ALPHA', 'b.ts', 9), ref('ALPHA', 'a.ts', 2, 7), ref('DEFINED')],
      envFiles: [envFile('.env', ['DEFINED'])],
    });
    expect(missing.map((m) => m.name)).toEqual(['ALPHA', 'ZED']);
    expect(missing[0]?.references.map((r) => `${r.file}:${r.line}`)).toEqual(['a.ts:2', 'b.ts:9']);
  });

  it('counts a definition in any env file, including extra ones', () => {
    const { missing } = run({
      references: [ref('IN_LOCAL'), ref('IN_EXTRA')],
      envFiles: [envFile('.env.local', ['IN_LOCAL']), envFile('config/extra.env', ['IN_EXTRA'])],
    });
    expect(missing).toEqual([]);
  });

  it('reports env definitions that are never referenced, listing each file once', () => {
    const { unused } = run({
      references: [ref('USED')],
      envFiles: [
        { file: '.env', entries: [{ key: 'OLD', value: '', line: 4 }, { key: 'OLD', value: '', line: 9 }] },
        envFile('.env.example', ['USED', 'OLD']),
      ],
    });
    expect(unused).toEqual([
      {
        name: 'OLD',
        definitions: [
          { file: '.env', line: 4 },
          { file: '.env.example', line: 2 },
        ],
      },
    ]);
  });

  it('lets CI env definitions satisfy references without ever being unused', () => {
    const { missing, unused } = run({
      references: [ref('FROM_CI')],
      ciDefinitions: [ciDef('FROM_CI'), ciDef('CI_ONLY_TOOLING')],
    });
    expect(missing).toEqual([]);
    expect(unused).toEqual([]);
  });

  it('treats secret references like code references', () => {
    const secret: Reference = { ...ref('DEPLOY_KEY', '.github/workflows/ci.yml'), syntax: 'secrets' };
    const { missing, unused } = run({
      references: [secret],
      envFiles: [envFile('.env.example', ['USED_BY_CI_ONLY'])],
    });
    expect(missing.map((m) => m.name)).toEqual(['DEPLOY_KEY']);
    expect(unused.map((u) => u.name)).toEqual(['USED_BY_CI_ONLY']);
  });

  it('reports mismatches in both directions between .env and .env.example', () => {
    const { mismatch } = run({
      envFiles: [
        envFile('.env', ['SHARED', 'ONLY_ENV_B', 'ONLY_ENV_A']),
        envFile('.env.example', ['SHARED', 'ONLY_EXAMPLE']),
        envFile('.env.local', ['LOCAL_ONLY']),
      ],
    });
    expect(mismatch).toEqual([
      { name: 'ONLY_ENV_A', presentIn: '.env', missingFrom: '.env.example', line: 3 },
      { name: 'ONLY_ENV_B', presentIn: '.env', missingFrom: '.env.example', line: 2 },
      { name: 'ONLY_EXAMPLE', presentIn: '.env.example', missingFrom: '.env', line: 2 },
    ]);
  });

  it('skips mismatch when either file is absent', () => {
    expect(run({ envFiles: [envFile('.env', ['A'])] }).mismatch).toEqual([]);
    expect(run({ envFiles: [envFile('.env.example', ['A'])] }).mismatch).toEqual([]);
  });

  it('applies ignore globs to every section', () => {
    const findings = run({
      references: [ref('NODE_OPTIONS'), ref('KEEP_ME')],
      envFiles: [envFile('.env', ['NODE_ENV', 'OTHER']), envFile('.env.example', ['NODE_DEBUG'])],
      ignore: ['NODE_*'],
    });
    expect(findings.missing.map((m) => m.name)).toEqual(['KEEP_ME']);
    expect(findings.unused.map((u) => u.name)).toEqual(['OTHER']);
    expect(findings.mismatch.map((m) => m.name)).toEqual(['OTHER']);
  });

  it('returns empty findings for a clean project', () => {
    expect(
      run({
        references: [ref('A')],
        envFiles: [envFile('.env', ['A']), envFile('.env.example', ['A'])],
      }),
    ).toEqual({ missing: [], unused: [], mismatch: [] });
  });
});
