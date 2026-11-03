import {
  chain,
  SchematicsException,
  type Rule,
  type SchematicContext,
  type Tree,
} from '@angular-devkit/schematics';
import { posix } from 'node:path';
import { Node, type SourceFile, SyntaxKind, type Statement } from 'ts-morph';
import {
  checkBoundaries,
  cleanPath,
  commitTsWorkspace,
  isConverted,
  isSourceFile,
  loadTsWorkspace,
  moduleOf,
  normalizeImports,
  readJson,
  readSheriffConfig,
  workspace,
  workspacePackages,
  type BoundaryViolation,
  type ImportRewrite,
  type TsWorkspace,
} from '../../kit';
import { format } from '../common';

export interface MoveOptions {
  /** A file or folder to move. */
  from?: string;
  /** Where it goes (a file for a file, a folder for a folder). */
  to?: string;
  /** With `from` and `to` files: the exported symbol to move between them instead of the file. */
  symbol?: string;
  /** A JSON file with many moves: `{ "files": { "<from>": "<to>" }, "symbols": [{ "name", "from", "to" }] }`. */
  manifest?: string;
}

export interface SymbolMove {
  readonly name: string;
  readonly from: string;
  readonly to: string;
}

export interface MovePlan {
  /** File moves, old path to new path (folders expanded by `planFromOptions`). */
  readonly files: Readonly<Record<string, string>>;
  readonly symbols: readonly SymbolMove[];
}

export interface MoveReport {
  readonly moved: string[];
  readonly rewrites: ImportRewrite[];
  readonly detachedExports: string[];
  readonly violations: BoundaryViolation[];
}

/**
 * Moves files or symbols to another layer, domain or package and rewrites every import in the
 * workspace to the specifier Sheriff expects, then lists each boundary the result still breaks.
 */
export function move(options: MoveOptions): Rule {
  return chain([
    (tree: Tree, context: SchematicContext) => {
      const plan = planFromOptions(tree, options);
      const report = performMove(tree, plan);
      log(context, report);
    },
    format(),
  ]);
}

export default move;

/** Turns the options into a plan: a folder move becomes one move per file under it. */
export function planFromOptions(tree: Tree, options: MoveOptions): MovePlan {
  const files: Record<string, string> = {};
  const symbols: SymbolMove[] = [];
  const add = (from: string, to: string) => {
    from = cleanPath(from);
    to = cleanPath(to);
    if (tree.exists(from)) {
      files[from] = to;
      return;
    }
    const dir = tree.getDir(from);
    if (dir.subfiles.length === 0 && dir.subdirs.length === 0) {
      throw new SchematicsException(`${from} does not exist.`);
    }
    dir.visit((path) => {
      const rel = cleanPath(path).slice(from.length + 1);
      files[cleanPath(path)] = posix.join(to, rel);
    });
  };
  if (options.manifest) {
    const manifest = readJson<{ files?: Record<string, string>; symbols?: SymbolMove[] }>(
      tree,
      cleanPath(options.manifest),
    );
    for (const [from, to] of Object.entries(manifest.files ?? {})) add(from, to);
    for (const s of manifest.symbols ?? [])
      symbols.push({ name: s.name, from: cleanPath(s.from), to: cleanPath(s.to) });
  }
  if (options.from && options.to) {
    if (options.symbol)
      symbols.push({
        name: options.symbol,
        from: cleanPath(options.from),
        to: cleanPath(options.to),
      });
    else add(options.from, options.to);
  } else if (options.from || options.to) {
    throw new SchematicsException('--from and --to go together.');
  }
  if (Object.keys(files).length === 0 && symbols.length === 0) {
    throw new SchematicsException('Nothing to move: give --from and --to, or --manifest.');
  }
  for (const [from, to] of Object.entries(files)) {
    if (tree.exists(to)) throw new SchematicsException(`${to} already exists (moving ${from}).`);
  }
  return { files, symbols };
}

/** Runs a plan against the tree. */
export function performMove(tree: Tree, plan: MovePlan): MoveReport {
  const ws = workspace(tree);
  const packages = workspacePackages(tree, ws);
  const tsws = loadTsWorkspace({ tree, ws, packages });
  const rules = readSheriffConfig(tree, ws);
  const affected = new Set<SourceFile>();
  const movedSymbols = new Map<string, SourceFile>();
  const moved: string[] = [];

  // Symbols first: a file move afterwards carries what was moved into it.
  for (const s of plan.symbols) {
    const source = tsws.project.getSourceFile('/' + s.from);
    if (!source)
      throw new SchematicsException(`${s.from} is not a TypeScript source in the workspace.`);
    const statement = exportedStatement(source, s.name);
    if (!statement) throw new SchematicsException(`${s.from} does not export "${s.name}".`);
    const target =
      tsws.project.getSourceFile('/' + s.to) ?? tsws.project.createSourceFile('/' + s.to, '');
    for (const ref of source.getReferencingSourceFiles()) affected.add(ref);
    const text = statement.getFullText().replace(/^\s*\n/, '');
    statement.remove();
    target.addStatements(text.trimEnd() + '\n');
    movedSymbols.set(s.name, target);
    affected.add(source);
    affected.add(target);
    moved.push(`${s.name}: ${s.from} → ${s.to}`);
  }
  for (const target of new Set(movedSymbols.values())) {
    target.fixMissingImports();
    const barrel = ensureBarrelExport(tsws, cleanPath(target.getFilePath()));
    if (barrel) affected.add(barrel);
  }
  for (const s of plan.symbols) {
    const source = tsws.project.getSourceFileOrThrow('/' + s.from);
    source.fixMissingImports();
    removeUnusedImports(source);
  }

  // Files: ts-morph moves a source and repoints the relative imports in it and in its importers.
  const exportedBefore = new Map<string, boolean>();
  for (const [from] of Object.entries(plan.files)) {
    if (!isSourceFile(from)) continue;
    const sf = tsws.project.getSourceFile('/' + from);
    if (!sf) continue;
    exportedBefore.set(from, barrelExportsFile(tsws, sf));
  }
  for (const [from, to] of Object.entries(plan.files)) {
    if (!isSourceFile(from)) continue;
    const sf = tsws.project.getSourceFile('/' + from);
    if (!sf) throw new SchematicsException(`${from} is not in the workspace's sources.`);
    for (const ref of sf.getReferencingSourceFiles()) affected.add(ref);
    affected.add(sf);
    // Importers that reached it through its old barrel lose the name once the barrel drops it.
    for (const [name] of sf.getExportedDeclarations()) movedSymbols.set(name, sf);
    sf.move('/' + to);
    moved.push(`${from} → ${to}`);
  }

  // Barrels: an export now pointing outside its own module is dropped (and reported); the module
  // a file moved into exports it, if the old one did.
  const detachedExports: string[] = [];
  for (const sf of [...affected]) {
    if (!isBarrel(sf)) continue;
    const barrelDir = posix.dirname(cleanPath(sf.getFilePath()));
    for (const exp of sf.getExportDeclarations()) {
      const target = exp.getModuleSpecifierSourceFile();
      if (!target) continue;
      const targetPath = cleanPath(target.getFilePath());
      if (targetPath === barrelDir + '/index.ts' || !targetPath.startsWith(barrelDir + '/')) {
        detachedExports.push(
          `${cleanPath(sf.getFilePath())}: export from '${exp.getModuleSpecifierValue()}' (now ${targetPath})`,
        );
        exp.remove();
      }
    }
    // A barrel left without statements stays a module.
    if (sf.getStatements().length === 0) sf.addStatements('export {};');
  }
  for (const [from, to] of Object.entries(plan.files)) {
    if (!exportedBefore.get(from)) continue;
    const barrel = ensureBarrelExport(tsws, to);
    if (barrel) affected.add(barrel);
  }

  // Every import in the workspace to the specifier Sheriff expects; only what differs is touched.
  const rewrites: ImportRewrite[] = [];
  for (const sf of tsws.project.getSourceFiles()) {
    if (!isConverted(tsws, sf.getFilePath())) continue;
    const changes = normalizeImports(tsws, sf, { movedSymbols });
    if (changes.length > 0) {
      rewrites.push(...changes);
      affected.add(sf);
    }
  }

  const violations: BoundaryViolation[] = [];
  for (const sf of affected) {
    if (tsws.project.getSourceFile(sf.getFilePath()) && isConverted(tsws, sf.getFilePath())) {
      violations.push(...checkBoundaries(tsws, rules, sf));
    }
  }

  commitTsWorkspace(tsws);
  for (const [from, to] of Object.entries(plan.files)) {
    if (isSourceFile(from) || !tree.exists(from)) continue;
    tree.rename(from, to);
    moved.push(`${from} → ${to}`);
  }
  return { moved, rewrites, detachedExports, violations };
}

/**
 * Makes the barrel of the module a file sits in star-export the file (unless the file is the barrel,
 * or the module has no barrel). Returns the barrel when it changed.
 */
function ensureBarrelExport(tsws: TsWorkspace, path: string): SourceFile | undefined {
  const module = moduleOf(tsws, path);
  const barrel = tsws.project.getSourceFile(`/${module.dir}/index.ts`);
  if (!barrel || cleanPath(barrel.getFilePath()) === path) return undefined;
  let rel = posix.relative(module.dir, path).replace(/\.(m|c)?ts$/, '');
  if (rel.endsWith('/index')) rel = rel.slice(0, -'/index'.length);
  const specifier = rel.startsWith('.') ? rel : `./${rel}`;
  if (barrel.getExportDeclarations().some((e) => e.getModuleSpecifierValue() === specifier))
    return undefined;
  for (const statement of barrel.getStatements()) {
    if (statement.getText().replace(/\s/g, '') === 'export{};') statement.remove();
  }
  barrel.addExportDeclaration({ moduleSpecifier: specifier });
  return barrel;
}

/** The top-level statement that declares an exported name. */
function exportedStatement(file: SourceFile, name: string): Statement | undefined {
  const decls = file.getExportedDeclarations().get(name);
  for (const decl of decls ?? []) {
    if (decl.getSourceFile() !== file) continue;
    const statement =
      decl.getKind() === SyntaxKind.VariableDeclaration
        ? decl.getFirstAncestorByKind(SyntaxKind.VariableStatement)
        : (decl as unknown as Statement);
    if (statement && statement.getParent() === file) return statement;
  }
  return undefined;
}

/** Drops named imports nothing in the file refers to any more, and import declarations left empty. */
function removeUnusedImports(file: SourceFile): void {
  for (const decl of file.getImportDeclarations()) {
    for (const named of decl.getNamedImports()) {
      const id = named.getAliasNode() ?? named.getNameNode();
      if (!Node.isIdentifier(id)) continue;
      const used = id
        .findReferencesAsNodes()
        .some((n: Node) => n.getSourceFile() === file && n !== id);
      if (!used) named.remove();
    }
    if (
      decl.getNamedImports().length === 0 &&
      !decl.getDefaultImport() &&
      !decl.getNamespaceImport()
    )
      decl.remove();
  }
}

function isBarrel(sf: SourceFile): boolean {
  return posix.basename(cleanPath(sf.getFilePath())) === 'index.ts';
}

/** Whether the file's module barrel star-exports it. */
function barrelExportsFile(tsws: TsWorkspace, sf: SourceFile): boolean {
  const path = cleanPath(sf.getFilePath());
  const module = moduleOf(tsws, path);
  const barrel = tsws.project.getSourceFile(`/${module.dir}/index.ts`);
  if (!barrel || barrel === sf) return false;
  return barrel.getExportDeclarations().some((e) => e.getModuleSpecifierSourceFile() === sf);
}

function log(context: SchematicContext, report: MoveReport): void {
  context.logger.info(
    `Moved ${report.moved.length} file(s)/symbol(s); rewrote ${report.rewrites.length} import(s).`,
  );
  for (const d of report.detachedExports)
    context.logger.warn(`Dropped a barrel export that now points outside its module: ${d}`);
  if (report.violations.length > 0) {
    context.logger.warn(`${report.violations.length} boundary violation(s) to fix by hand:`);
    for (const v of report.violations) context.logger.warn(`  ${v.message}`);
  }
}
