import {
  chain,
  SchematicsException,
  type Rule,
  type SchematicContext,
  type Tree,
} from '@angular-devkit/schematics';
import { posix } from 'node:path';
import { addExport, cleanPath, isEntryPoint, isSourceFile } from '../../kit';
import { format } from '../common';
import { createDomain, list } from '../domain';
import { performMove, planFromOptions } from '../move';

export interface ExtractDomainOptions {
  name: string;
  from: string;
  layer?: string;
  layers?: string;
  deps?: string;
  shared?: boolean;
}

/** `domain` plus `move`: the folder's files land in one layer, exported from its barrel. */
export function extractDomain(options: ExtractDomainOptions): Rule {
  return chain([
    (tree: Tree, context: SchematicContext) => {
      const layer = options.layer ?? 'feature';
      if (!isEntryPoint(layer)) throw new SchematicsException(`"${layer}" is not a layer.`);
      const layers = new Set(list(options.layers));
      layers.add(layer);
      const from = cleanPath(options.from);
      const { dir } = createDomain(tree, { ...options, layers: [...layers] });
      const target = `${dir}/${layer}`;
      const plan = planFromOptions(tree, { from, to: target });
      const report = performMove(tree, plan);
      // What moved in becomes the layer's public surface, for the imports that reached into it.
      const barrel = `${target}/index.ts`;
      for (const to of Object.values(plan.files)) {
        if (!isSourceFile(to) || to.endsWith('.spec.ts') || to.endsWith('.worker.ts')) continue;
        const rel = posix.relative(target, to);
        if (rel === 'index.ts') continue;
        const folder = posix.dirname(rel);
        if (folder !== '.' && tree.exists(`${target}/${folder}/index.ts`)) {
          addExport(tree, barrel, `./${folder.split('/')[0]}`);
        } else {
          addExport(tree, barrel, `./${rel.replace(/\.(m|c)?ts$/, '')}`);
        }
      }
      context.logger.info(
        `Moved ${report.moved.length} file(s) into ${target}; rewrote ${report.rewrites.length} import(s).`,
      );
      for (const v of report.violations) context.logger.warn(v.message);
    },
    format(),
  ]);
}

export default extractDomain;
