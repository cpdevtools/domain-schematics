import type { Tree } from '@angular-devkit/schematics';
import { appDirs, readJsonIfExists, type DomainPackagesConfig, type PackageJson } from '../../kit';

/** The versions a generated package pins when the workspace does not already have the dependency. */
export const DEFAULT_VERSIONS: Readonly<Record<string, string>> = {
  '@angular/build': '^22.1.0',
  '@angular/cli': '^22.1.0',
  '@angular/common': '^22.1.0',
  '@angular/compiler': '^22.1.0',
  '@angular/compiler-cli': '^22.1.0',
  '@angular/core': '^22.1.0',
  '@angular/platform-browser': '^22.1.0',
  '@angular/router': '^22.1.0',
  '@eslint/js': '^9.18.0',
  '@ngrx/signals': '^22.0.0',
  '@softarc/eslint-plugin-sheriff': '^0.20.0',
  '@softarc/sheriff-core': '^0.20.0',
  'angular-eslint': '^22.0.0',
  eslint: '^9.18.0',
  jsdom: '^27.0.0',
  'ng-packagr': '^22.1.0',
  prettier: '^3.4.2',
  rxjs: '^7.8.0',
  tslib: '^2.3.0',
  typescript: '~6.0.2',
  'typescript-eslint': '^8.20.0',
  vitest: '^4.0.0',
};

/**
 * The version of each dependency the workspace already uses: the root `package.json` first, then
 * each app, then the defaults. New packages pin what the workspace has, so syncpack stays quiet.
 */
export function workspaceVersions(tree: Tree, ws: DomainPackagesConfig): (name: string) => string {
  const found = new Map<string, string>();
  const collect = (manifest: PackageJson | undefined) => {
    for (const deps of [
      manifest?.dependencies,
      manifest?.devDependencies,
      manifest?.peerDependencies,
    ]) {
      for (const [name, version] of Object.entries(deps ?? {})) {
        if (!found.has(name) && !version.startsWith('workspace:')) found.set(name, version);
      }
    }
  };
  collect(readJsonIfExists<PackageJson>(tree, 'package.json'));
  for (const app of appDirs(tree, ws))
    collect(readJsonIfExists<PackageJson>(tree, `${app}/package.json`));
  return (name) => found.get(name) ?? DEFAULT_VERSIONS[name] ?? 'latest';
}
