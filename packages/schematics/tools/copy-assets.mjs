// Copies what tsc does not: the collection and schema JSON files, the migration manifest and every
// `files/` template folder, from src/ into dist/ at the same relative paths.
import { cpSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'src');
const dist = join(root, 'dist');

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const rel = relative(src, path);
    if (statSync(path).isDirectory()) {
      if (entry === 'files') {
        cpSync(path, join(dist, rel), { recursive: true });
      } else if (entry !== 'testing') {
        walk(path);
      }
    } else if (entry.endsWith('.json')) {
      mkdirSync(dirname(join(dist, rel)), { recursive: true });
      cpSync(path, join(dist, rel));
    }
  }
}

walk(src);
