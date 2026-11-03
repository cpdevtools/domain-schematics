import type { Tree } from '@angular-devkit/schematics';
import { Project, type SourceFile, SyntaxKind, type ArrayLiteralExpression } from 'ts-morph';

/** Edits one TypeScript file through ts-morph and writes it back if its text changed. */
export function editTs(tree: Tree, path: string, edit: (file: SourceFile) => void): boolean {
  const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
  const before = tree.readText(path);
  const file = project.createSourceFile(path, before);
  edit(file);
  const after = file.getFullText();
  if (after === before) return false;
  tree.overwrite(path, after);
  return true;
}

/** Adds named imports from a specifier, merging into an existing declaration of that specifier. */
export function addNamedImport(file: SourceFile, specifier: string, names: string[]): void {
  const existing = file
    .getImportDeclarations()
    .find(
      (d) =>
        d.getModuleSpecifierValue() === specifier && !d.isTypeOnly() && !d.getNamespaceImport(),
    );
  if (existing) {
    const have = new Set(existing.getNamedImports().map((n) => n.getName()));
    for (const name of names) if (!have.has(name)) existing.addNamedImport(name);
    return;
  }
  const imports = file.getImportDeclarations();
  const index = imports.length > 0 ? imports[imports.length - 1].getChildIndex() + 1 : 0;
  file.insertImportDeclaration(index, { moduleSpecifier: specifier, namedImports: names });
}

/** The array literal an exported `const <name>` is initialized with, if it is one. */
export function exportedArray(file: SourceFile, name: string): ArrayLiteralExpression | undefined {
  const decl = file.getVariableDeclaration(name);
  const init = decl?.getInitializer();
  return init?.getKind() === SyntaxKind.ArrayLiteralExpression
    ? (init as ArrayLiteralExpression)
    : undefined;
}

/** The first exported `const` whose initializer is an array literal, if any. */
export function firstExportedArray(file: SourceFile): ArrayLiteralExpression | undefined {
  for (const decl of file.getVariableDeclarations()) {
    const init = decl.getInitializer();
    if (init?.getKind() === SyntaxKind.ArrayLiteralExpression && decl.isExported())
      return init as ArrayLiteralExpression;
  }
  return undefined;
}

/** The array a function returns (`return [ ... ]`), if it returns an array literal. */
export function returnedArray(
  file: SourceFile,
  functionName: string,
): ArrayLiteralExpression | undefined {
  const fn = file.getFunction(functionName);
  const ret = fn?.getStatements().find((s) => s.getKind() === SyntaxKind.ReturnStatement);
  const expr = ret?.getFirstChildByKind(SyntaxKind.ArrayLiteralExpression);
  return expr;
}

/** Adds an element to an array literal unless an element with the same text (whitespace aside) is there. */
export function addArrayElement(
  array: ArrayLiteralExpression,
  text: string,
  options: { before?: (elementText: string) => boolean } = {},
): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '');
  const elements = array.getElements();
  if (elements.some((e) => norm(e.getText()) === norm(text))) return false;
  const index = options.before ? elements.findIndex((e) => options.before!(e.getText())) : -1;
  if (index === -1) array.addElement(text);
  else array.insertElement(index, text);
  return true;
}
