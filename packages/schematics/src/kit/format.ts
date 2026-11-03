import type { SchematicContext, Tree } from '@angular-devkit/schematics';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const FORMATTED = /\.(ts|mts|cts|js|mjs|cjs|json|html|scss|css|md|yml|yaml)$/;

import type * as PrettierModule from 'prettier';

type Prettier = typeof PrettierModule;

/**
 * Runs the workspace's prettier (its own install and config) over the files this run created or
 * changed, and nothing else, so `pnpm fix` changes nothing afterwards. Without a prettier in the
 * workspace, logs and skips.
 */
export async function formatFiles(
  tree: Tree,
  context?: SchematicContext,
  cwd = process.cwd(),
): Promise<void> {
  const prettier = loadPrettier(cwd);
  if (!prettier) {
    context?.logger.warn(
      'prettier is not installed in the workspace: generated files are not formatted.',
    );
    return;
  }
  const paths = new Set<string>();
  for (const action of tree.actions) {
    if ((action.kind === 'c' || action.kind === 'o') && FORMATTED.test(action.path)) {
      paths.add(action.path);
    }
  }
  for (const path of paths) {
    if (!tree.exists(path)) continue;
    const absolute = resolve(cwd, path.replace(/^\//, ''));
    const info = await prettier.getFileInfo(absolute, {
      ignorePath: resolve(cwd, '.prettierignore'),
    });
    if (info.ignored || !info.inferredParser) continue;
    const config = (await prettier.resolveConfig(absolute, { editorconfig: true })) ?? {};
    const before = tree.readText(path);
    const after = await prettier.format(before, { ...config, filepath: absolute });
    if (after !== before) tree.overwrite(path, after);
  }
}

function loadPrettier(cwd: string): Prettier | undefined {
  const candidates = [resolve(cwd, 'package.json'), __filename];
  for (const from of candidates) {
    try {
      const req = createRequire(from);
      return req(req.resolve('prettier')) as Prettier;
    } catch {
      // try the next
    }
  }
  return undefined;
}
