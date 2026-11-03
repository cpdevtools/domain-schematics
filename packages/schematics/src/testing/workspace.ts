import { HostTree, type Rule, type Tree } from '@angular-devkit/schematics';
import { SchematicTestRunner } from '@angular-devkit/schematics/testing';
import { parseJson } from '@cpdevtools/ts-dev-utilities/json';
import { join } from 'node:path';
import { firstValueFrom } from 'rxjs';
import { ngAdd } from '../schematics/ng-add';

const runner = new SchematicTestRunner(
  '@cpdevtools/schematics',
  join(__dirname, '../collection.json'),
);

/** Runs a rule against a tree, as the engine would. */
export async function run(rule: Rule, tree: Tree): Promise<Tree> {
  return firstValueFrom(runner.callRule(rule, tree));
}

export interface FakeWorkspaceOptions {
  /** Package name prefix of the fake workspace's packages. */
  scope?: string;
  prefix?: string;
  /** Run `ng add` on it (default true). */
  installed?: boolean;
}

/**
 * A pnpm workspace with one Angular app (`apps/web`), as `ng new` plus the workspace files leave
 * it, before any domain package exists.
 */
export async function fakeWorkspace(options: FakeWorkspaceOptions = {}): Promise<Tree> {
  const scope = options.scope ?? '@acme/';
  const prefix = options.prefix ?? 'acme';
  const tree = new HostTree();
  const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
  tree.create(
    'package.json',
    json({
      name: 'acme-workspace',
      version: '0.0.0-MAIN',
      private: true,
      scripts: { build: 'devutil run build', test: 'devutil run test' },
      devDependencies: {
        '@angular/cli': '^22.1.8',
        prettier: '^3.8.1',
        typescript: '~6.0.2',
      },
      license: 'MIT',
      type: 'module',
    }),
  );
  tree.create('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'libs/*'\n  - 'packages/*'\n");
  tree.create(
    'tsconfig.json',
    `{
  "compilerOptions": {
    "target": "ES2022",
    // comments survive edits
    "strict": true,
    "paths": {}
  },
  "exclude": ["node_modules", "dist", "packages"]
}
`,
  );
  tree.create(
    'apps/web/package.json',
    json({
      name: `${scope}web`,
      version: '0.0.0-MAIN',
      private: true,
      scripts: { start: 'ng serve', build: 'ng build', test: 'ng test' },
      dependencies: {
        '@angular/common': '^22.1.0',
        '@angular/core': '^22.1.0',
        '@angular/router': '^22.1.0',
        '@ngrx/signals': '^22.0.1',
        rxjs: '^7.8.0',
        tslib: '^2.3.0',
      },
      devDependencies: {
        '@angular/build': '^22.1.8',
        '@angular/cli': '^22.1.8',
        '@angular/compiler-cli': '^22.1.0',
        'angular-eslint': '^22.5.0',
        jsdom: '^28.0.0',
        typescript: '~6.0.2',
        'typescript-eslint': '^8.69.0',
        vitest: '^4.0.8',
      },
    }),
  );
  tree.create(
    'apps/web/angular.json',
    json({
      version: 1,
      cli: { packageManager: 'pnpm' },
      projects: {
        web: {
          projectType: 'application',
          root: '',
          sourceRoot: 'src',
          prefix,
          architect: {
            build: {
              builder: '@angular/build:application',
              options: { browser: 'src/main.ts', tsConfig: 'tsconfig.app.json' },
            },
            serve: {
              builder: '@angular/build:dev-server',
              options: { prebundle: { exclude: [] } },
            },
            test: { builder: '@angular/build:unit-test' },
          },
        },
      },
    }),
  );
  tree.create('apps/web/tsconfig.json', json({ extends: '../../tsconfig.json', files: [] }));
  tree.create(
    'apps/web/tsconfig.spec.json',
    json({ extends: './tsconfig.json', compilerOptions: { paths: {} } }),
  );
  tree.create(
    'apps/web/src/main.ts',
    "import { bootstrapApplication } from '@angular/platform-browser';\n",
  );
  tree.create(
    'apps/web/src/app/app.config.ts',
    `import { type ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes)],
};
`,
  );
  tree.create(
    'apps/web/src/app/app.routes.ts',
    "import type { Routes } from '@angular/router';\n\nexport const routes: Routes = [];\n",
  );
  tree.create('.prettierrc', json({ singleQuote: true, printWidth: 100 }));
  if (options.installed === false) return tree;
  return run(ngAdd({ scope, prefix, skipInstall: true }), tree);
}

/** The tree's files under a folder, sorted, without the leading slash. */
export function filesUnder(tree: Tree, dir: string): string[] {
  const files: string[] = [];
  tree.getDir(dir).visit((path) => files.push(path.replace(/^\//, '')));
  return files.sort();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readJsonFile<T = any>(tree: Tree, path: string): T {
  return parseJson(tree.readText(path)) as T;
}
