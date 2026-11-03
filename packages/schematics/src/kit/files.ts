import { template } from '@angular-devkit/core';
import { SchematicsException, type Tree } from '@angular-devkit/schematics';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import { join, relative } from 'node:path';

export interface GenerateFilesOptions {
  /** Replace files that already exist (default: refuse). */
  readonly overwrite?: boolean;
}

/**
 * Copies a template folder into the tree at `target`, substituting `vars`: in paths, `__key__`
 * becomes `vars.key` and a `.template` suffix is dropped; in content, `<%= expr %>` and the rest of
 * the devkit's template syntax. Every file is a template.
 */
export function generateFiles(
  tree: Tree,
  templatesDir: string,
  target: string,
  vars: Record<string, unknown>,
  options: GenerateFilesOptions = {},
): string[] {
  const written: string[] = [];
  for (const file of walk(templatesDir)) {
    const rel = relative(templatesDir, file).split(/[\\/]/).join('/');
    const path = posix.join(target, applyPathTemplate(rel, vars));
    const content = template(readFileSync(file, 'utf-8'), { fileName: file })(vars);
    if (tree.exists(path)) {
      if (!options.overwrite) throw new SchematicsException(`${path} already exists.`);
      tree.overwrite(path, content);
    } else {
      tree.create(path, content);
    }
    written.push(path);
  }
  return written;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

function applyPathTemplate(path: string, vars: Record<string, unknown>): string {
  return path
    .replace(/__([a-zA-Z0-9]+)__/g, (match, key: string) => {
      const value = vars[key];
      if (value === undefined)
        throw new SchematicsException(`No template variable "${key}" for ${path}.`);
      return String(value);
    })
    .replace(/\.template$/, '');
}
