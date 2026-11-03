import { domain } from '../domain';
import { library } from '../library';
import { publishable } from './index';
import { fakeWorkspace, readJsonFile, run } from '../../testing/workspace';

describe('publishable', () => {
  it('a domain gets ng-packagr files per layer, a lib tsconfig against dist and an ng-lib artifact', async () => {
    let tree = await fakeWorkspace();
    tree.create(
      '.publish/registries.yml',
      'registries:\n  github-npm:\n    type: npm\n    url: https://npm.pkg.github.com\n',
    );
    tree = await run(domain({ name: 'common', layers: 'ui,model', shared: true }), tree);
    tree = await run(domain({ name: 'cart', deps: 'common' }), tree);
    tree = await run(publishable({ name: 'cart' }), tree);
    expect(readJsonFile(tree, 'packages/cart/ng-package.json').dest).toBe('dist');
    expect(tree.exists('packages/cart/ui/ng-package.json')).toBe(true);
    expect(tree.exists('packages/cart/model/ng-package.json')).toBe(true);
    const lib = readJsonFile(tree, 'packages/cart/tsconfig.lib.json');
    expect(lib.compilerOptions.paths).toEqual({
      '@acme/common': ['../../packages/common/dist'],
      '@acme/common/*': ['../../packages/common/dist/*'],
    });
    const pkg = readJsonFile(tree, 'packages/cart/package.json');
    expect(pkg.private).toBeUndefined();
    expect(pkg.scripts['github.actions.build']).toBe('ng build');
    expect(pkg.scripts['github.actions.pack']).toBe('gitflow pack');
    expect(
      readJsonFile(tree, 'packages/cart/angular.json').projects.cart.architect.build.options
        .tsConfig,
    ).toBe('tsconfig.lib.json');
    expect(tree.readText('packages/cart/release-artifacts.yml')).toBe(
      'artifacts:\n  - type: ng-lib\n    name: ${PACKAGE_NAME}\n    directory: .\n    packDir: dist\n    registries:\n      - github-npm\n',
    );
  });

  it('a library gets a tsc build and an npm artifact', async () => {
    let tree = await fakeWorkspace();
    tree = await run(library({ name: 'signals' }), tree);
    tree = await run(publishable({ name: 'signals' }), tree);
    expect(readJsonFile(tree, 'libs/signals/package.json').scripts['github.actions.build']).toBe(
      'tsc -p tsconfig.lib.json',
    );
    expect(tree.readText('libs/signals/release-artifacts.yml')).toContain('type: npm');
  });
});
