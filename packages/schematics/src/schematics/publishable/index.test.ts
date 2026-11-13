import { domain } from '../domain';
import { featureComponent } from '../feature-component';
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
    tree = await run(
      domain({ name: 'cart', layers: 'provide,feature,ui,data,model', deps: 'common' }),
      tree,
    );
    tree.create(
      'packages/cart/model/cart.ts',
      'export interface Cart {\n  readonly id: string;\n}\n',
    );
    tree.overwrite('packages/cart/model/index.ts', "export * from './cart';\n");
    tree.create(
      'packages/cart/ui/cart-row/cart-row.ts',
      "import type { Cart } from '../../model';\nimport { helper } from './helper';\n\nexport const row = (c: Cart) => helper(c.id);\n",
    );
    tree.create(
      'packages/cart/ui/cart-row/helper.ts',
      'export const helper = (id: string) => id;\n',
    );
    tree.overwrite('packages/cart/ui/index.ts', "export * from './cart-row/cart-row';\n");
    tree = await run(publishable({ name: 'cart' }), tree);
    // Between layers the entry point; within a layer still relative.
    expect(tree.readText('packages/cart/ui/cart-row/cart-row.ts')).toBe(
      "import type { Cart } from '@acme/cart/model';\nimport { helper } from './helper';\n\nexport const row = (c: Cart) => helper(c.id);\n",
    );
    expect(
      readJsonFile(tree, 'packages/cart/tsconfig.spec.json').compilerOptions.paths['@acme/cart/*'],
    ).toEqual(['./*/index.ts']);
    expect(readJsonFile(tree, 'packages/cart/ng-package.json').allowedNonPeerDependencies).toEqual([
      '^@acme/',
    ]);
    expect(readJsonFile(tree, 'packages/cart/package.json').devDependencies['ng-packagr']).toBe(
      '^22.1.0',
    );
    expect(tree.readText('packages/cart/tsconfig.lib.json')).toContain(
      '"compilationMode": "partial"',
    );
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

  it('a lazy page becomes its own secondary entry point, so the route still loads only the page', async () => {
    let tree = await fakeWorkspace();
    tree = await run(domain({ name: 'cart', layers: 'provide,feature,ui,data,model' }), tree);
    tree = await run(featureComponent({ name: 'cart-page', domain: 'cart', routed: true }), tree);
    tree = await run(publishable({ name: 'cart' }), tree);
    expect(tree.exists('packages/cart/feature/cart-page/ng-package.json')).toBe(true);
    expect(readJsonFile(tree, 'packages/cart/package.json').exports['./feature/cart-page']).toBe(
      './feature/cart-page/index.ts',
    );
    expect(tree.readText('packages/cart/provide/routes.ts')).toContain(
      "import('@acme/cart/feature/cart-page').then((m) => m.CartPage)",
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
