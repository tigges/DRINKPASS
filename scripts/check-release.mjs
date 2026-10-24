// Checks that sw.js lists every app file with its current hash and that its VERSION matches package.json.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, manifest, stampBlock } from './shell-files.mjs';

const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const problems = [];

const version = /var VERSION = '([^']+)'/.exec(sw)?.[1];
if (version !== pkg.version) problems.push(`sw.js VERSION is ${version}, package.json version is ${pkg.version}`);

const m = manifest();
if (!sw.includes(stampBlock(m))) problems.push('sw.js file hashes are out of date: run npm run stamp');

if (problems.length) { console.error(problems.map((p) => '- ' + p).join('\n')); process.exit(1); }
console.log(`Service worker ${version} (build ${m.build}) precaches all ${Object.keys(m.files).length} app files with matching hashes.`);
