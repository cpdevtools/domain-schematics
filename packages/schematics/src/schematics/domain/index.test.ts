import { domain } from './index';
import { uses } from '../uses';
import { fakeWorkspace, filesUnder, readJsonFile, run } from '../../testing/workspace';

describe('domain', () => {
  it('writes the package, wires the app, the root paths and Sheriff', async () => {
    const tree = await run(
      domain({ name: 'cart', layers: 'provide,feature,ui,data,model' }),
      await fakeWorkspace(),
    );
    expect(filesUnder(tree, 'packages/cart')).toEqual([
      'packages/cart/angular.json',
      'packages/cart/data/index.ts',
      'packages/cart/eslint.config.mjs',
      'packages/cart/feature/index.ts',
      'packages/cart/index.ts',
      'packages/cart/model/index.ts',
      'packages/cart/ng-package.json',
      'packages/cart/package.json',
      'packages/cart/provide/index.ts',
      'packages/cart/tsconfig.json',
      'packages/cart/tsconfig.spec.json',
      'packages/cart/ui/index.ts',
    ]);
    const pkg = readJsonFile(tree, 'packages/cart/package.json');
    expect(pkg.name).toBe('@acme/cart');
    expect(pkg.exports).toEqual({
      '.': './index.ts',
      './provide': './provide/index.ts',
      './feature': './feature/index.ts',
      './ui': './ui/index.ts',
      './data': './data/index.ts',
      './model': './model/index.ts',
    });
    expect(pkg.scripts.test).toBeUndefined();
    expect(pkg.devDependencies['@angular/core']).toBe('^22.1.0');
    expect(pkg.devDependencies.vitest).toBe('^4.0.8');
    const paths = readJsonFile(tree, 'tsconfig.json').compilerOptions.paths;
    expect(paths['@acme/cart']).toEqual(['./packages/cart/index.ts']);
    expect(paths['@acme/cart/*']).toEqual(['./packages/cart/*']);
    expect(readJsonFile(tree, 'apps/web/package.json').dependencies['@acme/cart']).toBe(
      'workspace:*',
    );
    expect(
      readJsonFile(tree, 'apps/web/tsconfig.spec.json').compilerOptions.paths['@acme/cart/*'],
    ).toEqual(['../../packages/cart/*/index.ts']);
    expect(
      readJsonFile(tree, 'apps/web/angular.json').projects.web.architect.serve.options.prebundle
        .exclude,
    ).toEqual(['@acme/cart']);
    expect(tree.readText('sheriff.config.ts')).toContain(
      "cart: ['provide', 'feature', 'ui', 'data', 'model']",
    );
    expect(tree.readText('packages/cart/eslint.config.mjs')).toContain("prefix: 'acme'");
  });

  it('declares uses, shared, and the spec paths of the closure', async () => {
    let tree = await fakeWorkspace();
    tree = await run(domain({ name: 'common', layers: 'ui,model', shared: true }), tree);
    tree = await run(
      domain({ name: 'products', layers: 'provide,feature,ui,data,model', deps: 'common' }),
      tree,
    );
    tree = await run(
      domain({ name: 'cart', layers: 'provide,feature,ui,data,model', deps: 'products' }),
      tree,
    );
    const sheriff = tree.readText('sheriff.config.ts');
    expect(sheriff).toContain("const shared: string[] = ['common'];");
    expect(sheriff).toContain("cart: ['products']");
    expect(readJsonFile(tree, 'packages/cart/package.json').dependencies['@acme/products']).toBe(
      'workspace:*',
    );
    const spec = readJsonFile(tree, 'packages/cart/tsconfig.spec.json');
    expect(spec.compilerOptions.rootDir).toBe('../..');
    expect(spec.compilerOptions.paths).toEqual({
      '@acme/products/*': ['../../packages/products/*/index.ts'],
      '@acme/common/*': ['../../packages/common/*/index.ts'],
    });
  });

  it('creates no layers it was not told about, and refuses without any', async () => {
    let tree = await fakeWorkspace();
    await expect(run(domain({ name: 'cart' }), tree)).rejects.toThrow(/Name the layers/);
    tree = await run(domain({ name: 'cart', layers: 'ui,model' }), tree);
    expect(filesUnder(tree, 'packages/cart').filter((f) => f.endsWith('/index.ts'))).toEqual([
      'packages/cart/index.ts',
      'packages/cart/model/index.ts',
      'packages/cart/ui/index.ts',
    ]);
    expect(readJsonFile(tree, 'packages/cart/package.json').exports).toEqual({
      '.': './index.ts',
      './ui': './ui/index.ts',
      './model': './model/index.ts',
    });
    expect(tree.readText('sheriff.config.ts')).toContain("cart: ['ui', 'model']");
  });

  it('refuses a cycle and a shared domain using a business one', async () => {
    let tree = await fakeWorkspace();
    tree = await run(domain({ name: 'products', layers: 'provide,feature,ui,data,model' }), tree);
    tree = await run(
      domain({ name: 'cart', layers: 'provide,feature,ui,data,model', deps: 'products' }),
      tree,
    );
    await expect(
      run(
        domain({
          name: 'shell',
          layers: 'provide,feature,ui,data,model',
          shared: true,
          deps: 'cart',
        }),
        tree,
      ),
    ).rejects.toThrow(/shared domain/);
    await expect(run(uses({ domain: 'products', uses: 'cart' }), tree)).rejects.toThrow(/cycle/);
  });
});
