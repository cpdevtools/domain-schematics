import { chain, SchematicsException, type Rule, type Tree } from '@angular-devkit/schematics';
import {
  addArrayElement,
  addExport,
  addNamedImport,
  editSheriffConfig,
  editTs,
  ensureDependency,
  entryPoint,
  exportedArray,
  firstExportedArray,
  generateFiles,
  names,
  returnedArray,
} from '../../kit';
import {
  domainContext,
  ensureEntryPoint,
  ensureTestScripts,
  format,
  subPath,
  templates,
  templateVars,
} from '../common';
import { createFeatureset } from '../featureset';
import { workspaceVersions } from '../versions';

export interface FeatureComponentOptions {
  name: string;
  domain: string;
  path?: string;
  routed?: boolean;
  route?: string;
  slot?: string;
  slotDomain?: string;
  store?: boolean;
}

export function featureComponent(options: FeatureComponentOptions): Rule {
  return chain([
    async (tree: Tree) => {
      const ctx = domainContext(tree, options.domain);
      const layerDir = await ensureEntryPoint(tree, ctx, 'feature');
      const n = names(options.name, ctx.ws.prefix);
      const sub = subPath(options.path, n.fileName);
      const dir = `${layerDir}/${sub}`;
      const vars = templateVars(ctx, options.name, { store: options.store ?? false });
      generateFiles(tree, templates(__dirname), dir, vars);
      if (options.store) {
        generateFiles(tree, templates(__dirname, 'files-store'), dir, vars);
        ensureDependency(
          tree,
          ctx.dir,
          '@ngrx/signals',
          workspaceVersions(tree, ctx.ws)('@ngrx/signals'),
          ['devDependencies', 'peerDependencies'],
        );
      }
      ensureTestScripts(tree, ctx.dir);

      const ownModule = Boolean(options.routed || options.slot);
      if (ownModule) {
        tree.create(`${dir}/index.ts`, `export * from './${n.fileName}';\n`);
        editSheriffConfig(tree, ctx.ws, (c) => c.addFeatureModule(ctx.domain, sub));
        addExport(tree, `${layerDir}/index.ts`, `./${sub}`);
      } else {
        addExport(tree, `${layerDir}/index.ts`, `./${sub}/${n.fileName}`);
      }

      if (options.routed) {
        const { routes } = await createFeatureset(tree, ctx);
        const route = options.route ?? n.fileName.replace(/-page$/, '');
        const added = editTs(tree, routes, (file) => {
          const array =
            exportedArray(file, `${names(ctx.domain).constantName}_ROUTES`) ??
            firstExportedArray(file);
          if (!array)
            throw new SchematicsException(`${routes}: no exported routes array to add to.`);
          addArrayElement(
            array,
            `{ path: '${route}', loadComponent: () => import('../feature/${sub}').then((m) => m.${n.className}) }`,
          );
        });
        if (!added)
          throw new SchematicsException(`${routes}: the route '${route}' is already there.`);
      }

      if (options.slot) {
        const { provide } = await createFeatureset(tree, ctx);
        const fn = `provide${names(ctx.domain).className}Feature`;
        const slotSpecifier =
          options.slotDomain && options.slotDomain !== ctx.domain
            ? entryPoint(ctx.ws, options.slotDomain, 'ui')
            : '../ui';
        editTs(tree, provide, (file) => {
          const array = returnedArray(file, fn);
          if (!array)
            throw new SchematicsException(`${provide}: ${fn}() does not return an array literal.`);
          if (addArrayElement(array, `${options.slot}(${n.className})`)) {
            addNamedImport(file, `../feature/${sub}`, [n.className]);
            addNamedImport(file, slotSpecifier, [options.slot!]);
          }
        });
      }
    },
    format(),
  ]);
}

export default featureComponent;
