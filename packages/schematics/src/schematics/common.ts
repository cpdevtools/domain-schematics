import {
  SchematicsException,
  type Rule,
  type SchematicContext,
  type Tree,
} from '@angular-devkit/schematics';
import { join } from 'node:path';
import {
  addExport,
  addPackageEntryPoint,
  canPrompt,
  confirm,
  domainDir,
  domainPackage,
  editSheriffConfig,
  ENTRY_POINTS,
  formatFiles,
  generateFiles,
  isEntryPoint,
  names,
  readJsonIfExists,
  updateJson,
  workspace,
  workspacePackages,
  type EntryPoint,
  type Names,
  type PackageJson,
  type Workspace,
  type WorkspacePackage,
} from '../kit';

/** What every schematic that works on a domain starts from. */
export interface DomainContext {
  readonly ws: Workspace;
  readonly packages: readonly WorkspacePackage[];
  readonly domain: string;
  readonly pkg: WorkspacePackage;
  readonly dir: string;
}

/** The workspace, its packages and the named domain; throws when the domain does not exist. */
export function domainContext(tree: Tree, domain: string): DomainContext {
  const ws = workspace(tree);
  const packages = workspacePackages(tree, ws);
  const pkg = domainPackage(packages, domain);
  if (!pkg) {
    throw new SchematicsException(
      `No domain "${domain}" in ${ws.packages}/. Create it with \`ng g domain ${domain}\`.`,
    );
  }
  return { ws, packages, domain, pkg, dir: pkg.dir };
}

/** The template folder of a schematic, beside its compiled `index.js`. */
export function templates(schematicDir: string, name = 'files'): string {
  return join(schematicDir, name);
}

/**
 * Makes sure a domain has an entry point: the folder with its `index.ts`, the `exports` entry, and
 * its line in Sheriff's `domains`. A missing layer is created only after asking; without a terminal
 * to ask on it refuses and names the command that adds the layer. Returns the folder.
 */
export async function ensureEntryPoint(
  tree: Tree,
  ctx: DomainContext,
  entryPoint: string,
): Promise<string> {
  if (!isEntryPoint(entryPoint)) {
    throw new SchematicsException(
      `"${entryPoint}" is not a layer. The layers are ${ENTRY_POINTS.join(', ')}.`,
    );
  }
  const dir = `${ctx.dir}/${entryPoint}`;
  const index = `${dir}/index.ts`;
  if (!tree.exists(index)) {
    const add =
      entryPoint === 'testing'
        ? `ng g testing ${ctx.domain}`
        : `ng g layer ${ctx.domain} ${entryPoint}`;
    if (!canPrompt()) {
      throw new SchematicsException(
        `The domain "${ctx.domain}" has no ${entryPoint} layer. Add it first: \`${add}\`.`,
      );
    }
    const yes = await confirm(`The domain "${ctx.domain}" has no ${entryPoint} layer. Create it?`);
    if (!yes)
      throw new SchematicsException(
        `Stopped: "${ctx.domain}" has no ${entryPoint} layer (\`${add}\` adds it).`,
      );
    createEntryPoint(tree, ctx, entryPoint);
  }
  return dir;
}

/** Adds an entry point without asking: the folder, the `exports` entry and the Sheriff line. */
export function createEntryPoint(tree: Tree, ctx: DomainContext, entryPoint: EntryPoint): string {
  const dir = `${ctx.dir}/${entryPoint}`;
  const index = `${dir}/index.ts`;
  if (!tree.exists(index)) tree.create(index, 'export {};\n');
  addPackageEntryPoint(tree, ctx.dir, entryPoint);
  editSheriffConfig(tree, ctx.ws, (c) =>
    c.addDomainEntryPoint(ctx.domain, entryPoint, ENTRY_POINTS),
  );
  return dir;
}

/** The entry points a domain has on disk (folders with an `index.ts`). */
export function entryPointsOf(tree: Tree, dir: string): EntryPoint[] {
  return ENTRY_POINTS.filter((e) => tree.exists(`${dir}/${e}/index.ts`));
}

/**
 * Gives a package `test` and `github.actions.test` scripts once it has specs: `ng test` fails when
 * it finds none, and the workspace runner skips a package without a `test` script.
 */
export function ensureTestScripts(tree: Tree, dir: string): void {
  updateJson<PackageJson>(tree, `${dir}/package.json`, (pkg) => {
    pkg.scripts ??= {};
    pkg.scripts.test ??= 'ng test --watch=false';
    pkg.scripts['github.actions.test'] ??= 'pnpm test';
  });
}

/** `feature/<path>/<name>` style sub-paths: the optional noun folder joined with the name. */
export function subPath(path: string | undefined, fileName: string): string {
  const clean = (path ?? '').replace(/^\/+|\/+$/g, '');
  return clean ? `${clean}/${fileName}` : fileName;
}

/** The variables every template gets. */
export function templateVars(
  ctx: DomainContext,
  name: string,
  extra: Record<string, unknown> = {},
) {
  const n: Names = names(name, ctx.ws.prefix);
  return {
    ...n,
    prefix: ctx.ws.prefix,
    scope: ctx.ws.scope,
    domain: ctx.domain,
    domainNames: names(ctx.domain),
    packageName: ctx.pkg.name,
    ...extra,
  };
}

/** Writes template files and adds an export for what they produced. */
export function generateAndExport(
  tree: Tree,
  templatesDir: string,
  target: string,
  vars: Record<string, unknown>,
  indexFile: string,
  exportSpecifier: string,
): void {
  generateFiles(tree, templatesDir, target, vars);
  addExport(tree, indexFile, exportSpecifier);
}

/** A rule that formats what the run changed. The last rule of every schematic. */
export function format(): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    await formatFiles(tree, context);
  };
}

/** The root `package.json`'s `license`, for generated manifests. */
export function rootLicense(tree: Tree): string {
  return readJsonIfExists<PackageJson>(tree, 'package.json')?.license?.toString() ?? 'MIT';
}

/** The same thing a domain's main `index.ts` holds, so every real import names its layer. */
export const MAIN_INDEX = `import pkg from './package.json';

/** This package's version: \`0.0.0-MAIN\` in development; the release pipeline writes the real one. */
export const VERSION: string = (pkg as { version: string }).version;
`;

export { domainDir };
