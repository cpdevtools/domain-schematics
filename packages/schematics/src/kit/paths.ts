import type { Tree } from '@angular-devkit/schematics';
import { readJsonIfExists, updateJson, upsertJson } from './json';
import {
  domainClosure,
  workspacePackages,
  type PackageJson,
  type WorkspacePackage,
} from './packages';
import { ENTRY_POINTS } from './rules';
import { packageName, type DomainPackagesConfig } from './workspace';

/**
 * Adds `"./<entry>": "./<entry>/index.ts"` to a package's `exports`, keeping the entries in layer
 * order after the main one.
 */
export function addPackageEntryPoint(tree: Tree, packageDir: string, entry: string): void {
  updateJson<PackageJson>(tree, `${packageDir}/package.json`, (pkg) => {
    const current = pkg.exports ?? { '.': './index.ts' };
    if (current[`./${entry}`]) return;
    const entries = Object.entries({ ...current, [`./${entry}`]: `./${entry}/index.ts` });
    entries.sort(([a], [b]) => rank(a) - rank(b));
    pkg.exports = Object.fromEntries(entries);
  });
}

function rank(key: string): number {
  if (key === '.') return -1;
  const i = (ENTRY_POINTS as readonly string[]).indexOf(key.replace(/^\.\//, ''));
  return i === -1 ? ENTRY_POINTS.length : i;
}

/**
 * Maps a package in the root `tsconfig.json`: `<name>` to `./<dir>/index.ts` and, for a domain,
 * `<name>/*` to `./<dir>/*`. Sheriff follows imports between packages only through these.
 */
export function addRootTsconfigPaths(
  tree: Tree,
  name: string,
  dir: string,
  options: { wildcard?: boolean; main?: string } = {},
): void {
  const main = options.main ?? 'index.ts';
  updateJson<{ compilerOptions?: { paths?: Record<string, string[]> } }>(
    tree,
    'tsconfig.json',
    (ts) => {
      ts.compilerOptions ??= {};
      const paths = (ts.compilerOptions.paths ??= {});
      paths[name] ??= [`./${dir}/${main}`];
      if (options.wildcard ?? true) paths[`${name}/*`] ??= [`./${dir}/*`];
    },
  );
}

/** Removes a package's entries from the root `tsconfig.json` `paths`. */
export function removeRootTsconfigPaths(tree: Tree, name: string): void {
  updateJson<{ compilerOptions?: { paths?: Record<string, string[]> } }>(
    tree,
    'tsconfig.json',
    (ts) => {
      const paths = ts.compilerOptions?.paths;
      if (!paths) return;
      delete paths[name];
      delete paths[`${name}/*`];
    },
  );
}

/**
 * Writes a domain package's `tsconfig.spec.json` `paths` and dev dependencies for its closure: the
 * domains it depends on, and theirs, map to their sources (`../<d>/*\/index.ts`); the other
 * workspace packages those need become dev dependencies, because a dependency compiled from source
 * imports them from this package's location.
 */
export function syncSpecClosure(tree: Tree, ws: DomainPackagesConfig, pkg: WorkspacePackage): void {
  const packages = workspacePackages(tree, ws);
  const self = packages.find((p) => p.dir === pkg.dir) ?? pkg;
  const closure = domainClosure(packages, self);
  const specPath = `${self.dir}/tsconfig.spec.json`;
  const depth = self.dir.split('/').length;
  const up = '../'.repeat(depth);
  const paths: Record<string, string[]> = {};
  for (const dep of closure.domains) {
    paths[`${dep.name}/*`] = [`${up}${dep.dir}/*/index.ts`];
  }
  for (const dep of closure.others) {
    const main = readJsonIfExists<PackageJson>(tree, `${dep.dir}/package.json`)?.exports?.['.'];
    const target = typeof main === 'string' ? main.replace(/^\.\//, '') : 'index.ts';
    paths[dep.name] = [`${up}${dep.dir}/${target}`];
  }
  upsertJson<{ extends?: string; compilerOptions?: Record<string, unknown> }>(
    tree,
    specPath,
    {
      extends: './tsconfig.json',
      compilerOptions: { rootDir: up.replace(/\/$/, '') || '.', paths: {} },
    },
    (spec) => {
      spec.compilerOptions ??= {};
      const existing = (spec.compilerOptions.paths ?? {}) as Record<string, string[]>;
      // Keep entries the schematics did not write (a hand-added mapping), replace the rest.
      const kept = Object.fromEntries(
        Object.entries(existing).filter(([key]) => !key.startsWith(ws.scope)),
      );
      spec.compilerOptions.paths = { ...kept, ...paths };
    },
  );
  if (closure.others.length > 0) {
    updateJson<PackageJson>(tree, `${self.dir}/package.json`, (p) => {
      p.devDependencies ??= {};
      for (const dep of closure.others) {
        if (!p.dependencies?.[dep.name]) p.devDependencies[dep.name] ??= 'workspace:*';
      }
    });
  }
}

/** The app folders (`apps/*` with a `package.json`). */
export function appDirs(tree: Tree, ws: DomainPackagesConfig): string[] {
  if (!tree.exists(`${ws.apps}`) && tree.getDir(ws.apps).subdirs.length === 0) return [];
  return tree
    .getDir(ws.apps)
    .subdirs.map((sub) => `${ws.apps}/${sub}`)
    .filter((dir) => tree.exists(`${dir}/package.json`));
}

/**
 * Wires a new workspace package into an app: the dependency, the spec tsconfig `paths` (so the test
 * build compiles it from source), and the dev server's `prebundle.exclude` in `angular.json` (so the
 * dev server compiles it from source too).
 */
export function wireApp(
  tree: Tree,
  ws: DomainPackagesConfig,
  appDir: string,
  pkg: { name: string; dir: string; kind: 'domain' | 'lib'; main?: string },
): void {
  updateJson<PackageJson>(tree, `${appDir}/package.json`, (p) => {
    p.dependencies ??= {};
    p.dependencies[pkg.name] ??= 'workspace:*';
  });
  const specPath = `${appDir}/tsconfig.spec.json`;
  if (tree.exists(specPath)) {
    const up = '../'.repeat(appDir.split('/').length);
    updateJson<{ compilerOptions?: { paths?: Record<string, string[]> } }>(
      tree,
      specPath,
      (spec) => {
        spec.compilerOptions ??= {};
        const paths = (spec.compilerOptions.paths ??= {});
        paths[pkg.name] ??= [`${up}${pkg.dir}/${pkg.main ?? 'index.ts'}`];
        if (pkg.kind === 'domain') paths[`${pkg.name}/*`] ??= [`${up}${pkg.dir}/*/index.ts`];
      },
    );
  }
  const angularPath = `${appDir}/angular.json`;
  if (tree.exists(angularPath)) {
    updateJson<{
      projects?: Record<
        string,
        { architect?: Record<string, { options?: Record<string, unknown> }> }
      >;
    }>(tree, angularPath, (angular) => {
      for (const project of Object.values(angular.projects ?? {})) {
        const serve = project.architect?.serve;
        if (!serve) continue;
        serve.options ??= {};
        const prebundle = (serve.options.prebundle ??= { exclude: [] }) as
          { exclude?: string[] } | boolean;
        if (typeof prebundle !== 'object') continue;
        prebundle.exclude ??= [];
        if (!prebundle.exclude.includes(pkg.name)) {
          prebundle.exclude = [...prebundle.exclude, pkg.name].sort();
        }
      }
    });
  }
}

/** `wireApp` for every app in the workspace. */
export function wireApps(
  tree: Tree,
  ws: DomainPackagesConfig,
  pkg: { name: string; dir: string; kind: 'domain' | 'lib'; main?: string },
): void {
  for (const appDir of appDirs(tree, ws)) wireApp(tree, ws, appDir, pkg);
}

/** Adds a workspace dependency to a package, as `workspace:*`. */
export function addWorkspaceDependency(tree: Tree, packageDir: string, name: string): void {
  updateJson<PackageJson>(tree, `${packageDir}/package.json`, (p) => {
    p.dependencies ??= {};
    p.dependencies[name] ??= 'workspace:*';
  });
}

/** The package name a domain has (`<scope><domain>`), as a convenience for the schematics. */
export function domainPackageName(ws: DomainPackagesConfig, domain: string): string {
  return packageName(ws, domain);
}

/**
 * Makes sure a package declares a dependency, in the given sections, with the workspace's version
 * of it (or `version`) when it is not declared anywhere yet.
 */
export function ensureDependency(
  tree: Tree,
  packageDir: string,
  name: string,
  version: string,
  sections: ('dependencies' | 'devDependencies' | 'peerDependencies')[] = ['dependencies'],
): void {
  updateJson<PackageJson>(tree, `${packageDir}/package.json`, (p) => {
    const declared =
      p.dependencies?.[name] ?? p.devDependencies?.[name] ?? p.peerDependencies?.[name] ?? version;
    for (const section of sections) {
      p[section] ??= {};
      p[section]![name] ??= declared;
    }
  });
}
