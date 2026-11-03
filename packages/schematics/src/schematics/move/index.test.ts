import type { Tree } from '@angular-devkit/schematics';
import { domain } from '../domain';
import { extractDomain } from '../extract-domain';
import { move, performMove } from './index';
import { fakeWorkspace, run } from '../../testing/workspace';

/** cart: data holds a service and a type the ui needs; feature uses both; products uses cart's model. */
async function layered(): Promise<Tree> {
  let tree = await fakeWorkspace();
  tree = await run(domain({ name: 'cart' }), tree);
  tree = await run(domain({ name: 'products', deps: 'cart' }), tree);
  tree.create(
    'packages/cart/data/replay/replay.service.ts',
    `import { Injectable } from '@angular/core';

/** What a replay adds up to. */
export interface ReplaySummary {
  readonly id: string;
  readonly kills: number;
}

export type ReplayId = string;

@Injectable({ providedIn: 'root' })
export class ReplayService {
  summary(id: ReplayId): ReplaySummary {
    return { id, kills: 0 };
  }
}
`,
  );
  tree.overwrite('packages/cart/data/index.ts', "export * from './replay/replay.service';\n");
  tree.create(
    'packages/cart/ui/score/score-table.ts',
    `import { Component, input } from '@angular/core';
import type { ReplaySummary } from '../../data';

@Component({ selector: 'acme-score-table', template: '' })
export class ScoreTable {
  readonly summary = input.required<ReplaySummary>();
}
`,
  );
  tree.overwrite('packages/cart/ui/index.ts', "export * from './score/score-table';\n");
  tree.create(
    'packages/cart/feature/replay-page/replay-page.ts',
    `import { Component, inject } from "@angular/core";
import { type ReplaySummary, ReplayService } from "../../data";
import { ScoreTable } from "../../ui";

@Component({ selector: 'acme-replay-page', imports: [ScoreTable], template: '' })
export class ReplayPage {
  private readonly replays = inject(ReplayService);
  summary: ReplaySummary = this.replays.summary('1');
}
`,
  );
  tree.create('packages/cart/feature/replay-page/index.ts', "export * from './replay-page';\n");
  tree.overwrite('packages/cart/feature/index.ts', "export * from './replay-page';\n");
  tree.create(
    'packages/products/data/pricing.ts',
    `import type { ReplaySummary } from '@acme/cart/data';

export function price(summary: ReplaySummary): number {
  return summary.kills;
}
`,
  );
  tree.overwrite('packages/products/data/index.ts', "export * from './pricing';\n");
  tree.create(
    'apps/web/src/app/widget.ts',
    `import { ReplayService } from '@acme/cart/data';

export const service = ReplayService;
`,
  );
  return tree;
}

describe('move', () => {
  it('moves a symbol to another layer and repoints every importer, splitting statements', async () => {
    const tree = await layered();
    const report = performMove(tree, {
      files: {},
      symbols: [
        {
          name: 'ReplaySummary',
          from: 'packages/cart/data/replay/replay.service.ts',
          to: 'packages/cart/model/replay-summary.ts',
        },
      ],
    });
    const model = tree.readText('packages/cart/model/replay-summary.ts');
    expect(model).toContain('export interface ReplaySummary');
    expect(model).toContain('/** What a replay adds up to. */');
    const service = tree.readText('packages/cart/data/replay/replay.service.ts');
    expect(service).not.toContain('interface ReplaySummary');
    expect(service).toContain("import type { ReplaySummary } from '../../model';");
    expect(tree.readText('packages/cart/model/index.ts')).toContain(
      "export * from './replay-summary';",
    );
    // ui: the type now comes from model, not data.
    expect(tree.readText('packages/cart/ui/score/score-table.ts')).toContain(
      "import type { ReplaySummary } from '../../model';",
    );
    // feature: one import became two, the type modifier kept, double quotes kept.
    const page = tree.readText('packages/cart/feature/replay-page/replay-page.ts');
    expect(page).toContain('import { ReplayService } from "../../data";');
    expect(page).toContain('import type { ReplaySummary } from "../../model";');
    // another package: the entry point changes.
    expect(tree.readText('packages/products/data/pricing.ts')).toContain(
      "import type { ReplaySummary } from '@acme/cart/model';",
    );
    expect(report.violations).toEqual([]);
    expect(report.rewrites.length).toBeGreaterThanOrEqual(3);
  });

  it('moves a folder to another domain, follows the exports and rewrites the entry points', async () => {
    let tree = await layered();
    tree = await run(domain({ name: 'scores', layers: 'ui,model', deps: 'cart' }), tree);
    tree = await run(
      move({ from: 'packages/cart/ui/score', to: 'packages/scores/ui/score' }),
      tree,
    );
    expect(tree.exists('packages/cart/ui/score/score-table.ts')).toBe(false);
    expect(tree.readText('packages/scores/ui/index.ts')).toContain(
      "export * from './score/score-table';",
    );
    expect(tree.readText('packages/cart/ui/index.ts')).not.toContain('score-table');
    // The moved file now imports cart's type by entry point; the page imports scores' ui.
    expect(tree.readText('packages/scores/ui/score/score-table.ts')).toContain(
      "import type { ReplaySummary } from '@acme/cart/data';",
    );
    // Formatted by the workspace's prettier (single quotes), as every changed file is.
    expect(tree.readText('packages/cart/feature/replay-page/replay-page.ts')).toContain(
      "import { ScoreTable } from '@acme/scores/ui';",
    );
  });

  it('reports what the rules still forbid after a move', async () => {
    const tree = await layered();
    // A ui file that imports a service from data breaks the layer rule.
    const report = performMove(tree, {
      files: {
        'packages/cart/feature/replay-page/replay-page.ts':
          'packages/cart/ui/replay-page/replay-page.ts',
      },
      symbols: [],
    });
    expect(report.violations.map((v) => v.message)).toEqual([
      expect.stringMatching(/replay-page\.ts: '\.\.\/\.\.\/data' .* ui may not import data/),
    ]);
  });

  it('refuses a missing source and a target that exists', async () => {
    const tree = await layered();
    await expect(
      run(move({ from: 'packages/cart/nope.ts', to: 'packages/cart/ui/nope.ts' }), tree),
    ).rejects.toThrow(/does not exist/);
    await expect(
      run(
        move({
          from: 'packages/cart/ui/score/score-table.ts',
          to: 'packages/cart/data/replay/replay.service.ts',
        }),
        tree,
      ),
    ).rejects.toThrow(/already exists/);
  });
});

describe('extract-domain', () => {
  it('moves an app folder into a new domain and repoints the app', async () => {
    let tree = await fakeWorkspace();
    tree.create(
      'apps/web/src/app/orders/orders-page.ts',
      `import { Component } from '@angular/core';
import { OrdersService } from './orders.service';

@Component({ selector: 'acme-orders-page', template: '' })
export class OrdersPage {
  constructor(readonly orders: OrdersService) {}
}
`,
    );
    tree.create(
      'apps/web/src/app/orders/orders.service.ts',
      `import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class OrdersService {}
`,
    );
    tree.overwrite(
      'apps/web/src/app/app.routes.ts',
      `import type { Routes } from '@angular/router';
import { OrdersPage } from './orders/orders-page';

export const routes: Routes = [{ path: 'orders', component: OrdersPage }];
`,
    );
    tree = await run(extractDomain({ name: 'orders', from: 'apps/web/src/app/orders' }), tree);
    expect(tree.exists('apps/web/src/app/orders/orders-page.ts')).toBe(false);
    expect(tree.readText('packages/orders/feature/orders-page.ts')).toContain(
      "import { OrdersService } from './orders.service';",
    );
    expect(tree.readText('packages/orders/feature/index.ts')).toBe(
      "export * from './orders-page';\nexport * from './orders.service';\n",
    );
    expect(tree.readText('apps/web/src/app/app.routes.ts')).toContain(
      "import { OrdersPage } from '@acme/orders/feature';",
    );
    expect(tree.readText('sheriff.config.ts')).toContain(
      "orders: ['provide', 'feature', 'ui', 'data', 'model']",
    );
  });
});
