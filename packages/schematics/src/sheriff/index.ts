/**
 * Helpers for a workspace's `sheriff.config.ts`: the modules and rules of the domain package
 * structure, from the domains, feature sub-modules, shared domains and `uses` it declares.
 */

type Tags = readonly string[];
type RuleFn = (context: {
  from: string;
  to: string;
  toTags: string[];
  fromFilePath: string;
}) => boolean;

/** The five layers, in dependency order. */
export const LAYERS = ['provide', 'feature', 'ui', 'data', 'model'] as const;

/**
 * Module entries for every domain and each of its entry points: `packages/<d>` is
 * `domain:<d>` + `type:main`, `packages/<d>/<layer>` is `domain:<d>` + `type:<layer>`.
 */
export function domainModules(
  domains: Readonly<Record<string, readonly string[]>>,
  packagesDir = 'packages',
): Record<string, string[]> {
  const modules: Record<string, string[]> = {};
  for (const [domain, entryPoints] of Object.entries(domains)) {
    modules[`${packagesDir}/${domain}`] = [`domain:${domain}`, 'type:main'];
    for (const entryPoint of entryPoints) {
      modules[`${packagesDir}/${domain}/${entryPoint}`] = [
        `domain:${domain}`,
        `type:${entryPoint}`,
      ];
    }
  }
  return modules;
}

/**
 * Module entries for `feature` sub-modules: smart components loaded on their own, each a module
 * with the layer's tags, so importing one does not bring in the rest of the layer.
 */
export function featureSubModules(
  featureModules: Readonly<Record<string, readonly string[]>>,
  packagesDir = 'packages',
): Record<string, string[]> {
  const modules: Record<string, string[]> = {};
  for (const [domain, names] of Object.entries(featureModules)) {
    for (const name of names) {
      modules[`${packagesDir}/${domain}/feature/${name}`] = [`domain:${domain}`, 'type:feature'];
    }
  }
  return modules;
}

/** Whether a file is a spec. */
export const isSpec = (path: string): boolean => path.endsWith('.spec.ts');

/** A domain's `testing` entry point (test doubles) is for spec files only. */
export const testingInSpecs: RuleFn = ({ to, fromFilePath }) =>
  to === 'type:testing' && isSpec(fromFilePath);

/**
 * The domain rule for one domain: it may import itself, simple libraries, any shared domain (unless
 * it is shared itself), and the domains its `uses` line names.
 */
export function domainRule(
  domain: string,
  shared: readonly string[],
  uses: Readonly<Record<string, readonly string[]>>,
): RuleFn {
  const isShared = shared.includes(domain);
  const allowed = uses[domain] ?? [];
  return ({ to }) => {
    const target = to.replace('domain:', '');
    return (
      to === 'type:lib' ||
      target === domain ||
      (!isShared && shared.includes(target)) ||
      allowed.includes(target)
    );
  };
}

/** `domainRule` for every domain, keyed `domain:<d>`. */
export function domainRules(
  domains: Readonly<Record<string, readonly string[]>>,
  shared: readonly string[],
  uses: Readonly<Record<string, readonly string[]>>,
): Record<string, RuleFn> {
  return Object.fromEntries(
    Object.keys(domains).map((d) => [`domain:${d}`, domainRule(d, shared, uses)]),
  );
}

/**
 * The layer rule: `provide` wires up `feature`; `feature` reaches `ui` and `data`; both reach
 * `model`; everything may use simple libraries; `testing` only from specs. `extra` tags are added
 * to every layer's list (an engine package during a migration).
 */
export function layerRules(extra: Tags = []): Record<string, (string | RuleFn)[]> {
  const e = [...extra];
  return {
    'type:main': [],
    'type:provide': [
      'type:feature',
      'type:ui',
      'type:data',
      'type:model',
      'type:lib',
      testingInSpecs,
      ...e,
    ],
    'type:feature': [
      'type:feature',
      'type:ui',
      'type:data',
      'type:model',
      'type:lib',
      testingInSpecs,
      ...e,
    ],
    'type:ui': ['type:ui', 'type:model', 'type:lib', testingInSpecs, ...e],
    'type:data': ['type:data', 'type:model', 'type:lib', testingInSpecs, ...e],
    'type:model': ['type:model', 'type:lib', testingInSpecs, ...e],
    'type:testing': ['type:testing', 'type:data', 'type:model', 'type:lib'],
    'type:lib': ['type:lib'],
  };
}

/** The app's own files (Sheriff's root module): anything, but `testing` outside specs. */
export const rootRule: RuleFn = ({ toTags, fromFilePath }) =>
  !toTags.includes('type:testing') || isSpec(fromFilePath);
