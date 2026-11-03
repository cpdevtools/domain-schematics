import { chain, SchematicsException, type Rule, type Tree } from '@angular-devkit/schematics';
import {
  addRootTsconfigPaths,
  generateFiles,
  libDir,
  names,
  packageName,
  wireApps,
  workspace,
  workspacePackages,
} from '../../kit';
import { format, rootLicense, templates } from '../common';
import { assertKebab } from '../domain';
import { workspaceVersions } from '../versions';

export interface LibraryOptions {
  name: string;
  description?: string;
}

export function library(options: LibraryOptions): Rule {
  return chain([
    (tree: Tree) => {
      const ws = workspace(tree);
      const name = names(options.name).fileName;
      assertKebab(name, 'A library name');
      const pkgName = packageName(ws, name);
      if (workspacePackages(tree, ws).some((p) => p.name === pkgName)) {
        throw new SchematicsException(`The package "${pkgName}" already exists.`);
      }
      const dir = libDir(ws, name);
      generateFiles(tree, templates(__dirname), dir, {
        ...names(name),
        packageName: pkgName,
        description: options.description ?? `${names(name).className}: `,
        license: rootLicense(tree),
        v: workspaceVersions(tree, ws),
        up: '../'.repeat(dir.split('/').length),
      });
      addRootTsconfigPaths(tree, pkgName, dir, { wildcard: false });
      wireApps(tree, ws, { name: pkgName, dir, kind: 'lib' });
    },
    format(),
  ]);
}

export default library;
