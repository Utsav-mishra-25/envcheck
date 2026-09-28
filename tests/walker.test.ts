import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { walk } from '../src/walker.js';

const EXTENSIONS = new Set(['.ts', '.py']);
let root: string;

async function write(rel: string, content = ''): Promise<void> {
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'envcheck-walker-'));
  await write('.gitignore', 'ignored/\n*.gen.ts\n!keep.gen.ts\n');
  await write('src/a.ts');
  await write('src/b.py');
  await write('src/readme.md');
  await write('src/UPPER.TS');
  await write('src/drop.gen.ts');
  await write('src/keep.gen.ts');
  await write('ignored/x.ts');
  await write('pkg/.gitignore', 'local.ts\n');
  await write('pkg/local.ts');
  await write('pkg/kept.ts');
  await write('local.ts'); // pkg/.gitignore must not apply here
  for (const dir of ['node_modules/lib', 'dist', '.git/hooks', 'venv/lib', '.venv/lib', 'src/node_modules']) {
    await write(`${dir}/skip.ts`);
  }
  await symlink(join(root, 'src'), join(root, 'linked-src'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('walk', () => {
  it('lists matching files, honoring .gitignore and default skip dirs', async () => {
    const { files, warnings } = await walk(root, { extensions: EXTENSIONS });
    expect(files).toEqual([
      'local.ts',
      'pkg/kept.ts',
      'src/UPPER.TS',
      'src/a.ts',
      'src/b.py',
      'src/keep.gen.ts',
    ]);
    expect(warnings).toEqual([]);
  });

  it('can ignore .gitignore files when asked', async () => {
    const { files } = await walk(root, { extensions: EXTENSIONS, respectGitignore: false });
    expect(files).toContain('ignored/x.ts');
    expect(files).toContain('pkg/local.ts');
    expect(files).toContain('src/drop.gen.ts');
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
  });

  it('accepts a custom skip list', async () => {
    const { files } = await walk(root, { extensions: EXTENSIONS, skipDirs: new Set(['src']) });
    expect(files).toContain('dist/skip.ts');
    expect(files.some((f) => f.startsWith('src/'))).toBe(false);
  });

  it('reports unreadable roots as warnings instead of throwing', async () => {
    const { files, warnings } = await walk(join(root, 'does-not-exist'), { extensions: EXTENSIONS });
    expect(files).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toMatch(/cannot read directory/);
  });
});
