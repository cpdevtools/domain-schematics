import { fakeWorkspace, readJsonFile, run } from '../../testing/workspace';
import { ngAdd } from './index';

describe('ng add', () => {
  it('writes the config, registers the collection and sets up Sheriff', async () => {
    const tree = await fakeWorkspace();
    const root = readJsonFile(tree, 'package.json');
    expect(root.domainPackages).toEqual({
      scope: '@acme/',
      prefix: 'acme',
      apps: 'apps',
      packages: 'packages',
      libs: 'libs',
      sheriffConfig: 'sheriff.config.ts',
    });
    expect(root.scripts['generate.domain']).toBe('ng generate domain');
    expect(root.scripts['check.boundaries']).toBe('sheriff verify web');
    expect(root.devDependencies['@softarc/sheriff-core']).toBe('^0.20.0');
    expect(readJsonFile(tree, 'angular.json').cli.schematicCollections).toEqual([
      '@cpdevtools/schematics',
    ]);
    expect(
      readJsonFile(tree, '.vscode/settings.json')['typescript.preferences.importModuleSpecifier'],
    ).toBe('non-relative');
    const sheriff = tree.readText('sheriff.config.ts');
    expect(sheriff).toContain("web: 'apps/web/src/main.ts'");
    expect(sheriff).toContain('const domains: Record<string, readonly string[]> = {};');
    expect(tree.exists('tools/eslint-sheriff.mjs')).toBe(true);
    // The root tsconfig keeps its comment.
    expect(tree.readText('tsconfig.json')).toContain('// comments survive edits');
  });

  it('infers the scope from the existing packages and the prefix from the app', async () => {
    const tree = await fakeWorkspace({
      installed: false,
      scope: '@myrddraall/heroes-replay-stats-',
      prefix: 'hrs',
    });
    tree.create(
      'packages/common/package.json',
      JSON.stringify({ name: '@myrddraall/heroes-replay-stats-common' }),
    );
    tree.create(
      'libs/signals/package.json',
      JSON.stringify({ name: '@myrddraall/heroes-replay-stats-signals' }),
    );
    const result = await run(ngAdd({ skipInstall: true }), tree);
    const config = readJsonFile(result, 'package.json').domainPackages;
    expect(config.scope).toBe('@myrddraall/heroes-replay-stats-');
    expect(config.prefix).toBe('hrs');
  });
});
