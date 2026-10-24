// The files the service worker precaches, and the hashes it checks them against.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const root = fileURLToPath(new URL('..', import.meta.url));

export function shellFiles() {
  const files = ['index.html', 'manifest.webmanifest'];
  for (const dir of ['css', 'js', 'js/i18n', 'fonts', 'icons']) {
    for (const f of readdirSync(join(root, dir)).sort()) if (/\.(css|js|woff2|png)$/.test(f)) files.push(`${dir}/${f}`);
  }
  return files;
}

const sha = (data) => createHash('sha256').update(data).digest('hex');

/** File → first 16 hex digits of its SHA-256, plus a build id that changes whenever any file does. */
export function manifest() {
  const files = Object.fromEntries(shellFiles().map((f) => [f, sha(readFileSync(join(root, f))).slice(0, 16)]));
  return { files, build: sha(JSON.stringify(files)).slice(0, 8) };
}

export function stampBlock({ files, build }) {
  const lines = Object.entries(files).map(([f, h]) => `  '${f}': '${h}'`);
  return `var BUILD = '${build}';\nvar FILES = {\n${lines.join(',\n')}\n};`;
}

export const STAMP = /var BUILD = '[^']*';\nvar FILES = \{[\s\S]*?\n\};/;
