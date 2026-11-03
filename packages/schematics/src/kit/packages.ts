import type { Tree } from '@angular-devkit/schematics';
import { parseWorkspacePatterns } from '@cpdevtools/ts-dev-utilities/project';
import { readJsonIfExists } from './json';
import { ENTRY_POINTS, isEntryPoint, type EntryPoint } from './rules';
import { nameOfPackage, type DomainPackagesConfig } from './workspace';

/** A `package.json` as the schematics read it. */
export interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  exports?: Record<string, string | Record<string, string>>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

export type PackageKind = 'domain' | 'lib' | 'app' | 'other';

/** A workspace member package. */
export interface WorkspacePackage {
  readonly name: string;
  /** Its folder, relative to the workspace root, without a trailing slash. */
  readonly dir: string;
  readonly kind: PackageKind;
  /** For a domain or a library: its name under the workspace scope. */
  readonly shortName?: string;
  /** For a domain: the entry points it has, read from `exports`. */
  readonly entryPoints: readonly EntryPoint[];
  readonly packageJson: PackageJson;
}

/** The member packages, from `pnpm-workspace.yaml`'s globs (else every `package.json` outside `node_modules`). */
export function workspacePackages(tree: Tree, ws: DomainPackagesConfig): WorkspacePackage[] {
  const yaml = tree.exists('pnpm-workspace.yaml') ? tree.readText('pnpm-workspace.yaml') : '';
  const parsed = yaml ? parseWorkspacePatterns(yaml) : undefined;
  const manifests = parsed
    ? globManifests(tree, parsed.patterns, parsed.ignore)
    : allManifests(tree);
  const packages: WorkspacePackage[] = [];
  for (const manifest of manifests) {
    const packageJson = readJsonIfExists<PackageJson>(tree, manifest);
    if (!packageJson?.name) continue;
    const dir = manifest.slice(0, -'/package.json'.length);
    packages.push(describe(ws, dir, packageJson));
  }
  return packages.sort((a, b) => a.dir.localeCompare(b.dir));
}

function describe(
  ws: DomainPackagesConfig,
  dir: string,
  packageJson: PackageJson,
): WorkspacePackage {
  const name = packageJson.name!;
  const top = dir.split('/')[0];
  const shortName = nameOfPackage(ws, name);
  const kind: PackageKind =
    top === ws.packages ? 'domain' : top === ws.libs ? 'lib' : top === ws.apps ? 'app' : 'other';
  const entryPoints = Object.keys(packageJson.exports ?? {})
    .map((key) => key.replace(/^\.\//, ''))
    .filter(isEntryPoint)
    .sort((a, b) => ENTRY_POINTS.indexOf(a) - ENTRY_POINTS.indexOf(b));
  return {
    name,
    dir,
    kind,
    shortName:
      kind === 'domain' || kind === 'lib' ? (shortName ?? dir.split('/').pop()) : undefined,
    entryPoints,
    packageJson,
  };
}

/** The package.json paths a set of `<dir glob>/package.json` patterns match in the tree. */
function globManifests(tree: Tree, patterns: string[], ignore: string[]): string[] {
  const results = new Set<string>();
  for (const pattern of patterns) {
    const dirGlob = pattern.replace(/\/package\.json$/, '');
    for (const dir of expandDirGlob(tree, dirGlob)) {
      const manifest = `${dir}/package.json`;
      if (tree.exists(manifest)) results.add(manifest);
    }
  }
  for (const pattern of ignore) results.delete(pattern);
  return [...results];
}

/** Expands a directory glob whose segments are literal or `*` (`packages/*`, `libs/*`). */
function expandDirGlob(tree: Tree, glob: string): string[] {
  const segments = glob.split('/').filter((s) => s !== '' && s !== '.');
  let dirs = [''];
  for (const segment of segments) {
    const next: string[] = [];
    for (const dir of dirs) {
      if (segment === '*' || segment === '**') {
        for (const sub of tree.getDir(dir).subdirs) {
          if (sub === 'node_modules') continue;
          next.push(dir ? `${dir}/${sub}` : sub);
        }
      } else {
        next.push(dir ? `${dir}/${segment}` : segment);
      }
    }
    dirs = next;
  }
  return dirs;
}

function allManifests(tree: Tree): string[] {
  const manifests: string[] = [];
  tree.visit((path) => {
    if (
      path.endsWith('/package.json') &&
      path !== '/package.json' &&
      !path.includes('/node_modules/')
    ) {
      manifests.push(path.replace(/^\//, ''));
    }
  });
  return manifests;
}

/** The package a domain name belongs to, if it exists. */
export function domainPackage(
  packages: readonly WorkspacePackage[],
  domain: string,
): WorkspacePackage | undefined {
  return packages.find((p) => p.kind === 'domain' && p.shortName === domain);
}

/** The package a file path belongs to (the longest matching dir), if any. */
export function packageOfPath(
  packages: readonly WorkspacePackage[],
  path: string,
): WorkspacePackage | undefined {
  const clean = path.replace(/^\//, '');
  let best: WorkspacePackage | undefined;
  for (const pkg of packages) {
    if (clean === pkg.dir || clean.startsWith(pkg.dir + '/')) {
      if (!best || pkg.dir.length > best.dir.length) best = pkg;
    }
  }
  return best;
}

export interface Closure {
  /** The domains the package depends on, directly or through other domains, nearest first. */
  readonly domains: WorkspacePackage[];
  /** The other workspace packages those bring (libraries and the like). */
  readonly others: WorkspacePackage[];
}

/**
 * A package's workspace dependencies and theirs in turn. Specs compile a dependency's sources, so
 * they need the dependency's own dependencies too: that is what the spec `paths` and the dev
 * dependencies follow.
 */
export function domainClosure(
  packages: readonly WorkspacePackage[],
  root: WorkspacePackage,
): Closure {
  const byName = new Map(packages.map((p) => [p.name, p]));
  const seen = new Set<string>([root.name]);
  const queue = [root];
  const domains: WorkspacePackage[] = [];
  const others: WorkspacePackage[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const deps = {
      ...current.packageJson.dependencies,
      ...current.packageJson.peerDependencies,
    };
    for (const name of Object.keys(deps)) {
      const dep = byName.get(name);
      if (!dep || seen.has(name)) continue;
      seen.add(name);
      (dep.kind === 'domain' ? domains : others).push(dep);
      queue.push(dep);
    }
  }
  return { domains, others };
}
