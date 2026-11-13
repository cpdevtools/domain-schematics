import { chain, type Rule, type Tree } from '@angular-devkit/schematics';
import { addExport, ensureDependency, generateFiles, names } from '../../kit';
import { domainContext, ensureEntryPoint, format, templates, templateVars } from '../common';
import { workspaceVersions } from '../versions';

export interface StoreOptions {
  name: string;
  domain: string;
  kind?: 'global' | 'component';
  path?: string;
}

export function store(options: StoreOptions): Rule {
  return chain([
    async (tree: Tree) => {
      const ctx = domainContext(tree, options.domain);
      const layerDir = await ensureEntryPoint(tree, ctx, 'data');
      const n = names(options.name);
      const noun = (options.path ?? n.fileName).replace(/^\/+|\/+$/g, '');
      const dir = `${layerDir}/${noun}`;
      generateFiles(
        tree,
        templates(__dirname),
        dir,
        templateVars(ctx, options.name, { global: (options.kind ?? 'global') === 'global' }),
      );
      addExport(tree, `${layerDir}/index.ts`, `./${noun}/${n.fileName}.store`);
      ensureDependency(
        tree,
        ctx.dir,
        '@ngrx/signals',
        workspaceVersions(tree, ctx.ws)('@ngrx/signals'),
        ['devDependencies', 'peerDependencies'],
      );
    },
    format(),
  ]);
}

export default store;
