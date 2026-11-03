import { chain, type Rule, type SchematicContext, type Tree } from '@angular-devkit/schematics';
import {
  addArrayElement,
  addExport,
  addNamedImport,
  appDirs,
  editTs,
  entryPoint,
  generateFiles,
  names,
  SyntaxKind,
} from '../../kit';
import { domainContext, ensureEntryPoint, format, templates, type DomainContext } from '../common';

export interface FeaturesetOptions {
  domain: string;
  skipApps?: boolean;
}

/** `provide-<domain>-feature.ts` and `routes.ts` in `provide`, and the call in each app's config. */
export function featureset(options: FeaturesetOptions): Rule {
  return chain([
    (tree: Tree, context: SchematicContext) => {
      const ctx = domainContext(tree, options.domain);
      createFeatureset(tree, ctx);
      if (!options.skipApps) listInApps(tree, ctx, context);
    },
    format(),
  ]);
}

export default featureset;

/** Writes the featureset files if the domain has none yet. Returns the routes file. */
export function createFeatureset(
  tree: Tree,
  ctx: DomainContext,
): { routes: string; provide: string } {
  const dir = ensureEntryPoint(tree, ctx, 'provide');
  const n = names(ctx.domain);
  const provide = `${dir}/provide-${n.fileName}-feature.ts`;
  const routes = `${dir}/routes.ts`;
  if (!tree.exists(provide)) {
    generateFiles(tree, templates(__dirname), dir, { ...n });
    addExport(tree, `${dir}/index.ts`, `./provide-${n.fileName}-feature`);
    addExport(tree, `${dir}/index.ts`, './routes');
  } else if (!tree.exists(routes)) {
    tree.create(
      routes,
      `import type { Routes } from '@angular/router';\n\nexport const ${n.constantName}_ROUTES: Routes = [];\n`,
    );
    addExport(tree, `${dir}/index.ts`, './routes');
  }
  return { routes, provide };
}

/** Adds `provide<Domain>Feature()` to each app's `app.config.ts` providers, before `provideRouter`. */
function listInApps(tree: Tree, ctx: DomainContext, context: SchematicContext): void {
  const fn = `provide${names(ctx.domain).className}Feature`;
  for (const app of appDirs(tree, ctx.ws)) {
    const config = `${app}/src/app/app.config.ts`;
    if (!tree.exists(config)) continue;
    const changed = editTs(tree, config, (file) => {
      const providers = file
        .getDescendantsOfKind(SyntaxKind.PropertyAssignment)
        .find((p) => p.getName() === 'providers')
        ?.getInitializerIfKind(SyntaxKind.ArrayLiteralExpression);
      if (!providers) return;
      if (
        addArrayElement(providers, `${fn}()`, { before: (t) => t.startsWith('provideRouter(') })
      ) {
        addNamedImport(file, entryPoint(ctx.ws, ctx.domain, 'provide'), [fn]);
      }
    });
    if (!changed) context.logger.info(`${config}: add ${fn}() to the providers by hand.`);
  }
}
