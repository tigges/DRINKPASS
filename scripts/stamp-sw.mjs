// Writes the current file hashes into sw.js. Run after changing any app file: npm run stamp
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, manifest, stampBlock, STAMP } from './shell-files.mjs';

const path = join(root, 'sw.js'), src = readFileSync(path, 'utf8');
if (!STAMP.test(src)) { console.error('sw.js has no BUILD/FILES block to update.'); process.exit(1); }
const m = manifest();
writeFileSync(path, src.replace(STAMP, stampBlock(m)));
console.log(`Stamped sw.js: build ${m.build}, ${Object.keys(m.files).length} files.`);
