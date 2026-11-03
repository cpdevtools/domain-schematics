import type { Tree } from '@angular-devkit/schematics';

const EXPORT_LINE = /^export \* from ['"](.+)['"];?\s*$/;

/**
 * Adds `export * from '<specifier>';` to a barrel, keeping the star exports sorted, creating the
 * file when it is missing. Idempotent.
 */
export function addExport(tree: Tree, indexFile: string, specifier: string): void {
  const text = tree.exists(indexFile) ? tree.readText(indexFile) : '';
  const lines = text.split('\n');
  const specifiers = new Set<string>();
  const others: string[] = [];
  for (const line of lines) {
    const m = EXPORT_LINE.exec(line);
    if (m) specifiers.add(m[1]);
    else if (line.trim() !== '' && line.trim() !== 'export {};') others.push(line);
  }
  if (specifiers.has(specifier)) return;
  specifiers.add(specifier);
  write(tree, indexFile, others, specifiers);
}

/** Removes `export * from '<specifier>';` from a barrel, if present. */
export function removeExport(tree: Tree, indexFile: string, specifier: string): boolean {
  if (!tree.exists(indexFile)) return false;
  const lines = tree.readText(indexFile).split('\n');
  const specifiers = new Set<string>();
  const others: string[] = [];
  for (const line of lines) {
    const m = EXPORT_LINE.exec(line);
    if (m) specifiers.add(m[1]);
    else if (line.trim() !== '') others.push(line);
  }
  if (!specifiers.delete(specifier)) return false;
  write(tree, indexFile, others, specifiers);
  return true;
}

/** The specifiers a barrel star-exports. */
export function starExports(tree: Tree, indexFile: string): string[] {
  if (!tree.exists(indexFile)) return [];
  return tree
    .readText(indexFile)
    .split('\n')
    .map((line) => EXPORT_LINE.exec(line)?.[1])
    .filter((s): s is string => s !== undefined);
}

function write(tree: Tree, indexFile: string, others: string[], specifiers: Set<string>): void {
  const sorted = [...specifiers].sort((a, b) => a.localeCompare(b));
  const exportLines = sorted.map((s) => `export * from '${s}';`);
  const content = [...others, ...exportLines].join('\n') + '\n';
  if (tree.exists(indexFile)) tree.overwrite(indexFile, content);
  else tree.create(indexFile, content);
}
