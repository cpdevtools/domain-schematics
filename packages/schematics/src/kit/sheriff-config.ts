import { SchematicsException, type Tree } from '@angular-devkit/schematics';
import {
  type ArrayLiteralExpression,
  type Expression,
  type ObjectLiteralExpression,
  Project,
  type PropertyAssignment,
  type SourceFile,
  SyntaxKind,
  type VariableDeclaration,
} from 'ts-morph';
import type { DomainPackagesConfig } from './workspace';

/** What `sheriff.config.ts` declares, as the schematics read and change it. */
export interface SheriffModel {
  /** Each domain and the entry points it has (`domains`). */
  readonly domains: Readonly<Record<string, readonly string[]>>;
  /** Each domain's `feature` sub-modules (`featureModules`). */
  readonly featureModules: Readonly<Record<string, readonly string[]>>;
  /** The shared domains (`shared`). */
  readonly shared: readonly string[];
  /** The domains each domain may use (`uses`). */
  readonly uses: Readonly<Record<string, readonly string[]>>;
  /** `config.entryPoints`. */
  readonly entryPoints: Readonly<Record<string, string>>;
}

type RecordConst = 'domains' | 'featureModules' | 'uses';
type ListConst = 'shared';

/**
 * Edits `sheriff.config.ts` through its AST, touching only the initializer of what changes, so
 * comments and the rest of the file stay as they are. The file keeps its constants `domains`,
 * `featureModules`, `shared` and `uses`, and `entryPoints` in the config object; a constant that
 * is missing is added before the config when something is written to it.
 */
export class SheriffConfigEditor {
  private readonly project = new Project({
    useInMemoryFileSystem: true,
    skipFileDependencyResolution: true,
  });
  private readonly file: SourceFile;
  private changed = false;

  constructor(
    readonly path: string,
    text: string,
  ) {
    this.file = this.project.createSourceFile(path, text);
  }

  /** The current declarations. */
  get model(): SheriffModel {
    return {
      domains: this.readRecord('domains'),
      featureModules: this.readRecord('featureModules'),
      shared: this.readList('shared'),
      uses: this.readRecord('uses'),
      entryPoints: this.readEntryPoints(),
    };
  }

  get text(): string {
    return this.file.getFullText();
  }

  get dirty(): boolean {
    return this.changed;
  }

  /** Sets a domain's entry points (adds the domain if new). */
  setDomain(domain: string, entryPoints: readonly string[]): void {
    this.setRecordEntry('domains', domain, entryPoints);
  }

  /** Adds an entry point to a domain, in layer order. */
  addDomainEntryPoint(domain: string, entryPoint: string, order: readonly string[]): void {
    const current = this.model.domains[domain] ?? [];
    if (current.includes(entryPoint)) return;
    const next = [...current, entryPoint].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    this.setRecordEntry('domains', domain, next);
  }

  removeDomain(domain: string): void {
    this.removeRecordEntry('domains', domain);
    this.removeRecordEntry('featureModules', domain);
    this.removeRecordEntry('uses', domain);
    this.removeListItem('shared', domain);
  }

  addFeatureModule(domain: string, name: string): void {
    const current = this.model.featureModules[domain] ?? [];
    if (current.includes(name)) return;
    this.setRecordEntry('featureModules', domain, [...current, name]);
  }

  removeFeatureModule(domain: string, name: string): void {
    const current = this.model.featureModules[domain] ?? [];
    if (!current.includes(name)) return;
    const next = current.filter((n) => n !== name);
    if (next.length === 0) this.removeRecordEntry('featureModules', domain);
    else this.setRecordEntry('featureModules', domain, next);
  }

  addShared(domain: string): void {
    if (this.model.shared.includes(domain)) return;
    this.listLiteral('shared', true)!.addElement(quote(domain));
    this.changed = true;
  }

  addUses(domain: string, uses: string): void {
    const current = this.model.uses[domain] ?? [];
    if (current.includes(uses)) return;
    this.setRecordEntry('uses', domain, [...current, uses].sort());
  }

  setEntryPoint(name: string, path: string): void {
    const obj = this.entryPointsLiteral(true)!;
    const existing = findProperty(obj, name);
    if (existing) {
      if (existing.getInitializer()?.getText() === quote(path)) return;
      existing.setInitializer(quote(path));
    } else {
      obj.addPropertyAssignment({ name: keyText(name), initializer: quote(path) });
    }
    this.changed = true;
  }

  private readRecord(name: RecordConst): Record<string, string[]> {
    const obj = this.recordLiteral(name, false);
    if (!obj) return {};
    const result: Record<string, string[]> = {};
    for (const prop of obj.getProperties()) {
      if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
      const pa = prop as PropertyAssignment;
      const init = unwrap(pa.getInitializer());
      if (!init || init.getKind() !== SyntaxKind.ArrayLiteralExpression) continue;
      result[propertyKey(pa)] = stringElements(init as ArrayLiteralExpression);
    }
    return result;
  }

  private readList(name: ListConst): string[] {
    const arr = this.listLiteral(name, false);
    return arr ? stringElements(arr) : [];
  }

  private readEntryPoints(): Record<string, string> {
    const obj = this.entryPointsLiteral(false);
    if (!obj) return {};
    const result: Record<string, string> = {};
    for (const prop of obj.getProperties()) {
      if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
      const pa = prop as PropertyAssignment;
      const init = pa.getInitializer();
      if (init && isStringLiteral(init)) result[propertyKey(pa)] = init.getLiteralText();
    }
    return result;
  }

  private setRecordEntry(name: RecordConst, key: string, values: readonly string[]): void {
    const obj = this.recordLiteral(name, true)!;
    const literal = `[${values.map(quote).join(', ')}]`;
    const existing = findProperty(obj, key);
    if (existing) {
      if (
        sameStrings(
          stringElements(unwrap(existing.getInitializer()) as ArrayLiteralExpression),
          values,
        )
      )
        return;
      existing.setInitializer(literal);
    } else {
      obj.addPropertyAssignment({ name: keyText(key), initializer: literal });
    }
    this.changed = true;
  }

  private removeRecordEntry(name: RecordConst, key: string): void {
    const obj = this.recordLiteral(name, false);
    const existing = obj && findProperty(obj, key);
    if (!existing) return;
    existing.remove();
    this.changed = true;
  }

  private removeListItem(name: ListConst, value: string): void {
    const arr = this.listLiteral(name, false);
    if (!arr) return;
    const index = arr
      .getElements()
      .findIndex((e) => isStringLiteral(e) && e.getLiteralText() === value);
    if (index === -1) return;
    arr.removeElement(index);
    this.changed = true;
  }

  private recordLiteral(name: string, create: boolean): ObjectLiteralExpression | undefined {
    const decl = this.constant(
      name,
      create ? `Record<string, readonly string[]>` : undefined,
      '{}',
    );
    const init = decl && unwrap(decl.getInitializer());
    if (!init) return undefined;
    if (init.getKind() !== SyntaxKind.ObjectLiteralExpression) {
      throw new SchematicsException(
        `${this.path}: \`${name}\` is not an object literal; edit it by hand.`,
      );
    }
    return init as ObjectLiteralExpression;
  }

  private listLiteral(name: string, create: boolean): ArrayLiteralExpression | undefined {
    const decl = this.constant(name, create ? `string[]` : undefined, '[]');
    const init = decl && unwrap(decl.getInitializer());
    if (!init) return undefined;
    if (init.getKind() !== SyntaxKind.ArrayLiteralExpression) {
      throw new SchematicsException(
        `${this.path}: \`${name}\` is not an array literal; edit it by hand.`,
      );
    }
    return init as ArrayLiteralExpression;
  }

  private constant(
    name: string,
    createWithType: string | undefined,
    initial: string,
  ): VariableDeclaration | undefined {
    const existing = this.file.getVariableDeclaration(name);
    if (existing || createWithType === undefined) return existing;
    const config = this.configStatement();
    const index = config ? config.getChildIndex() : this.file.getStatements().length;
    this.file.insertVariableStatement(index, {
      declarationKind: 'const' as never,
      declarations: [{ name, type: createWithType, initializer: initial }],
    });
    this.changed = true;
    return this.file.getVariableDeclarationOrThrow(name);
  }

  private configStatement() {
    const decl = this.configDeclaration();
    return decl?.getFirstAncestorByKind(SyntaxKind.VariableStatement);
  }

  /** The exported config: a variable whose initializer has `entryPoints` or `modules`. */
  private configDeclaration(): VariableDeclaration | undefined {
    for (const decl of this.file.getVariableDeclarations()) {
      const init = unwrap(decl.getInitializer());
      if (init?.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;
      const obj = init as ObjectLiteralExpression;
      if (
        findProperty(obj, 'entryPoints') ||
        findProperty(obj, 'modules') ||
        findProperty(obj, 'depRules')
      ) {
        return decl;
      }
    }
    return undefined;
  }

  private entryPointsLiteral(create: boolean): ObjectLiteralExpression | undefined {
    const decl = this.configDeclaration();
    if (!decl) {
      if (!create) return undefined;
      throw new SchematicsException(`${this.path}: no Sheriff config object found.`);
    }
    const obj = unwrap(decl.getInitializer()) as ObjectLiteralExpression;
    let prop = findProperty(obj, 'entryPoints');
    if (!prop) {
      if (!create) return undefined;
      prop = obj.insertPropertyAssignment(0, { name: 'entryPoints', initializer: '{}' });
      this.changed = true;
    }
    const init = unwrap(prop.getInitializer());
    if (init?.getKind() !== SyntaxKind.ObjectLiteralExpression) {
      throw new SchematicsException(
        `${this.path}: \`entryPoints\` is not an object literal; edit it by hand.`,
      );
    }
    return init as ObjectLiteralExpression;
  }
}

/** Opens the workspace's `sheriff.config.ts` for editing. */
export function openSheriffConfig(tree: Tree, ws: DomainPackagesConfig): SheriffConfigEditor {
  if (!tree.exists(ws.sheriffConfig)) {
    throw new SchematicsException(
      `${ws.sheriffConfig} does not exist. Run \`ng add @cpdevtools/schematics\` first.`,
    );
  }
  return new SheriffConfigEditor(ws.sheriffConfig, tree.readText(ws.sheriffConfig));
}

/** Reads the model without editing. */
export function readSheriffConfig(tree: Tree, ws: DomainPackagesConfig): SheriffModel {
  return openSheriffConfig(tree, ws).model;
}

/** Applies `edit` to the workspace's Sheriff config and writes it back if anything changed. */
export function editSheriffConfig(
  tree: Tree,
  ws: DomainPackagesConfig,
  edit: (editor: SheriffConfigEditor) => void,
): void {
  const editor = openSheriffConfig(tree, ws);
  edit(editor);
  if (editor.dirty) tree.overwrite(ws.sheriffConfig, editor.text);
}

function unwrap(expr: Expression | undefined): Expression | undefined {
  let current = expr;
  while (current) {
    const kind = current.getKind();
    if (kind === SyntaxKind.AsExpression || kind === SyntaxKind.SatisfiesExpression) {
      current = (current as unknown as { getExpression(): Expression }).getExpression();
    } else if (kind === SyntaxKind.ParenthesizedExpression) {
      current = (current as unknown as { getExpression(): Expression }).getExpression();
    } else {
      return current;
    }
  }
  return current;
}

function isStringLiteral(expr: Expression): expr is Expression & { getLiteralText(): string } {
  const kind = expr.getKind();
  return kind === SyntaxKind.StringLiteral || kind === SyntaxKind.NoSubstitutionTemplateLiteral;
}

function stringElements(arr: ArrayLiteralExpression): string[] {
  return arr
    .getElements()
    .filter(isStringLiteral)
    .map((e) => e.getLiteralText());
}

function propertyKey(pa: PropertyAssignment): string {
  const node = pa.getNameNode();
  const kind = node.getKind();
  if (kind === SyntaxKind.StringLiteral || kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return (node as unknown as { getLiteralText(): string }).getLiteralText();
  }
  return node.getText();
}

function findProperty(obj: ObjectLiteralExpression, key: string): PropertyAssignment | undefined {
  for (const prop of obj.getProperties()) {
    if (
      prop.getKind() === SyntaxKind.PropertyAssignment &&
      propertyKey(prop as PropertyAssignment) === key
    ) {
      return prop as PropertyAssignment;
    }
  }
  return undefined;
}

function keyText(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : quote(key);
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
