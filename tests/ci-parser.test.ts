import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseWorkflow, scanWorkflows } from '../src/ci-parser.js';

const FILE = '.github/workflows/test.yml';
const defs = (yaml: string) => parseWorkflow(yaml, FILE).definitions.map((d) => [d.name, d.line]);
const refs = (yaml: string) => parseWorkflow(yaml, FILE).references.map((r) => [r.name, r.line, r.column]);

describe('parseWorkflow: env definitions', () => {
  it('collects env keys at workflow, job and step level', () => {
    const yaml = [
      'name: CI', //                                  1
      'env:', //                                      2
      '  NODE_VERSION: 20', //                        3
      '  "QUOTED_KEY": x', //                         4
      'jobs:', //                                     5
      '  build:', //                                  6
      '    runs-on: ubuntu-latest', //                7
      '    env:', //                                  8
      '      JOB_LEVEL: yes', //                      9
      '    steps:', //                               10
      '      - name: Deploy', //                     11
      '        env:', //                             12
      '          STEP_LEVEL: 1', //                  13
      '      - env:', //                             14
      '          DASH_ENV: 1', //                    15
      '        run: echo hi', //                     16
    ].join('\n');
    expect(defs(yaml)).toEqual([
      ['NODE_VERSION', 3],
      ['QUOTED_KEY', 4],
      ['JOB_LEVEL', 9],
      ['STEP_LEVEL', 13],
      ['DASH_ENV', 15],
    ]);
  });

  it('stops the env mapping at the first dedent and ignores deeper lines', () => {
    const yaml = [
      'env:',
      '  A: 1',
      '  MULTI: >',
      '    NOT_A_KEY: folded text',
      '  B: 2',
      'jobs:',
      '  C: not-env',
    ].join('\n');
    expect(defs(yaml)).toEqual([
      ['A', 2],
      ['MULTI', 3],
      ['B', 5],
    ]);
  });

  it('reads single-line flow mappings', () => {
    const yaml = 'env: { FLOW_A: 1, "FLOW_B": ${{ secrets.S }}, FLOW_C: x }';
    expect(defs(yaml)).toEqual([
      ['FLOW_A', 1],
      ['FLOW_B', 1],
      ['FLOW_C', 1],
    ]);
  });

  it('ignores env-looking lines inside run: block scalars and comments', () => {
    const yaml = [
      'jobs:',
      '  t:',
      '    steps:',
      '      - run: |',
      '          env:',
      '            FAKE: 1',
      '      # env:',
      '      #   COMMENTED: 1',
      '      - name: after',
      '        env:',
      '          REAL: 1 # trailing comment',
      '        environment: production',
    ].join('\n');
    expect(defs(yaml)).toEqual([['REAL', 11]]);
  });

  it('ignores an empty or expression-valued env', () => {
    expect(defs('env:\njobs: {}')).toEqual([]);
    expect(defs('env: ${{ fromJSON(needs.x.outputs.env) }}')).toEqual([]);
  });
});

describe('parseWorkflow: secret references', () => {
  it('finds secrets in expressions with 1-based columns', () => {
    const yaml = [
      'env:',
      '  TOKEN: ${{ secrets.DEPLOY_TOKEN }}',
      '  BRACKET: ${{ secrets["BRACKET_SECRET"] }}',
      "  BOTH: ${{ secrets.ONE }}-${{ secrets['TWO'] }}",
    ].join('\n');
    expect(refs(yaml)).toEqual([
      ['DEPLOY_TOKEN', 2, 14],
      ['BRACKET_SECRET', 3, 16],
      ['ONE', 4, 13],
      ['TWO', 4, 32],
    ]);
  });

  it('finds secrets in if: conditions without ${{ }}', () => {
    expect(refs("    if: secrets.OPTIONAL_KEY != ''")).toEqual([['OPTIONAL_KEY', 1, 9]]);
    expect(refs('    - if: ${{ secrets.WRAPPED }}')).toEqual([['WRAPPED', 1, 15]]);
  });

  it('finds secrets inside run scripts but not bare words', () => {
    const yaml = [
      '      - run: |',
      '          curl -H "Authorization: ${{ secrets.API_TOKEN }}" x',
      '          cat secrets.txt',
    ].join('\n');
    expect(refs(yaml)).toEqual([['API_TOKEN', 2, 39]]);
  });

  it('skips GITHUB_TOKEN, comments and look-alikes', () => {
    const yaml = [
      'env:',
      '  GH: ${{ secrets.GITHUB_TOKEN }}',
      '  # X: ${{ secrets.COMMENTED }}',
      '  Y: ${{ needs.build.outputs.secrets.NOT_A_SECRET }}',
    ].join('\n');
    expect(refs(yaml)).toEqual([]);
  });
});

describe('scanWorkflows', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'envcheck-ci-'));
    await mkdir(join(root, '.github/workflows/nested'), { recursive: true });
    await writeFile(join(root, '.github/workflows/b.yaml'), 'env:\n  FROM_B: 1\n');
    await writeFile(join(root, '.github/workflows/a.yml'), 'env:\n  S: ${{ secrets.FROM_A }}\n');
    await writeFile(join(root, '.github/workflows/readme.md'), 'env:\n  NOPE: 1\n');
    await writeFile(join(root, '.github/workflows/nested/c.yml'), 'env:\n  NESTED: 1\n');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('parses top-level .yml and .yaml files in name order', async () => {
    const result = await scanWorkflows(root);
    expect(result.files).toEqual(['.github/workflows/a.yml', '.github/workflows/b.yaml']);
    expect(result.definitions.map((d) => `${d.file}:${d.name}`)).toEqual([
      '.github/workflows/a.yml:S',
      '.github/workflows/b.yaml:FROM_B',
    ]);
    expect(result.references.map((r) => r.name)).toEqual(['FROM_A']);
    expect(result.warnings).toEqual([]);
  });

  it('warns when there is no workflows directory', async () => {
    const result = await scanWorkflows(join(root, '.github'));
    expect(result.files).toEqual([]);
    expect(result.warnings[0]?.message).toMatch(/no workflows directory/);
  });
});
