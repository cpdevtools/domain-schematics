import type { Tree } from '@angular-devkit/schematics';
import { posix } from 'node:path';
import {
  type ImportDeclaration,
  type ImportSpecifier,
  Node,
  Project,
  QuoteKind,
  type SourceFile,
  ts,
} from 'ts-morph';
import { readJsonIfExists } from './json';
import { packageOfPath, type PackageJson, type WorkspacePackage } from './packages';
import {
  domainMayUse,
  isEntryPoint,
  layerMayImport,
  type DomainRules,
  type EntryPoint,
  type ModuleType,
} from './rules';
import type { DomainPackagesConfig } from './workspace';

/** The module (Sheriff's unit) a file belongs to. */
export interface ModuleInfo {
  /** The module folder, relative to the root, no trailing slash (`packages/cart/feature/cart-page`). */
  readonly dir: string;
  readonly type: ModuleType;
  readonly package?: WorkspacePackage;
  /** For a domain package module: its domain. */
  readonly domain?: string;
  /** For a domain package module: the entry point (layer or `testing`) it sits in. */
  readonly entryPoint?: EntryPoint;
}

export interface WorkspaceFiles {
  readonly tree: Tree;
  readonly ws: DomainPackagesConfig;
  readonly packages: readonly WorkspacePackage[];
}

const SOURCE_EXT = /\.(m|c)?ts$/;

/** Whether a tree path is a TypeScript source the schematics work on. */
export function isSourceFile(path: string): boolean {
  return SOURCE_EXT.test(path) && !path.endsWith('.d.ts') && !path.includes('/node_modules/');
}

/** Strips a leading slash (tree paths carry one, workspace paths do not). */
export function cleanPath(path: string): string {
  return path.replace(/^\/+/, '');
}

/**
 * The module of a file: within a package, the nearest ancestor folder that has an `index.ts`,
 * because Sheriff makes a module of every such folder; a layer folder is one even without.
 */
export function moduleOf(files: WorkspaceFiles, path: string): ModuleInfo {
  const file = cleanPath(path);
  const pkg = packageOfPath(files.packages, file);
  const dir = posix.dirname(file);
  if (!pkg) {
    return { dir: barrelDir(files.tree, dir, undefined) ?? dir, type: 'app' };
  }
  const inside = file.slice(pkg.dir.length + 1);
  const [first] = inside.split('/');
  if (pkg.kind === 'domain') {
    if (isEntryPoint(first) && inside.includes('/')) {
      const layerDir = `${pkg.dir}/${first}`;
      const moduleDir = barrelDir(files.tree, dir, layerDir) ?? layerDir;
      return {
        dir: moduleDir,
        type: first,
        package: pkg,
        domain: pkg.shortName,
        entryPoint: first,
      };
    }
    return { dir: pkg.dir, type: 'main', package: pkg, domain: pkg.shortName };
  }
  if (pkg.kind === 'lib') {
    return { dir: barrelDir(files.tree, dir, pkg.dir) ?? pkg.dir, type: 'lib', package: pkg };
  }
  return { dir: barrelDir(files.tree, dir, pkg.dir) ?? pkg.dir, type: 'app', package: pkg };
}

/** The nearest folder from `dir` up to `stopAt` (inclusive) holding an `index.ts`. */
function barrelDir(tree: Tree, dir: string, stopAt: string | undefined): string | undefined {
  let current = dir;
  for (;;) {
    if (tree.exists(`${current}/index.ts`)) return current;
    if (current === stopAt || current === '.' || current === '' || !current.includes('/')) {
      return current === stopAt && stopAt !== undefined ? stopAt : undefined;
    }
    current = posix.dirname(current);
  }
}

/**
 * The import specifier Sheriff expects from one file to another: a relative file path within one
 * module, the target module's folder (its barrel) between modules of one package, and the entry
 * point (`<scope><package>/<layer>`) between packages.
 */
export function importSpecifier(files: WorkspaceFiles, fromPath: string, toPath: string): string {
  const from = cleanPath(fromPath);
  const to = cleanPath(toPath);
  const fromModule = moduleOf(files, from);
  const toModule = moduleOf(files, to);
  const samePackage =
    fromModule.package && toModule.package && fromModule.package.dir === toModule.package.dir;
  if (samePackage || (!fromModule.package && !toModule.package)) {
    if (fromModule.dir === toModule.dir) return relativeFile(from, to);
    if (!toModule.package) return relativeFile(from, to);
    return relativeDir(from, toModule.dir);
  }
  if (!toModule.package) return relativeFile(from, to);
  return entryPointSpecifier(files.tree, toModule, to);
}

/** The public import of a module in another package. */
export function entryPointSpecifier(tree: Tree, toModule: ModuleInfo, toPath: string): string {
  const pkg = toModule.package!;
  if (toModule.type === 'main') return pkg.name;
  if (toModule.entryPoint) return `${pkg.name}/${toModule.entryPoint}`;
  // A library: the export whose target folder holds the file, else the main entry.
  const manifest = readJsonIfExists<PackageJson>(tree, `${pkg.dir}/package.json`);
  const inside = cleanPath(toPath).slice(pkg.dir.length + 1);
  let best: { key: string; dir: string } | undefined;
  for (const [key, value] of Object.entries(manifest?.exports ?? {})) {
    const target =
      typeof value === 'string' ? value : (value.default ?? value.import ?? value.types);
    if (!target || key === '.' || key.includes('*')) continue;
    const targetDir = posix.dirname(target.replace(/^\.\//, ''));
    if (inside.startsWith(targetDir + '/') && (!best || targetDir.length > best.dir.length)) {
      best = { key, dir: targetDir };
    }
  }
  return best ? `${pkg.name}/${best.key.replace(/^\.\//, '')}` : pkg.name;
}

function relativeFile(from: string, to: string): string {
  let rel = posix.relative(posix.dirname(from), to).replace(SOURCE_EXT, '');
  if (rel.endsWith('/index')) rel = rel.slice(0, -'/index'.length);
  if (rel === 'index') rel = '.';
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function relativeDir(from: string, toDir: string): string {
  const rel = posix.relative(posix.dirname(from), toDir);
  if (rel === '') return '.';
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/** A ts-morph project over the workspace's sources, read from the tree. */
export interface TsWorkspace extends WorkspaceFiles {
  readonly project: Project;
  /** Every source path (clean) and its text as loaded, to diff against after editing. */
  readonly snapshot: ReadonlyMap<string, string>;
}

/**
 * Loads every TypeScript source of the apps, packages and libraries into an in-memory ts-morph
 * project, with the root tsconfig's `paths` so imports between packages resolve.
 */
export function loadTsWorkspace(files: WorkspaceFiles): TsWorkspace {
  const rootTsconfig = readJsonIfExists<{ compilerOptions?: { paths?: Record<string, string[]> } }>(
    files.tree,
    'tsconfig.json',
  );
  const paths: Record<string, string[]> = {};
  for (const [key, targets] of Object.entries(rootTsconfig?.compilerOptions?.paths ?? {})) {
    paths[key] = targets.map((t) => '/' + cleanPath(t.replace(/^\.\//, '')));
  }
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    manipulationSettings: { quoteKind: QuoteKind.Single },
    compilerOptions: {
      baseUrl: '/',
      paths,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      allowImportingTsExtensions: true,
      strict: false,
      skipLibCheck: true,
      noLib: true,
      experimentalDecorators: true,
    },
  });
  const snapshot = new Map<string, string>();
  const roots = [files.ws.apps, files.ws.packages, files.ws.libs];
  for (const root of roots) {
    files.tree.getDir(root).visit((path) => {
      if (!isSourceFile(path)) return;
      const clean = cleanPath(path);
      const text = files.tree.readText(path);
      snapshot.set(clean, text);
      project.createSourceFile('/' + clean, text, { overwrite: true });
    });
  }
  return { ...files, project, snapshot };
}

/**
 * The file an import declaration resolves to, if it is a workspace source. Resolves by hand when the
 * program's cache does not (a file changed under it), so an edited barrel still resolves.
 */
export function resolvedWorkspaceFile(decl: ImportDeclaration): SourceFile | undefined {
  let target = decl.getModuleSpecifierSourceFile();
  if (!target) {
    const file = decl.getSourceFile();
    const project = file.getProject();
    const resolved = ts.resolveModuleName(
      decl.getModuleSpecifierValue(),
      file.getFilePath(),
      project.getCompilerOptions(),
      project.getModuleResolutionHost(),
    ).resolvedModule;
    if (resolved && !resolved.isExternalLibraryImport)
      target = project.getSourceFile(resolved.resolvedFileName);
  }
  if (!target) return undefined;
  const path = cleanPath(target.getFilePath());
  return isSourceFile(path) ? target : undefined;
}

/** The file that declares what a named import names, following `export *` through barrels. */
export function declarationFileOf(spec: ImportSpecifier): SourceFile | undefined {
  return resolveNamedImport(spec)?.file;
}

/** Where a named import's declaration lives, and whether it is a type (an interface or type alias). */
export function resolveNamedImport(
  spec: ImportSpecifier,
): { file: SourceFile; typeOnly: boolean } | undefined {
  const symbol = spec.getNameNode().getSymbol();
  const aliased = symbol?.getAliasedSymbol() ?? symbol;
  const decls = aliased?.getDeclarations() ?? [];
  const file = decls[0]?.getSourceFile();
  if (!file) return undefined;
  const path = cleanPath(file.getFilePath());
  if (!isSourceFile(path)) return undefined;
  const typeOnly = decls.every(
    (d) => Node.isInterfaceDeclaration(d) || Node.isTypeAliasDeclaration(d),
  );
  return { file, typeOnly };
}

/** The quote the file's imports mostly use (single when it has none). */
export function importQuote(file: SourceFile): string {
  let single = 0;
  let double = 0;
  for (const decl of file.getImportDeclarations()) {
    if (decl.getModuleSpecifier().getQuoteKind() === QuoteKind.Double) double++;
    else single++;
  }
  return double > single ? '"' : "'";
}

/** Each name a barrel exports and the file that declares it. */
export function barrelExports(barrel: SourceFile): Map<string, SourceFile> {
  const result = new Map<string, SourceFile>();
  for (const [name, decls] of barrel.getExportedDeclarations()) {
    const file = decls[0]?.getSourceFile();
    if (file) result.set(name, file);
  }
  return result;
}

/**
 * The file an import specifier names from a given file (`fromPath` may be a path the file no
 * longer has, for a moved file's old place), or `undefined` when it is external or unresolvable.
 */
export function resolveImport(
  tsws: TsWorkspace,
  fromPath: string,
  specifier: string,
): string | undefined {
  const host = tsws.project.getModuleResolutionHost();
  const resolved = ts.resolveModuleName(
    specifier,
    '/' + cleanPath(fromPath),
    tsws.project.getCompilerOptions(),
    host,
  ).resolvedModule;
  if (!resolved || resolved.isExternalLibraryImport) return undefined;
  const path = cleanPath(resolved.resolvedFileName);
  return isSourceFile(path) ? path : undefined;
}

interface ImportGroup {
  typeOnly: boolean;
  defaultImport?: string;
  namespaceImport?: string;
  named: { name: string; alias?: string; type: boolean }[];
}

export interface ImportRewrite {
  readonly file: string;
  readonly before: string;
  readonly after: string;
}

/**
 * Rewrites a file's imports of workspace sources to the specifiers Sheriff expects, resolving each
 * named import to the file that declares it: one import whose names now live in two modules
 * becomes two, keeping each name's `type` modifier and the file's quote style. Imports it cannot
 * resolve are left alone. Returns what changed.
 */
export interface NormalizeOptions {
  /** Where a name that no longer resolves through its old barrel now lives (a moved symbol). */
  readonly movedSymbols?: ReadonlyMap<string, SourceFile>;
}

export function normalizeImports(
  tsws: TsWorkspace,
  file: SourceFile,
  options: NormalizeOptions = {},
): ImportRewrite[] {
  const changes: ImportRewrite[] = [];
  const fromPath = cleanPath(file.getFilePath());
  const quote = importQuote(file);
  for (const decl of file.getImportDeclarations()) {
    const target = resolvedWorkspaceFile(decl);
    if (!target) continue;
    const current = decl.getModuleSpecifierValue();
    const groups = new Map<string, ImportGroup>();
    const group = (specifier: string): ImportGroup => {
      let g = groups.get(specifier);
      if (!g) {
        g = { typeOnly: decl.isTypeOnly(), named: [] };
        groups.set(specifier, g);
      }
      return g;
    };
    const defaultImport = decl.getDefaultImport()?.getText();
    const namespaceImport = decl.getNamespaceImport()?.getText();
    const moduleSpecifier = importSpecifier(tsws, fromPath, cleanPath(target.getFilePath()));
    if (defaultImport) group(moduleSpecifier).defaultImport = defaultImport;
    if (namespaceImport) group(moduleSpecifier).namespaceImport = namespaceImport;
    for (const spec of decl.getNamedImports()) {
      const resolved = resolveNamedImport(spec);
      const declFile = resolved?.file ?? options.movedSymbols?.get(spec.getName()) ?? target;
      const specifier = importSpecifier(tsws, fromPath, cleanPath(declFile.getFilePath()));
      group(specifier).named.push({
        name: spec.getName(),
        alias: spec.getAliasNode()?.getText(),
        type: spec.isTypeOnly() || (resolved?.typeOnly ?? false),
      });
    }
    if (groups.size === 0) {
      // A side-effect import: only its specifier can change.
      if (moduleSpecifier === current) continue;
      const before = decl.getText();
      decl.setModuleSpecifier(moduleSpecifier);
      changes.push({ file: fromPath, before, after: decl.getText() });
      continue;
    }
    const before = decl.getText();
    const statements = [...groups.entries()].map(([specifier, g]) => render(g, specifier, quote));
    const after = statements.join('\n');
    if (groups.size === 1 && groups.has(current) && squash(before) === squash(after)) continue;
    decl.replaceWithText(after);
    changes.push({ file: fromPath, before, after: statements.join('\n') });
  }
  return changes;
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/,\s*}/g, ' }').trim();
}

function render(g: ImportGroup, specifier: string, quote: string): string {
  const q = quote;
  const parts: string[] = [];
  if (g.defaultImport) parts.push(g.defaultImport);
  if (g.namespaceImport) parts.push(`* as ${g.namespaceImport}`);
  if (g.named.length > 0) {
    const allType =
      !g.typeOnly && g.named.every((n) => n.type) && !g.defaultImport && !g.namespaceImport;
    const names = g.named.map((n) => {
      const typeMod = n.type && !allType && !g.typeOnly ? 'type ' : '';
      return `${typeMod}${n.name}${n.alias ? ` as ${n.alias}` : ''}`;
    });
    parts.push(`{ ${names.join(', ')} }`);
    if (allType) g = { ...g, typeOnly: true };
  }
  return `import ${g.typeOnly ? 'type ' : ''}${parts.join(', ')} from ${q}${specifier}${q};`;
}

export interface BoundaryViolation {
  readonly file: string;
  readonly specifier: string;
  readonly from: string;
  readonly to: string;
  readonly message: string;
}

/**
 * Checks a file's imports of workspace sources against the layer and domain rules, the way Sheriff
 * will once the files are on disk, and lists what it would reject.
 */
export function checkBoundaries(
  tsws: TsWorkspace,
  rules: DomainRules,
  file: SourceFile,
): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  const fromPath = cleanPath(file.getFilePath());
  const from = moduleOf(tsws, fromPath);
  const fromSpec = fromPath.endsWith('.spec.ts');
  for (const decl of file.getImportDeclarations()) {
    const target = resolvedWorkspaceFile(decl);
    if (!target) continue;
    const to = moduleOf(tsws, cleanPath(target.getFilePath()));
    const specifier = decl.getModuleSpecifierValue();
    const tag = (m: ModuleInfo) =>
      m.domain ? `domain:${m.domain} type:${m.type}` : `type:${m.type}`;
    if (!layerMayImport(from.type, to.type, fromSpec)) {
      violations.push({
        file: fromPath,
        specifier,
        from: tag(from),
        to: tag(to),
        message: `${fromPath}: '${specifier}' (${tag(from)} → ${tag(to)}) breaks the layer rule: ${from.type} may not import ${to.type}.`,
      });
      continue;
    }
    if (from.domain && to.domain && !domainMayUse(rules, from.domain, to.domain)) {
      violations.push({
        file: fromPath,
        specifier,
        from: tag(from),
        to: tag(to),
        message: `${fromPath}: '${specifier}' (${tag(from)} → ${tag(to)}) breaks the domain rule: ${from.domain} does not use ${to.domain}.`,
      });
    } else if (from.type === 'lib' && to.domain) {
      violations.push({
        file: fromPath,
        specifier,
        from: tag(from),
        to: tag(to),
        message: `${fromPath}: '${specifier}' breaks the domain rule: a simple library never imports a domain package.`,
      });
    }
  }
  return violations;
}

/** Writes the project's changes back to the tree: new, changed and removed files. */
export function commitTsWorkspace(tsws: TsWorkspace): {
  changed: string[];
  created: string[];
  deleted: string[];
} {
  const changed: string[] = [];
  const created: string[] = [];
  const deleted: string[] = [];
  const present = new Set<string>();
  for (const sf of tsws.project.getSourceFiles()) {
    const path = cleanPath(sf.getFilePath());
    present.add(path);
    const text = sf.getFullText();
    const before = tsws.snapshot.get(path);
    if (before === undefined) {
      if (tsws.tree.exists(path)) tsws.tree.overwrite(path, text);
      else tsws.tree.create(path, text);
      created.push(path);
    } else if (before !== text) {
      tsws.tree.overwrite(path, text);
      changed.push(path);
    }
  }
  for (const path of tsws.snapshot.keys()) {
    if (!present.has(path) && tsws.tree.exists(path)) {
      tsws.tree.delete(path);
      deleted.push(path);
    }
  }
  return { changed, created, deleted };
}
