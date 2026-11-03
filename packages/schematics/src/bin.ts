#!/usr/bin/env node
/**
 * `domain-schematics init [--scope <scope>] [--prefix <prefix>] [--apps <dir>] [--packages <dir>] [--libs <dir>] [--dry-run]`
 *
 * Runs the collection's `ng-add` in the current folder, for a workspace that has no root
 * `angular.json` yet (`ng generate` refuses to run outside one; `ng-add` writes it). Afterwards
 * `ng g domain <name>` and the other schematics run at the root as usual.
 */
import { NodeWorkflow } from '@angular-devkit/schematics/tools';
import { join } from 'node:path';

const args = process.argv.slice(2);
const command = args[0];
const options: Record<string, string | boolean> = {};
for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  if (!arg.startsWith('--')) continue;
  const [key, inline] = arg.slice(2).split('=', 2);
  const camel = key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  if (inline !== undefined) options[camel] = inline;
  else if (args[i + 1] && !args[i + 1].startsWith('--')) options[camel] = args[++i];
  else options[camel] = true;
}

if (command !== 'init') {
  console.error(
    'Usage: domain-schematics init [--scope <scope>] [--prefix <prefix>] [--apps <dir>] [--packages <dir>] [--libs <dir>] [--dry-run]',
  );
  process.exit(command === undefined || command === '--help' ? 0 : 1);
}

const dryRun = options.dryRun === true;
delete options.dryRun;
const root = process.cwd();
const workflow = new NodeWorkflow(root, {
  dryRun,
  packageManager: 'pnpm',
  resolvePaths: [root, __dirname],
});
workflow.reporter.subscribe((event) => {
  const path = event.path.replace(/^\//, '');
  switch (event.kind) {
    case 'create':
      console.log(`CREATE ${path}`);
      break;
    case 'update':
      console.log(`UPDATE ${path}`);
      break;
    case 'delete':
      console.log(`DELETE ${path}`);
      break;
    case 'rename':
      console.log(`RENAME ${path} => ${event.to.replace(/^\//, '')}`);
      break;
  }
});
workflow.lifeCycle.subscribe((event) => {
  if (event.kind === 'end' && dryRun) console.log('Dry run: nothing was written.');
});

workflow
  .execute({
    collection: join(__dirname, 'collection.json'),
    schematic: 'ng-add',
    options: { skipInstall: true, ...options },
    logger: undefined,
  })
  .toPromise()
  .then(
    () => {
      if (!dryRun) {
        console.log(
          'Done. Run `pnpm install` to add Sheriff, then `ng g domain <name>` at the root.',
        );
      }
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
