import { chain, type Rule, type SchematicContext, type Tree } from '@angular-devkit/schematics';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks';
import {
  CONFIG_KEY,
  DEFAULT_CONFIG,
  appDirs,
  generateFiles,
  readJsonIfExists,
  readSheriffConfig,
  updateJson,
  upsertJson,
  workspacePackages,
  type DomainPackagesConfig,
  type PackageJson,
} from '../../kit';
import { format, templates } from '../common';
import { workspaceVersions } from '../versions';

export interface NgAddOptions {
  scope?: string;
  prefix?: string;
  apps?: string;
  packages?: string;
  libs?: string;
  skipInstall?: boolean;
}

/** The generators `ng-add` gives a root script, as `generate.<name>`. */
export const GENERATORS = [
  'domain',
  'library',
  'layer',
  'testing',
  'featureset',
  'feature-component',
  'ui-component',
  'store',
  'store-feature',
  'slot',
  'worker',
  'uses',
  'move',
  'extract-domain',
  'publishable',
];

export const COLLECTION = '@cpdevtools/schematics';

export function ngAdd(options: NgAddOptions): Rule {
  return chain([
    (tree: Tree, context: SchematicContext) => {
      const ws = resolveConfig(tree, options);
      writeConfig(tree, ws);
      registerCollection(tree);
      editorSettings(tree);
      rootScripts(tree);
      ensureRootPaths(tree);
      const added = addSheriff(tree, ws, context);
      if (added && !options.skipInstall) {
        context.addTask(new NodePackageInstallTask({ packageManager: 'pnpm' }));
      }
      context.logger.info(
        `Domain packages: scope "${ws.scope}", prefix "${ws.prefix}", ${ws.packages}/ for domains, ${ws.libs}/ for libraries. ` +
          `Change the "${CONFIG_KEY}" block in package.json if that is wrong.`,
      );
    },
    format(),
  ]);
}

export default ngAdd;

function resolveConfig(tree: Tree, options: NgAddOptions): DomainPackagesConfig {
  const root = readJsonIfExists<PackageJson>(tree, 'package.json') ?? {};
  const existing = (root[CONFIG_KEY] ?? {}) as Partial<DomainPackagesConfig>;
  const base: DomainPackagesConfig = {
    ...DEFAULT_CONFIG,
    ...existing,
    scope: existing.scope ?? '',
    prefix: existing.prefix ?? '',
    apps: options.apps ?? existing.apps ?? DEFAULT_CONFIG.apps,
    packages: options.packages ?? existing.packages ?? DEFAULT_CONFIG.packages,
    libs: options.libs ?? existing.libs ?? DEFAULT_CONFIG.libs,
  };
  const scope = options.scope ?? existing.scope ?? inferScope(tree, base, root);
  const prefix = options.prefix ?? existing.prefix ?? inferPrefix(tree, base);
  return { ...base, scope, prefix };
}

/** The longest prefix the domain and library package names share, ending at a `/` or `-`; else from the root name. */
function inferScope(tree: Tree, ws: DomainPackagesConfig, root: PackageJson): string {
  const names = workspacePackages(tree, { ...ws, scope: '\u0000' })
    .filter((p) => p.kind === 'domain' || p.kind === 'lib')
    .map((p) => p.name);
  if (names.length > 0) {
    let common = names[0];
    for (const name of names) {
      let i = 0;
      while (i < common.length && i < name.length && common[i] === name[i]) i++;
      common = common.slice(0, i);
    }
    const cut = Math.max(common.lastIndexOf('/'), common.lastIndexOf('-'));
    if (cut > 0) return common.slice(0, cut + 1);
  }
  const rootName = (root.name ?? 'app').replace(/-workspace$/, '');
  const scoped = /^(@[^/]+)\//.exec(rootName);
  return scoped ? `${scoped[1]}/` : `@${rootName}/`;
}

function inferPrefix(tree: Tree, ws: DomainPackagesConfig): string {
  for (const app of appDirs(tree, ws)) {
    const angular = readJsonIfExists<{ projects?: Record<string, { prefix?: string }> }>(
      tree,
      `${app}/angular.json`,
    );
    for (const project of Object.values(angular?.projects ?? {}))
      if (project.prefix) return project.prefix;
  }
  const rootAngular = readJsonIfExists<{ projects?: Record<string, { prefix?: string }> }>(
    tree,
    'angular.json',
  );
  for (const project of Object.values(rootAngular?.projects ?? {}))
    if (project.prefix) return project.prefix;
  return 'app';
}

function writeConfig(tree: Tree, ws: DomainPackagesConfig): void {
  updateJson<PackageJson>(tree, 'package.json', (root) => {
    root[CONFIG_KEY] = {
      scope: ws.scope,
      prefix: ws.prefix,
      apps: ws.apps,
      packages: ws.packages,
      libs: ws.libs,
      sheriffConfig: ws.sheriffConfig,
    };
  });
}

/** Registers the collection in the root `angular.json`, creating a minimal one so `ng g` runs at the root. */
function registerCollection(tree: Tree): void {
  upsertJson<{
    $schema?: string;
    version: number;
    cli?: Record<string, unknown>;
    projects?: Record<string, unknown>;
  }>(
    tree,
    'angular.json',
    {
      $schema: './node_modules/@angular/cli/lib/config/schema.json',
      version: 1,
      cli: { packageManager: 'pnpm', analytics: false },
      projects: {},
    },
    (angular) => {
      angular.cli ??= {};
      const collections = (angular.cli.schematicCollections as string[] | undefined) ?? [];
      if (!collections.includes(COLLECTION))
        angular.cli.schematicCollections = [COLLECTION, ...collections];
      angular.projects ??= {};
    },
  );
}

/** Auto-imports use entry points, and the workspace TypeScript (and its plugins) is the one loaded. */
function editorSettings(tree: Tree): void {
  upsertJson<Record<string, unknown>>(tree, '.vscode/settings.json', {}, (settings) => {
    settings['typescript.preferences.importModuleSpecifier'] ??= 'non-relative';
    settings['typescript.tsdk'] ??= 'node_modules/typescript/lib';
  });
}

function rootScripts(tree: Tree): void {
  updateJson<PackageJson>(tree, 'package.json', (root) => {
    root.scripts ??= {};
    for (const name of GENERATORS) root.scripts[`generate.${name}`] ??= `ng generate ${name}`;
  });
}

function ensureRootPaths(tree: Tree): void {
  if (!tree.exists('tsconfig.json')) {
    tree.create(
      'tsconfig.json',
      JSON.stringify(
        { compilerOptions: { paths: {} }, exclude: ['node_modules', 'dist'] },
        null,
        2,
      ) + '\n',
    );
    return;
  }
  updateJson<{ compilerOptions?: { paths?: Record<string, string[]> } }>(
    tree,
    'tsconfig.json',
    (ts) => {
      ts.compilerOptions ??= {};
      ts.compilerOptions.paths ??= {};
    },
  );
}

/** Sheriff: the config, the ESLint fragment, the dependencies and the `check.boundaries` script. */
function addSheriff(tree: Tree, ws: DomainPackagesConfig, context: SchematicContext): boolean {
  let addedDeps = false;
  if (!tree.exists(ws.sheriffConfig)) {
    const entryPoints: Record<string, string> = {};
    for (const app of appDirs(tree, ws)) {
      const main = `${app}/src/main.ts`;
      if (tree.exists(main)) entryPoints[app.split('/').pop()!] = main;
    }
    generateFiles(tree, templates(__dirname), '', {
      entryPoints,
      packages: ws.packages,
      libs: ws.libs,
    });
    if (Object.keys(entryPoints).length === 0) {
      context.logger.warn(
        `${ws.sheriffConfig}: no app entry points found; add them under entryPoints.`,
      );
    }
  } else if (!tree.exists('tools/eslint-sheriff.mjs')) {
    generateFiles(tree, templates(__dirname, 'files/tools'), 'tools', {});
  }
  const version = workspaceVersions(tree, ws);
  updateJson<PackageJson>(tree, 'package.json', (root) => {
    root.devDependencies ??= {};
    for (const dep of ['@softarc/sheriff-core', '@softarc/eslint-plugin-sheriff']) {
      if (!root.devDependencies[dep] && !root.dependencies?.[dep]) {
        root.devDependencies[dep] = version(dep);
        addedDeps = true;
      }
    }
    root.scripts ??= {};
    if (!root.scripts['check.boundaries']) {
      const entries = Object.keys(readSheriffConfig(tree, ws).entryPoints);
      root.scripts['check.boundaries'] =
        `sheriff verify${entries.length ? ' ' + entries.join(',') : ''}`;
    }
  });
  return addedDeps;
}
