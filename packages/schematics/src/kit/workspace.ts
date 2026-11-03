import { SchematicsException, type Tree } from '@angular-devkit/schematics';
import { readJson } from './json';

/** The `domainPackages` block of the root `package.json`, written by `ng add`. */
export interface DomainPackagesConfig {
  /**
   * What every package name starts with, up to the domain or library name: `@scope/` or
   * `@scope/product-`. A domain `cart` is the package `<scope>cart`.
   */
  readonly scope: string;
  /** The selector prefix of the workspace's components and directives. */
  readonly prefix: string;
  /** The folder holding the apps (`apps`). */
  readonly apps: string;
  /** The folder holding the domain packages (`packages`). */
  readonly packages: string;
  /** The folder holding the simple libraries (`libs`). */
  readonly libs: string;
  /** Sheriff's config file, relative to the root (`sheriff.config.ts`). */
  readonly sheriffConfig: string;
}

/** The key under which the config sits in the root `package.json`. */
export const CONFIG_KEY = 'domainPackages';

export const DEFAULT_CONFIG: Omit<DomainPackagesConfig, 'scope' | 'prefix'> = {
  apps: 'apps',
  packages: 'packages',
  libs: 'libs',
  sheriffConfig: 'sheriff.config.ts',
};

/** The workspace as the schematics see it: its config and the paths derived from it. */
export interface Workspace extends DomainPackagesConfig {
  /** The root `package.json` as parsed. */
  readonly rootPackageJson: Record<string, unknown>;
}

/**
 * Reads the workspace config from the root `package.json`. Throws, naming `ng add`, when the
 * workspace has none.
 */
export function workspace(tree: Tree): Workspace {
  const rootPackageJson = readJson<Record<string, unknown>>(tree, 'package.json');
  const config = rootPackageJson[CONFIG_KEY] as Partial<DomainPackagesConfig> | undefined;
  if (!config?.scope) {
    throw new SchematicsException(
      `No "${CONFIG_KEY}" config in the root package.json. Run \`ng add @cpdevtools/schematics\` first.`,
    );
  }
  return {
    ...DEFAULT_CONFIG,
    prefix: 'app',
    ...config,
    scope: config.scope,
    rootPackageJson,
  };
}

/** The package name of a domain or a simple library. */
export function packageName(ws: DomainPackagesConfig, name: string): string {
  return `${ws.scope}${name}`;
}

/** The domain or library name of a package name under the workspace scope, or `undefined`. */
export function nameOfPackage(ws: DomainPackagesConfig, pkg: string): string | undefined {
  return pkg.startsWith(ws.scope) && pkg.length > ws.scope.length
    ? pkg.slice(ws.scope.length)
    : undefined;
}

/** `packages/<domain>` */
export function domainDir(ws: DomainPackagesConfig, domain: string): string {
  return `${ws.packages}/${domain}`;
}

/** `libs/<name>` */
export function libDir(ws: DomainPackagesConfig, name: string): string {
  return `${ws.libs}/${name}`;
}

/** The entry-point import of a layer: `<scope><domain>/<layer>`. */
export function entryPoint(ws: DomainPackagesConfig, domain: string, layer?: string): string {
  return layer ? `${packageName(ws, domain)}/${layer}` : packageName(ws, domain);
}
