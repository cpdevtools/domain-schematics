import type { Rule } from '@angular-devkit/schematics';
import { ngAdd } from '../../schematics/ng-add';

/**
 * Brings a workspace that was set up by hand (before `ng add` existed) to what `ng add` writes:
 * `ng add` is idempotent, so the migration is the install run again without the package install.
 */
export function ensureConfig(): Rule {
  return ngAdd({ skipInstall: true });
}

export default ensureConfig;
