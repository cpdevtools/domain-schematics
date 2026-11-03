import { SchematicsException } from '@angular-devkit/schematics';

/** The five layers of a domain package, in dependency order. */
export const LAYERS = ['provide', 'feature', 'ui', 'data', 'model'] as const;
export type Layer = (typeof LAYERS)[number];

/** Every entry point a domain package may have: the layers plus `testing`. */
export const ENTRY_POINTS = [...LAYERS, 'testing'] as const;
export type EntryPoint = (typeof ENTRY_POINTS)[number];

/** What a module is, for the layer rule: a layer, the main entry, `testing`, a library, or app code. */
export type ModuleType = EntryPoint | 'main' | 'lib' | 'app';

export function isLayer(value: string): value is Layer {
  return (LAYERS as readonly string[]).includes(value);
}

export function isEntryPoint(value: string): value is EntryPoint {
  return (ENTRY_POINTS as readonly string[]).includes(value);
}

/** The layer rule: what each kind of module may import, besides `testing` (spec files only). */
const LAYER_RULE: Record<ModuleType, readonly ModuleType[]> = {
  provide: ['feature', 'ui', 'data', 'model', 'lib'],
  feature: ['feature', 'ui', 'data', 'model', 'lib'],
  ui: ['ui', 'model', 'lib'],
  data: ['data', 'model', 'lib'],
  model: ['model', 'lib'],
  testing: ['testing', 'data', 'model', 'lib'],
  main: [],
  lib: ['lib'],
  app: ['main', 'provide', 'feature', 'data', 'model', 'lib', 'app'],
};

/** Whether the layer rule allows an import; `testing` only from a spec file. */
export function layerMayImport(from: ModuleType, to: ModuleType, fromSpec = false): boolean {
  if (to === 'testing') return fromSpec;
  return LAYER_RULE[from].includes(to);
}

/** The domain rule's inputs: which domains are shared and which may use which. */
export interface DomainRules {
  readonly shared: readonly string[];
  readonly uses: Readonly<Record<string, readonly string[]>>;
}

/** Whether the domain rule allows `from` to import `to`: itself, a shared domain, or a declared use. */
export function domainMayUse(rules: DomainRules, from: string, to: string): boolean {
  if (from === to) return true;
  if (rules.shared.includes(to) && !rules.shared.includes(from)) return true;
  return (rules.uses[from] ?? []).includes(to);
}

/**
 * The cycle that adding `from → to` to `uses` would close, as the path from `to` back to `from`,
 * or `undefined` if there is none.
 */
export function usesCycle(
  uses: Readonly<Record<string, readonly string[]>>,
  from: string,
  to: string,
): string[] | undefined {
  const seen = new Set<string>();
  const path: string[] = [];
  const visit = (node: string): boolean => {
    if (node === from) return true;
    if (seen.has(node)) return false;
    seen.add(node);
    path.push(node);
    for (const next of uses[node] ?? []) if (visit(next)) return true;
    path.pop();
    return false;
  };
  return visit(to) ? [...path, from] : undefined;
}

/** Throws, with the rule's message, when `from` may not declare that it uses `to`. */
export function assertUsesAllowed(rules: DomainRules, from: string, to: string): void {
  if (from === to) throw new SchematicsException(`A domain cannot use itself (${from}).`);
  if (rules.shared.includes(from) && !rules.shared.includes(to)) {
    throw new SchematicsException(
      `${from} is a shared domain and may not use the business domain ${to}. ` +
        `Declare a slot in ${from} and fill it from ${to} instead.`,
    );
  }
  const cycle = usesCycle(rules.uses, from, to);
  if (cycle) {
    throw new SchematicsException(
      `${from} → ${to} would close a cycle: ${[from, ...cycle].join(' → ')}. ` +
        `The lower domain declares a slot and the higher one fills it.`,
    );
  }
}
