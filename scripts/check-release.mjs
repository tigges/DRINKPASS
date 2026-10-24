// Checks that the service worker precaches every app file and that its VERSION matches package.json.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const problems = [];

const version = /var VERSION = '([^']+)'/.exec(sw)?.[1];
if (version !== pkg.version) problems.push(`sw.js VERSION is ${version}, package.json version is ${pkg.version}`);

const shellSrc = /var SHELL = \[([\s\S]*?)\];/.exec(sw)?.[1] ?? '';
const shell = [...shellSrc.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
for (const f of shell) if (!existsSync(join(root, f))) problems.push(`sw.js precaches missing file ${f}`);

const appFiles = ['index.html', 'manifest.webmanifest'];
for (const dir of ['css', 'js', 'js/i18n', 'fonts', 'icons']) {
  for (const f of readdirSync(join(root, dir))) if (/\.(css|js|woff2|png)$/.test(f)) appFiles.push(`${dir}/${f}`);
}
for (const f of appFiles) if (!shell.includes(f)) problems.push(`sw.js does not precache ${f}`);

if (problems.length) { console.error(problems.map((p) => '- ' + p).join('\n')); process.exit(1); }
console.log(`Service worker ${version} precaches all ${shell.length} app files.`);
