import { SchematicsException, type Tree } from '@angular-devkit/schematics';
import { parseJson, stringifyJson, updateJsonText } from '@cpdevtools/ts-dev-utilities/json';

/** Reads a JSON or JSONC file from the tree. Throws when it is missing. */
export function readJson<T = unknown>(tree: Tree, path: string): T {
  if (!tree.exists(path)) throw new SchematicsException(`${path} does not exist.`);
  return parseJson(tree.readText(path)) as T;
}

/** Reads a JSON or JSONC file from the tree, or `undefined` when it is missing. */
export function readJsonIfExists<T = unknown>(tree: Tree, path: string): T | undefined {
  return tree.exists(path) ? (parseJson(tree.readText(path)) as T) : undefined;
}

/**
 * Edits a JSON or JSONC file in place, keeping its comments, key order and formatting: `update`
 * mutates the value it is given or returns a new one.
 */
export function updateJson<T = Record<string, unknown>>(
  tree: Tree,
  path: string,
  update: (value: T) => T | void,
): void {
  if (!tree.exists(path)) throw new SchematicsException(`${path} does not exist.`);
  const before = tree.readText(path);
  const after = updateJsonText(before, update as (value: unknown) => unknown);
  if (after !== before) tree.overwrite(path, after);
}

/** Creates or replaces a JSON file. */
export function writeJson(tree: Tree, path: string, value: unknown): void {
  const text = stringifyJson(value);
  if (tree.exists(path)) tree.overwrite(path, text);
  else tree.create(path, text);
}

/** `updateJson` when the file exists, `writeJson(initial)` with the update applied when it does not. */
export function upsertJson<T extends object>(
  tree: Tree,
  path: string,
  initial: T,
  update: (value: T) => T | void,
): void {
  if (tree.exists(path)) {
    updateJson<T>(tree, path, update);
  } else {
    const value = update(initial) ?? initial;
    writeJson(tree, path, value);
  }
}
