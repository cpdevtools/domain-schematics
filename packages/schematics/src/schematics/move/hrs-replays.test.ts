/**
 * The replays step of the heroes-replay-stats conversion (81 files moved from the app into
 * packages/replays, 20 more edited) replayed through `move`, and the imports compared with what
 * the hand conversion wrote. Runs only with HRS_DIR pointing at a clone of
 * https://github.com/myrddraall/heroes-replay-stats that has both commits.
 */
import { HostTree } from '@angular-devkit/schematics';
import { execFileSync } from 'node:child_process';
import { performMove } from './index';

const HRS = process.env.HRS_DIR;
const BEFORE = '12529b03909fd48e746543ad48e06f2b8a535b69';
const AFTER = '8c6238f31075713c15ebc51ec332b3c418386490';

const git = (...args: string[]) =>
  execFileSync('git', ['-C', HRS!, ...args], { encoding: 'utf-8', maxBuffer: 64 << 20 });
const show = (sha: string, path: string) => git('show', `${sha}:${path}`);

const SOURCE = /^(apps|packages|libs)\/.*\.(ts|html|scss|json)$/;
const ROOT_FILES = ['pnpm-workspace.yaml', 'tsconfig.json', 'sheriff.config.ts'];

function specifiers(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) found.add(m[1]);
  for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) found.add(m[1]);
  return [...found].sort();
}

describe.skipIf(!HRS)('heroes-replay-stats replays step', () => {
  it('rewrites the imports the way the hand conversion did', () => {
    const tree = new HostTree();
    for (const path of git('ls-tree', '-r', '--name-only', BEFORE).split('\n')) {
      if (SOURCE.test(path) && !path.includes('/node_modules/'))
        tree.create(path, show(BEFORE, path));
    }
    for (const path of ROOT_FILES) tree.create(path, show(BEFORE, path));
    const root = JSON.parse(show(BEFORE, 'package.json'));
    root.domainPackages = {
      scope: '@myrddraall/heroes-replay-stats-',
      prefix: 'hrs',
      apps: 'apps',
      packages: 'packages',
      libs: 'libs',
      sheriffConfig: 'sheriff.config.ts',
    };
    tree.create('package.json', JSON.stringify(root, null, 2));

    const files: Record<string, string> = {};
    const modified: string[] = [];
    const added: string[] = [];
    for (const line of git('diff', '-M', '--name-status', BEFORE, AFTER).split('\n')) {
      const [status, from, to] = line.split('\t');
      if (status?.startsWith('R')) files[from] = to;
      else if (status === 'M' && from.endsWith('.ts')) modified.push(from);
      else if (status === 'A') added.push(from);
    }
    // The hand conversion made each section its own sub-module first (`ng g feature-component
    // --routed` does the same): the barrels exist before the files move in.
    for (const path of added) {
      if (path.endsWith('/index.ts')) tree.create(path, show(AFTER, path));
    }
    expect(Object.keys(files).length).toBe(81);

    const started = Date.now();
    const report = performMove(tree, { files, symbols: [] });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    const same: string[] = [];
    const differ: { path: string; missing: string[]; extra: string[] }[] = [];
    const compare = (path: string) => {
      if (!path.endsWith('.ts') || !tree.exists(path)) return;
      const expected = specifiers(show(AFTER, path));
      const actual = specifiers(tree.readText(path));
      const missing = expected.filter((s) => !actual.includes(s));
      const extra = actual.filter((s) => !expected.includes(s));
      if (missing.length === 0 && extra.length === 0) same.push(path);
      else differ.push({ path, missing, extra });
    };
    for (const to of Object.values(files)) compare(to);
    for (const path of modified) compare(path);

    const total = same.length + differ.length;
    console.log(
      `replays step: ${report.moved.length} moved, ${report.rewrites.length} imports rewritten in ${seconds}s; ` +
        `${same.length}/${total} files have the hand conversion's imports; ${report.violations.length} boundary violations reported.`,
    );
    for (const d of differ)
      console.log(
        `  ${d.path}\n    missing: ${d.missing.join(', ') || '-'}\n    extra:   ${d.extra.join(', ') || '-'}`,
      );
    expect(same.length / total).toBeGreaterThan(0.9);
  });
});
