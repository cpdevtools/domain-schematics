import { chain, type Rule, type Tree } from '@angular-devkit/schematics';
import { addExport, generateFiles, names } from '../../kit';
import { domainContext, ensureEntryPoint, format, templates, templateVars } from '../common';

export interface SlotOptions {
  name: string;
  domain: string;
  path?: string;
  lazy?: boolean;
}

export function slot(options: SlotOptions): Rule {
  return chain([
    async (tree: Tree) => {
      const ctx = domainContext(tree, options.domain);
      const layerDir = await ensureEntryPoint(tree, ctx, 'ui');
      const n = names(options.name);
      const noun = (options.path ?? n.fileName).replace(/^\/+|\/+$/g, '');
      const dir = `${layerDir}/${noun}`;
      generateFiles(
        tree,
        templates(__dirname),
        dir,
        templateVars(ctx, options.name, { lazy: options.lazy ?? false }),
      );
      addExport(tree, `${layerDir}/index.ts`, `./${noun}/${n.fileName}.slot`);
    },
    format(),
  ]);
}

export default slot;
