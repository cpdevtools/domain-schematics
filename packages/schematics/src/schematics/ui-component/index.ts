import { chain, type Rule, type Tree } from '@angular-devkit/schematics';
import { addExport, generateFiles, names } from '../../kit';
import {
  domainContext,
  ensureEntryPoint,
  ensureTestScripts,
  format,
  subPath,
  templates,
  templateVars,
} from '../common';

export interface UiComponentOptions {
  name: string;
  domain: string;
  path?: string;
  presenter?: boolean;
}

export function uiComponent(options: UiComponentOptions): Rule {
  return chain([
    async (tree: Tree) => {
      const ctx = domainContext(tree, options.domain);
      const layerDir = await ensureEntryPoint(tree, ctx, 'ui');
      const n = names(options.name, ctx.ws.prefix);
      const sub = subPath(options.path, n.fileName);
      const dir = `${layerDir}/${sub}`;
      const vars = templateVars(ctx, options.name, { presenter: options.presenter ?? false });
      generateFiles(tree, templates(__dirname), dir, vars);
      if (options.presenter)
        generateFiles(tree, templates(__dirname, 'files-presenter'), dir, vars);
      addExport(tree, `${layerDir}/index.ts`, `./${sub}/${n.fileName}`);
      ensureTestScripts(tree, ctx.dir);
    },
    format(),
  ]);
}

export default uiComponent;
