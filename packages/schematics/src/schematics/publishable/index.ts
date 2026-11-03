import {
  chain,
  SchematicsException,
  type Rule,
  type SchematicContext,
  type Tree,
} from '@angular-devkit/schematics';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  domainClosure,
  generateFiles,
  names,
  updateJson,
  workspace,
  workspacePackages,
  type PackageJson,
  type WorkspacePackage,
} from '../../kit';
import { entryPointsOf, format, templates } from '../common';

export interface PublishableOptions {
  name: string;
  registry?: string;
}

/**
 * Makes a domain or library publishable through git-flow's release pipeline: the ng-packagr files
 * (one per layer, so every layer is a secondary entry point), a `tsconfig.lib.json` against built
 * dependencies, the build and pack scripts, and the `ng-lib` (or `npm`) artifact entry.
 */
export function publishable(options: PublishableOptions): Rule {
  return chain([
    (tree: Tree, context: SchematicContext) => {
      const ws = workspace(tree);
      const packages = workspacePackages(tree, ws);
      const short = names(options.name).fileName;
      const pkg = packages.find(
        (p) => (p.kind === 'domain' || p.kind === 'lib') && p.shortName === short,
      );
      if (!pkg) throw new SchematicsException(`No domain or library "${options.name}".`);
      const registry = options.registry ?? firstNpmRegistry(tree);
      if (pkg.kind === 'domain') makeDomainPublishable(tree, pkg, packages, registry);
      else makeLibPublishable(tree, pkg, registry);
      updateJson<PackageJson>(tree, `${pkg.dir}/package.json`, (p) => {
        delete p.private;
      });
      context.logger.info(
        `${pkg.name} publishes to '${registry}' as ${pkg.kind === 'domain' ? 'an ng-lib' : 'an npm'} artifact. ` +
          `git-flow stamps the version into package.json before the build, so the built dist carries the release version.`,
      );
    },
    format(),
  ]);
}

export default publishable;

function makeDomainPublishable(
  tree: Tree,
  pkg: WorkspacePackage,
  packages: WorkspacePackage[],
  registry: string,
): void {
  const closure = domainClosure(packages, pkg);
  const up = '../'.repeat(pkg.dir.split('/').length);
  const paths: Record<string, string> = {};
  for (const dep of closure.domains) {
    paths[dep.name] = `${up}${dep.dir}/dist`;
    paths[`${dep.name}/*`] = `${up}${dep.dir}/dist/*`;
  }
  for (const dep of closure.others) paths[dep.name] = `${up}${dep.dir}/dist`;
  generateFiles(
    tree,
    templates(__dirname, 'files-domain'),
    pkg.dir,
    { up, paths },
    { overwrite: true },
  );
  for (const entryPoint of entryPointsOf(tree, pkg.dir)) {
    const file = `${pkg.dir}/${entryPoint}/ng-package.json`;
    if (!tree.exists(file))
      tree.create(file, '{\n  "lib": {\n    "entryFile": "index.ts"\n  }\n}\n');
  }
  updateJson<{
    projects?: Record<
      string,
      { architect?: Record<string, { options?: Record<string, unknown> }> }
    >;
  }>(tree, `${pkg.dir}/angular.json`, (angular) => {
    for (const project of Object.values(angular.projects ?? {})) {
      const build = project.architect?.build;
      if (build) (build.options ??= {}).tsConfig = 'tsconfig.lib.json';
    }
  });
  updateJson<PackageJson>(tree, `${pkg.dir}/package.json`, (p) => {
    p.scripts ??= {};
    p.scripts['github.actions.build'] ??= 'ng build';
    p.scripts['github.actions.pack'] ??= 'gitflow pack';
  });
  writeArtifacts(tree, pkg.dir, [
    {
      type: 'ng-lib',
      name: '${PACKAGE_NAME}',
      directory: '.',
      packDir: 'dist',
      registries: [registry],
    },
  ]);
}

function makeLibPublishable(tree: Tree, pkg: WorkspacePackage, registry: string): void {
  generateFiles(tree, templates(__dirname, 'files-lib'), pkg.dir, {}, { overwrite: true });
  updateJson<PackageJson>(tree, `${pkg.dir}/package.json`, (p) => {
    p.scripts ??= {};
    p.scripts['github.actions.build'] ??= 'tsc -p tsconfig.lib.json';
    p.scripts['github.actions.pack'] ??= 'gitflow pack';
    p.files ??= ['dist', 'index.ts'];
  });
  writeArtifacts(tree, pkg.dir, [
    { type: 'npm', name: '${PACKAGE_NAME}', path: '${TARBALL_PATH}', registries: [registry] },
  ]);
}

function writeArtifacts(tree: Tree, dir: string, artifacts: Record<string, unknown>[]): void {
  const path = `${dir}/release-artifacts.yml`;
  if (tree.exists(path)) {
    const existing = (parseYaml(tree.readText(path)) ?? {}) as {
      artifacts?: Record<string, unknown>[];
    };
    const current = existing.artifacts ?? [];
    for (const artifact of artifacts) {
      if (!current.some((a) => a.type === artifact.type && a.name === artifact.name))
        current.push(artifact);
    }
    tree.overwrite(path, stringifyYaml({ ...existing, artifacts: current }));
  } else {
    tree.create(path, stringifyYaml({ artifacts }));
  }
}

/** The first npm registry in `.publish/registries.yml`, else `github-npm`. */
function firstNpmRegistry(tree: Tree): string {
  if (!tree.exists('.publish/registries.yml')) return 'github-npm';
  const parsed = parseYaml(tree.readText('.publish/registries.yml')) as {
    registries?: Record<string, { type?: string }>;
  } | null;
  for (const [id, registry] of Object.entries(parsed?.registries ?? {}))
    if (registry?.type === 'npm') return id;
  return 'github-npm';
}
