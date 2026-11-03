# domain-schematics

Angular schematics that create and maintain **domain packages**: one pnpm package per domain, split
into the layers `provide`, `feature`, `ui`, `data` and `model`, with module boundaries enforced by
[Sheriff](https://github.com/softarc-consulting/sheriff).

| Package                                         | What it is                                                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@cpdevtools/schematics`](packages/schematics) | The collection (`ng g domain cart`), the kit it is built on (`@cpdevtools/schematics/kit`) and the Sheriff config helpers (`@cpdevtools/schematics/sheriff`) |

```sh
pnpm add -D @cpdevtools/schematics
pnpm exec domain-schematics init
ng g domain cart
```

Releases run through [git-flow](https://github.com/cpdevtools/git-flow). `pnpm build`, `pnpm test`,
`pnpm lint` and `pnpm typecheck` at the root run every package through `devutil`.
