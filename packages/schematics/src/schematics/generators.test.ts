import type { Tree } from '@angular-devkit/schematics';
import { domain } from './domain';
import { featureComponent } from './feature-component';
import { featureset } from './featureset';
import { layer } from './layer';
import { slot } from './slot';
import { store } from './store';
import { storeFeature } from './store-feature';
import { testing } from './testing';
import { uiComponent } from './ui-component';
import { worker } from './worker';
import { fakeWorkspace, filesUnder, readJsonFile, run } from '../testing/workspace';

async function cartWorkspace(): Promise<Tree> {
  let tree = await fakeWorkspace();
  tree = await run(domain({ name: 'shell', shared: true, layers: 'feature,ui' }), tree);
  return run(domain({ name: 'cart', layers: 'ui,data,model' }), tree);
}

describe('layer and testing', () => {
  it('add the folder, the export entry and the Sheriff line', async () => {
    let tree = await cartWorkspace();
    tree = await run(layer({ domain: 'cart', name: 'provide' }), tree);
    tree = await run(testing({ domain: 'cart' }), tree);
    expect(tree.readText('packages/cart/provide/index.ts')).toBe('export {};\n');
    expect(Object.keys(readJsonFile(tree, 'packages/cart/package.json').exports).sort()).toEqual(
      ['.', './provide', './ui', './data', './model', './testing'].sort(),
    );
    expect(tree.readText('sheriff.config.ts')).toContain(
      "cart: ['provide', 'ui', 'data', 'model', 'testing']",
    );
    await expect(run(layer({ domain: 'cart', name: 'util' }), tree)).rejects.toThrow(/not a layer/);
    await expect(run(layer({ domain: 'nope', name: 'ui' }), tree)).rejects.toThrow(
      /No domain "nope"/,
    );
  });
});

describe('featureset', () => {
  it('writes the provide files and lists the call in the app', async () => {
    let tree = await cartWorkspace();
    tree = await run(featureset({ domain: 'cart' }), tree);
    expect(tree.readText('packages/cart/provide/provide-cart-feature.ts')).toContain(
      'export function provideCartFeature(): Provider[]',
    );
    expect(tree.readText('packages/cart/provide/routes.ts')).toContain(
      'export const CART_ROUTES: Routes = [];',
    );
    expect(tree.readText('packages/cart/provide/index.ts')).toBe(
      "export * from './provide-cart-feature';\nexport * from './routes';\n",
    );
    const config = tree.readText('apps/web/src/app/app.config.ts');
    expect(config).toContain("import { provideCartFeature } from '@acme/cart/provide';");
    expect(config).toMatch(/providers: \[provideCartFeature\(\), provideRouter\(routes\)\]/);
  });
});

describe('feature-component', () => {
  it('a routed page is its own sub-module with a lazy route', async () => {
    let tree = await cartWorkspace();
    tree = await run(
      featureComponent({ name: 'saved-carts-page', domain: 'cart', routed: true, store: true }),
      tree,
    );
    expect(filesUnder(tree, 'packages/cart/feature/saved-carts-page')).toEqual([
      'packages/cart/feature/saved-carts-page/index.ts',
      'packages/cart/feature/saved-carts-page/saved-carts-page.html',
      'packages/cart/feature/saved-carts-page/saved-carts-page.scss',
      'packages/cart/feature/saved-carts-page/saved-carts-page.spec.ts',
      'packages/cart/feature/saved-carts-page/saved-carts-page.store.ts',
      'packages/cart/feature/saved-carts-page/saved-carts-page.ts',
    ]);
    const component = tree.readText('packages/cart/feature/saved-carts-page/saved-carts-page.ts');
    expect(component).toContain("selector: 'acme-saved-carts-page'");
    expect(component).toContain('providers: [SavedCartsPageStore]');
    expect(tree.readText('packages/cart/feature/index.ts')).toBe(
      "export * from './saved-carts-page';\n",
    );
    expect(tree.readText('sheriff.config.ts')).toContain("cart: ['saved-carts-page']");
    const routes = tree.readText('packages/cart/provide/routes.ts');
    expect(routes).toContain("path: 'saved-carts'");
    expect(routes).toContain("import('../feature/saved-carts-page').then((m) => m.SavedCartsPage)");
    const pkg = readJsonFile(tree, 'packages/cart/package.json');
    expect(pkg.scripts.test).toBe('ng test --watch=false');
    expect(pkg.scripts['github.actions.test']).toBe('pnpm test');
    expect(pkg.peerDependencies['@ngrx/signals']).toBe('^22.0.1');
    expect(Object.keys(pkg.exports)).toContain('./feature');
  });

  it('a slot fill is registered in the featureset', async () => {
    let tree = await cartWorkspace();
    tree = await run(slot({ name: 'nav-item', domain: 'shell' }), tree);
    tree = await run(
      featureComponent({
        name: 'cart-nav-item',
        domain: 'cart',
        path: 'cart',
        slot: 'provideShellNavItem',
        slotDomain: 'shell',
      }),
      tree,
    );
    const provide = tree.readText('packages/cart/provide/provide-cart-feature.ts');
    expect(provide).toContain("import { provideShellNavItem } from '@acme/shell/ui';");
    expect(provide).toContain("import { CartNavItem } from '../feature/cart/cart-nav-item';");
    expect(provide).toContain('provideShellNavItem(CartNavItem)');
    expect(tree.readText('sheriff.config.ts')).toContain("cart: ['cart/cart-nav-item']");
    const slotFile = tree.readText('packages/shell/ui/nav-item/nav-item.slot.ts');
    expect(slotFile).toContain(
      'export const SHELL_NAV_ITEMS = new InjectionToken<readonly Type<unknown>[]>(',
    );
    expect(slotFile).toContain(
      'export function provideShellNavItem(component: Type<unknown>): Provider',
    );
    expect(tree.readText('packages/shell/ui/index.ts')).toContain(
      "export * from './nav-item/nav-item.slot';",
    );
  });

  it('a plain smart component is exported from the layer barrel', async () => {
    let tree = await cartWorkspace();
    tree = await run(
      featureComponent({ name: 'cart-item-quantity', domain: 'cart', path: 'cart-item' }),
      tree,
    );
    expect(tree.readText('packages/cart/feature/index.ts')).toBe(
      "export * from './cart-item/cart-item-quantity/cart-item-quantity';\n",
    );
    expect(tree.readText('sheriff.config.ts')).not.toContain('cart-item-quantity');
  });
});

describe('ui-component, store, store-feature', () => {
  it('write their files under the noun and export them', async () => {
    let tree = await cartWorkspace();
    tree = await run(
      uiComponent({ name: 'quantity-stepper', domain: 'cart', path: 'cart-item', presenter: true }),
      tree,
    );
    tree = await run(store({ name: 'carts', domain: 'cart', path: 'cart' }), tree);
    tree = await run(store({ name: 'checkout', domain: 'cart', kind: 'component' }), tree);
    tree = await run(storeFeature({ name: 'cart-pricing', domain: 'cart', path: 'cart' }), tree);
    expect(
      tree.exists('packages/cart/ui/cart-item/quantity-stepper/quantity-stepper.presenter.ts'),
    ).toBe(true);
    expect(tree.readText('packages/cart/ui/index.ts')).toBe(
      "export * from './cart-item/quantity-stepper/quantity-stepper';\n",
    );
    expect(tree.readText('packages/cart/data/cart/carts.store.ts')).toContain(
      "{ providedIn: 'root' }",
    );
    expect(tree.readText('packages/cart/data/checkout/checkout.store.ts')).not.toContain(
      'providedIn',
    );
    expect(tree.readText('packages/cart/data/cart/with-cart-pricing.ts')).toContain(
      'export function withCartPricing()',
    );
    expect(tree.readText('packages/cart/data/index.ts')).toBe(
      "export * from './cart/carts.store';\nexport * from './cart/with-cart-pricing';\nexport * from './checkout/checkout.store';\n",
    );
  });
});

describe('worker', () => {
  it('writes the worker, its tsconfig, the typecheck step and the Sheriff entry point', async () => {
    let tree = await cartWorkspace();
    tree = await run(worker({ name: 'sync', domain: 'cart' }), tree);
    expect(tree.readText('packages/cart/data/sync/sync.worker.ts')).toContain(
      '/// <reference lib="webworker" />',
    );
    expect(tree.readText('packages/cart/data/sync/sync-worker.ts')).toContain(
      "new Worker(new URL('./sync.worker', import.meta.url), { type: 'module' })",
    );
    expect(tree.exists('packages/cart/tsconfig.worker.json')).toBe(true);
    expect(tree.readText('packages/cart/tsconfig.json')).toContain(
      '"exclude": ["node_modules", "**/*.worker.ts"]',
    );
    expect(readJsonFile(tree, 'packages/cart/package.json').scripts.typecheck).toBe(
      'tsc --noEmit -p . && tsc --noEmit -p tsconfig.worker.json',
    );
    expect(tree.readText('sheriff.config.ts')).toContain(
      "'cart-sync-worker': 'packages/cart/data/sync/sync.worker.ts'",
    );
    expect(readJsonFile(tree, 'package.json').scripts['check.boundaries']).toBe(
      'sheriff verify web,cart-sync-worker',
    );
  });
});
