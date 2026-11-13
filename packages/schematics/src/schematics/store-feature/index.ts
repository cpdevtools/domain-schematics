import { chain, type Rule, type Tree } from '@angular-devkit/schematics';
import { addExport, ensureDependency, generateFiles, names } from '../../kit';
import { domainContext, ensureEntryPoint, format, templates, templateVars } from '../common';
import { workspaceVersions } from '../versions';

export interface StoreFeatureOptions {
  name: string;
  domain: string;
  path?: string;
}

export function storeFeature(options: StoreFeatureOptions): Rule {
  return chain([
    async (tree: Tree) => {
      const ctx = domainContext(tree, options.domain);
      const layerDir = await ensureEntryPoint(tree, ctx, 'data');
      const n = names(options.name);
      const noun = (options.path ?? n.fileName).replace(/^\/+|\/+$/g, '');
      const dir = `${layerDir}/${noun}`;
      generateFiles(tree, templates(__dirname), dir, templateVars(ctx, options.name));
      addExport(tree, `${layerDir}/index.ts`, `./${noun}/with-${n.fileName}`);
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

export default storeFeature;
