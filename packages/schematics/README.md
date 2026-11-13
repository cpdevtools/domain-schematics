# @cpdevtools/schematics

Angular schematics that create and maintain **domain packages**: one pnpm package per domain, split
into the layers `provide`, `feature`, `ui`, `data` and `model`, with module boundaries enforced by
[Sheriff](https://github.com/softarc-consulting/sheriff). The package holds the collection
(`ng g domain cart`), the kit it is built on (`@cpdevtools/schematics/kit`) and the helpers a
workspace's `sheriff.config.ts` uses (`@cpdevtools/schematics/sheriff`).

## Install

```sh
pnpm add -D @cpdevtools/schematics
pnpm exec domain-schematics init          # --scope @scope/ --prefix app, inferred when omitted
pnpm install                              # Sheriff and its ESLint plugin
```

`init` runs the collection's `ng-add` at the workspace root. It is a separate command because
`ng generate` refuses to run outside an Angular workspace, and a pnpm workspace with per-app
`angular.json` files has none at the root: `init` writes a minimal one, registered under
`cli.schematicCollections`, and from then on `ng g <schematic>` runs at the root. In a workspace
that already has a root `angular.json`, `ng add @cpdevtools/schematics` does the same.

What `init` writes:

| Where                           | What                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `package.json` `domainPackages` | `scope` (what every package name starts with, `@scope/` or `@scope/product-`), `prefix`, the folders |
| `package.json` scripts          | `generate.<schematic>` for every generator, `check.boundaries` (`sheriff verify <entry points>`)     |
| `angular.json`                  | The root workspace file with the collection registered                                               |
| `sheriff.config.ts`             | The modules and rules of the structure, from `domains`, `featureModules`, `shared` and `uses`        |
| `tools/eslint-sheriff.mjs`      | Sheriff's rules as an ESLint fragment every package config spreads in                                |
| `.vscode/settings.json`         | Auto-imports use entry points; the workspace TypeScript is the one loaded                            |

The `ng` that runs at the root must be Angular CLI **22.2 or later**: 22.1 sorts positional options
by index and treats index 0 as unset, so `ng g feature-component <name> <domain>` hands the first
argument to `domain`. Add `@angular/cli` to the root `devDependencies` if a dependency hoists an
older one. On an older CLI, pass the options by name (`--name`, `--domain`).

The scope is inferred from the names the existing packages share (`@myrddraall/heroes-replay-stats-`
for a workspace whose packages are `…-common`, `…-shell`), else from the root package name. The
prefix comes from an app's `angular.json`. Every app and package `tsconfig.json` must extend the root
one, so Sheriff finds its config through the `extends` chain.

## The schematics

Every schematic adds what it creates to the layer's `index.ts`, refuses a placement the rules
forbid (a cycle in `uses`, a shared domain using a business one, a name that is not a layer), works
with `--dry-run`, and formats only the files it touched with the workspace's prettier.

| Schematic                                                | Creates or changes                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain <name> --layers <l,…> [--deps] [--shared]`       | A domain package with exactly the layers named (asked for interactively when omitted; refused without a terminal): `package.json` with an `exports` entry per layer, main `index.ts` with `VERSION`, tsconfig and spec tsconfig, `angular.json` (ng-packagr build and unit-test targets), ESLint config, the root `paths`, every app's dependency, spec `paths` and `prebundle.exclude`, Sheriff's `domains` (and `shared`, `uses`) |
| `library <name>`                                         | A simple library in `libs/<name>/`: `package.json`, `index.ts`, tsconfig, ESLint config, the root `paths`, the apps' wiring                                                                                                                                                                                                                                                                                                         |
| `layer <domain> <layer>`                                 | A layer in an existing domain: folder, `index.ts`, its `exports` entry and Sheriff line                                                                                                                                                                                                                                                                                                                                             |
| `testing <domain>`                                       | The domain's `testing` entry point for test doubles, which only `*.spec.ts` files may import                                                                                                                                                                                                                                                                                                                                        |
| `featureset <domain>`                                    | `provide-<domain>-feature.ts` and `routes.ts` in `provide`, and `provide<Domain>Feature()` listed in each app's `app.config.ts` before `provideRouter`                                                                                                                                                                                                                                                                              |
| `feature-component <name> <domain>`                      | A smart component in `feature/[<path>/]<name>/` with a spec; `--store` adds a component store; `--routed` makes it a sub-module with a lazy route in `routes.ts`; `--slot <provideX> [--slot-domain <d>]` makes it a sub-module registered in the featureset                                                                                                                                                                        |
| `ui-component <name> <domain>`                           | A presentational component in `ui/[<path>/]<name>/` with a spec; `--presenter` adds `<name>.presenter.ts`                                                                                                                                                                                                                                                                                                                           |
| `store <name> <domain>`                                  | A `signalStore` in `data/<noun>/<name>.store.ts`: `--kind global` (default, `providedIn: 'root'`) or `component`                                                                                                                                                                                                                                                                                                                    |
| `store-feature <name> <domain>`                          | `with-<name>.ts` in `data/<noun>/`                                                                                                                                                                                                                                                                                                                                                                                                  |
| `slot <name> <domain>`                                   | A multi-provider token and `provide<Domain><Name>()` in `ui/<noun>/<name>.slot.ts`, taking a component; `--lazy` takes a loader (`() => import(...)`)                                                                                                                                                                                                                                                                               |
| `worker <name> <domain>`                                 | `<name>.worker.ts` and `start<Name>Worker()` in `data/<noun>/`, `tsconfig.worker.json`, the worker glob excluded from the package tsconfig, the typecheck step, Sheriff's entry point and `check.boundaries`                                                                                                                                                                                                                        |
| `uses <domain> <uses>`                                   | Adds a domain to another's `uses` line after checking it makes no cycle; the dependency, and the spec `paths` of every domain whose closure grew                                                                                                                                                                                                                                                                                    |
| `move <from> <to> [--symbol <name>] [--manifest <json>]` | Moves files, a folder, or an exported symbol, and rewrites every import (below)                                                                                                                                                                                                                                                                                                                                                     |
| `extract-domain <name> <folder> [--layer]`               | `domain` plus `move`: an app folder lands in one layer, exported from its barrel                                                                                                                                                                                                                                                                                                                                                    |
| `publishable <name>`                                     | Makes a domain or library publishable through git-flow (below)                                                                                                                                                                                                                                                                                                                                                                      |

No layer is ever created silently. `domain` makes exactly the layers it is told; a generator that
needs a layer the domain does not have asks before adding it, and without a terminal to ask on it
refuses and names the command (`ng g layer cart data`). `extract-domain` creates the target layer
and whatever `--layers` names.

The first spec a package gets adds its `test` and `github.actions.test` scripts: `ng test` fails
when it finds no spec, and the workspace runner skips a package without a `test` script.

### `move`

`move` takes a file, a folder, or a symbol (`--from a.ts --to b.ts --symbol Name`), or a manifest
for many at once:

```json
{
  "files": { "apps/web/src/app/pages/replay": "packages/replays/feature/replay-page" },
  "symbols": [
    {
      "name": "ReplaySummary",
      "from": "packages/replays/data/replay.service.ts",
      "to": "packages/replays/model/replay-summary.ts"
    }
  ]
}
```

It loads the workspace's sources into an in-memory ts-morph project and, after the moves, rewrites
imports to the specifier Sheriff expects: a relative file path within one module, the module's
folder (its barrel) between modules of one package, and `<scope><package>/<layer>` between
packages. Each named import is resolved to the file that declares it, so one import whose names now
live in two layers becomes two, each name keeping its `type` modifier, in the file's quote style.
A barrel export that now points outside its module is dropped and reported; the module a file moved
into exports it if the old one did. Dynamic imports (`loadComponent: () => import(...)`) get the
same treatment. Packages without layers (one still being converted) are left alone. Afterwards it
lists each import the layer or domain rule still rejects, usually a type a `ui` file needs from
`data`, which belongs in `model`.

Replayed over the replays step of heroes-replay-stats (81 files moved from the app), 65 of the 71
files it touched end up with exactly the hand conversion's imports; the rest are the layer barrels'
exports and the route rewiring, which the hand conversion added and `extract-domain` adds. That
check runs with `HRS_DIR=<clone> pnpm test`.

### `publishable`

Inside the workspace a domain package is never built on its own: the apps compile it from source.
`publishable` adds what git-flow's release pipeline needs:

- `ng-package.json` at the package root (`dest: dist`) and in every layer, so each layer is a
  secondary entry point; every `feature` sub-module (a lazy page) gets one too, and an `exports`
  entry, so a consumer's route still loads just the page.
- `tsconfig.lib.json`: partial compilation, declarations, and every workspace dependency mapped to
  its built `dist/`.
- `github.actions.build` (`ng build`), `github.actions.pack` (`gitflow pack`), `ng-packagr` as a dev
  dependency, and a `release-artifacts.yml` with an `ng-lib` artifact (`directory: .`, `packDir:
dist`) for the first npm registry in `.publish/registries.yml`. A library gets a `tsc` build and
  an `npm` artifact instead.

**One rule changes for a publishable package.** ng-packagr compiles each entry point with its own
`rootDir`, so a layer cannot import another layer relatively (`../data`): between two layers of a
publishable package the entry point is used (`@scope/cart/data`), and `publishable` rewrites the
existing imports. To keep one copy of the package in its own test build (two copies give NG0201,
distinct `InjectionToken`s), its `tsconfig.spec.json` maps the package's own name to its sources.
`move` keeps that policy for publishable packages from then on.

## Adopting it in an existing workspace

A workspace converted by hand (heroes-replay-stats) keeps its files; `init` reads what is there:
the scope and prefix from the packages and apps, and a `sheriff.config.ts` with `domains`,
`featureModules`, `shared` and `uses` constants is edited in place, comments and all. What `init`
adds is the root `angular.json`, the `domainPackages` block, the `generate.*` scripts and the editor
settings; it leaves an existing `sheriff.config.ts` and `tools/eslint-sheriff.mjs` as they are.
`ng update @cpdevtools/schematics` runs the same as a migration.

## The kit

`@cpdevtools/schematics/kit` is what the schematics are written with, in the shape of Nx's devkit
over `@angular-devkit/schematics`, for a workspace's own schematics:

| Function                                                                                                                  | What it does                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `names(name, prefix?)`                                                                                                    | Kebab, Pascal, camel and constant forms, and the selector                                                                   |
| `workspace(tree)`                                                                                                         | The `domainPackages` config: scope, prefix, folders                                                                         |
| `workspacePackages(tree, ws)`, `domainClosure(packages, pkg)`                                                             | The member packages (from `pnpm-workspace.yaml`), and a package's dependencies and theirs                                   |
| `generateFiles(tree, templatesDir, target, vars)`                                                                         | Copies a template folder with substitutions (`__name__` in paths, `<%= %>` in content)                                      |
| `readJson`, `updateJson(tree, path, fn)`, `writeJson`                                                                     | JSON and JSONC; `updateJson` keeps comments, key order and formatting                                                       |
| `addExport(tree, indexFile, specifier)`                                                                                   | Adds a sorted `export * from` line                                                                                          |
| `addPackageEntryPoint`, `addRootTsconfigPaths`, `syncSpecClosure`, `wireApps`                                             | The `exports` entry, the root `paths`, the spec `paths` and dev dependencies of the closure, the apps' wiring               |
| `editSheriffConfig(tree, ws, (c) => …)`                                                                                   | `setDomain`, `addDomainEntryPoint`, `addFeatureModule`, `addShared`, `addUses`, `setEntryPoint`, through the TypeScript AST |
| `formatFiles(tree)`                                                                                                       | The workspace's prettier over the files the run changed                                                                     |
| `layerMayImport`, `domainMayUse`, `usesCycle`, `assertUsesAllowed`                                                        | The layer and domain rules                                                                                                  |
| `loadTsWorkspace`, `moduleOf`, `importSpecifier`, `normalizeImports`, `checkBoundaries`, `barrelExports`, `resolveImport` | The ts-morph side `move` is built on                                                                                        |

The kit builds on [ts-dev-utilities](https://github.com/cpdevtools/ts-dev-utilities) for JSON editing
(`updateJsonText`) and the workspace patterns (`parseWorkspacePatterns`), and carries its own
TypeScript through ts-morph, independent of the workspace's version.

## The Sheriff helpers

`@cpdevtools/schematics/sheriff` is what the generated `sheriff.config.ts` imports:

```ts
import {
  domainModules,
  domainRules,
  featureSubModules,
  layerRules,
  rootRule,
} from '@cpdevtools/schematics/sheriff';

const domains: Record<string, readonly string[]> = {
  cart: ['provide', 'feature', 'ui', 'data', 'model'],
};
const featureModules: Record<string, readonly string[]> = { cart: ['cart-page'] };
const shared: string[] = ['common'];
const uses: Record<string, readonly string[]> = { cart: ['products'] };

export const config: SheriffConfig = {
  entryPoints: { web: 'apps/web/src/main.ts' },
  modules: {
    ...domainModules(domains),
    ...featureSubModules(featureModules),
    'libs/<lib>': ['type:lib'],
  },
  depRules: {
    root: rootRule,
    ...domainRules(domains, shared, uses),
    ...layerRules(),
    noTag: ['noTag', 'root'],
  },
};
```

`layerRules(extra)` takes tags every layer may also import, for a package still being converted.
`testingInSpecs` is the rule that only `*.spec.ts` files may import a `testing` entry point.

## Development

`pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck` at the repository root (they run through
`devutil`). Tests run the schematic factories against an in-memory workspace
(`src/testing/workspace.ts`); the collection itself was exercised end to end in a fresh Angular 22
workspace: `init`, every generator, then typecheck, lint, `ng test`, `ng build` of the app and of
the publishable package, `sheriff verify` and the dev server.
