import { chain, SchematicsException, type Rule, type Tree } from '@angular-devkit/schematics';
import {
  addRootTsconfigPaths,
  addWorkspaceDependency,
  assertUsesAllowed,
  domainDir,
  domainPackage,
  editSheriffConfig,
  ENTRY_POINTS,
  LAYERS,
  generateFiles,
  isEntryPoint,
  names,
  packageName,
  readSheriffConfig,
  syncSpecClosure,
  wireApps,
  workspace,
  workspacePackages,
  type EntryPoint,
} from '../../kit';
import { format, rootLicense, templates } from '../common';
import { workspaceVersions } from '../versions';

export interface DomainOptions {
  name: string;
  layers?: string | string[];
  deps?: string | string[];
  shared?: boolean;
  description?: string;
}

/** A comma-separated option, or an array of them (the CLI hands `--layers ui,model` over either way). */
export function list(value: string | string[] | undefined): string[] {
  const items = Array.isArray(value) ? value : [value ?? ''];
  return items
    .flatMap((item) => item.split(','))
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

export function assertKebab(name: string, what: string): void {
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
    throw new SchematicsException(
      `${what} "${name}" must be kebab-case: lowercase letters, digits and dashes.`,
    );
  }
}

export function domain(options: DomainOptions): Rule {
  return chain([
    (tree: Tree) => {
      createDomain(tree, options);
    },
    format(),
  ]);
}

export default domain;

/** Creates the domain package; the imperative part, for `extract-domain` to reuse. */
export function createDomain(
  tree: Tree,
  options: DomainOptions,
): { name: string; dir: string; packageName: string } {
  const ws = workspace(tree);
  const name = names(options.name).fileName;
  assertKebab(name, 'A domain name');
  const packages = workspacePackages(tree, ws);
  if (domainPackage(packages, name))
    throw new SchematicsException(`The domain "${name}" already exists.`);
  const dir = domainDir(ws, name);
  if (tree.getDir(dir).subfiles.length > 0)
    throw new SchematicsException(`${dir}/ already has files.`);

  const layers = list(options.layers);
  if (layers.length === 0) {
    throw new SchematicsException(
      `Name the layers "${name}" starts with: --layers ui,model (any of ${LAYERS.join(', ')}). A layer is added later with \`ng g layer ${name} <layer>\`.`,
    );
  }
  for (const layer of layers) {
    if (!isEntryPoint(layer))
      throw new SchematicsException(`"${layer}" is not a layer (${ENTRY_POINTS.join(', ')}).`);
  }
  const ordered = ENTRY_POINTS.filter((e) => layers.includes(e)) as EntryPoint[];

  const sheriff = readSheriffConfig(tree, ws);
  const deps = list(options.deps);
  for (const dep of deps) {
    if (!domainPackage(packages, dep)) throw new SchematicsException(`No domain "${dep}" to use.`);
    assertUsesAllowed(
      { shared: options.shared ? [...sheriff.shared, name] : sheriff.shared, uses: sheriff.uses },
      name,
      dep,
    );
  }

  const pkgName = packageName(ws, name);
  const up = '../'.repeat(dir.split('/').length);
  generateFiles(tree, templates(__dirname), dir, {
    ...names(name, ws.prefix),
    packageName: pkgName,
    description: options.description ?? `${names(name).className}: `,
    license: rootLicense(tree),
    v: workspaceVersions(tree, ws),
    layers: ordered,
    deps: deps.map((d) => packageName(ws, d)),
    prefix: ws.prefix,
    packages: ws.packages,
    up,
  });
  for (const layer of ordered) tree.create(`${dir}/${layer}/index.ts`, 'export {};\n');

  editSheriffConfig(tree, ws, (c) => {
    c.setDomain(name, ordered);
    if (options.shared) c.addShared(name);
    for (const dep of deps) c.addUses(name, dep);
  });
  addRootTsconfigPaths(tree, pkgName, dir);
  wireApps(tree, ws, { name: pkgName, dir, kind: 'domain' });
  for (const dep of deps) addWorkspaceDependency(tree, dir, packageName(ws, dep));
  const created = workspacePackages(tree, ws).find((p) => p.dir === dir)!;
  syncSpecClosure(tree, ws, created);
  return { name, dir, packageName: pkgName };
}
