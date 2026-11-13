import { chain, type Rule, type Tree } from '@angular-devkit/schematics';
import {
  addExport,
  editSheriffConfig,
  generateFiles,
  names,
  updateJson,
  type PackageJson,
} from '../../kit';
import { domainContext, ensureEntryPoint, format, templates, templateVars } from '../common';

export interface WorkerOptions {
  name: string;
  domain: string;
  path?: string;
}

const WORKER_GLOB = '**/*.worker.ts';
const WORKER_TYPECHECK = 'tsc --noEmit -p tsconfig.worker.json';

export function worker(options: WorkerOptions): Rule {
  return chain([
    async (tree: Tree) => {
      const ctx = domainContext(tree, options.domain);
      const layerDir = await ensureEntryPoint(tree, ctx, 'data');
      const n = names(options.name);
      const noun = (options.path ?? n.fileName).replace(/^\/+|\/+$/g, '');
      const dir = `${layerDir}/${noun}`;
      generateFiles(tree, templates(__dirname), dir, templateVars(ctx, options.name));
      addExport(tree, `${layerDir}/index.ts`, `./${noun}/${n.fileName}-worker`);

      // The DOM and worker globals conflict in one program: the workers get their own tsconfig.
      if (!tree.exists(`${ctx.dir}/tsconfig.worker.json`)) {
        generateFiles(tree, templates(__dirname, 'files-tsconfig'), ctx.dir, {});
      }
      updateJson<{ exclude?: string[] }>(tree, `${ctx.dir}/tsconfig.json`, (ts) => {
        ts.exclude ??= ['node_modules'];
        if (!ts.exclude.includes(WORKER_GLOB)) ts.exclude.push(WORKER_GLOB);
      });
      updateJson<PackageJson>(tree, `${ctx.dir}/package.json`, (pkg) => {
        pkg.scripts ??= {};
        const typecheck = pkg.scripts.typecheck ?? 'tsc --noEmit -p .';
        if (!typecheck.includes('tsconfig.worker.json'))
          pkg.scripts.typecheck = `${typecheck} && ${WORKER_TYPECHECK}`;
      });

      // `sheriff verify` does not follow `new Worker(new URL(...))`: the worker is an entry point.
      const entryName = `${ctx.domain}-${n.fileName}-worker`;
      editSheriffConfig(tree, ctx.ws, (c) =>
        c.setEntryPoint(entryName, `${dir}/${n.fileName}.worker.ts`),
      );
      updateJson<PackageJson>(tree, 'package.json', (root) => {
        const script = root.scripts?.['check.boundaries'];
        const m = script && /^sheriff verify(?: (\S+))?$/.exec(script);
        if (!m) return;
        const entries = (m[1] ?? '').split(',').filter(Boolean);
        if (!entries.includes(entryName))
          root.scripts!['check.boundaries'] = `sheriff verify ${[...entries, entryName].join(',')}`;
      });
    },
    format(),
  ]);
}

export default worker;
