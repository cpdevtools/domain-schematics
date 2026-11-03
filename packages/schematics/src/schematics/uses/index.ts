import { chain, type Rule, type Tree } from '@angular-devkit/schematics';
import {
  addWorkspaceDependency,
  assertUsesAllowed,
  domainPackage,
  editSheriffConfig,
  readSheriffConfig,
  syncSpecClosure,
  SchematicsException,
} from '../../kit';
import { domainContext, format } from '../common';

export interface UsesOptions {
  domain: string;
  uses: string;
}

/** Adds a domain to another's `uses` line, after checking it makes no cycle. */
export function uses(options: UsesOptions): Rule {
  return chain([
    (tree: Tree) => {
      const ctx = domainContext(tree, options.domain);
      const target = domainPackage(ctx.packages, options.uses);
      if (!target) throw new SchematicsException(`No domain "${options.uses}" to use.`);
      assertUsesAllowed(readSheriffConfig(tree, ctx.ws), ctx.domain, options.uses);
      editSheriffConfig(tree, ctx.ws, (c) => c.addUses(ctx.domain, options.uses));
      addWorkspaceDependency(tree, ctx.dir, target.name);
      // The closure of every domain that depends on this one grew with it.
      for (const pkg of ctx.packages) {
        if (pkg.kind === 'domain' && tree.exists(`${pkg.dir}/tsconfig.spec.json`))
          syncSpecClosure(tree, ctx.ws, pkg);
      }
    },
    format(),
  ]);
}

export default uses;
