import { chain, type Rule, type Tree } from '@angular-devkit/schematics';
import { domainContext, ensureEntryPoint, format } from '../common';

export interface TestingOptions {
  domain: string;
}

/** The domain's `testing` entry point: test doubles, which only `*.spec.ts` files may import. */
export function testing(options: TestingOptions): Rule {
  return chain([
    (tree: Tree) => {
      ensureEntryPoint(tree, domainContext(tree, options.domain), 'testing');
    },
    format(),
  ]);
}

export default testing;
