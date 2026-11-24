// Writes ui/shared/shortcuts.js (Settings → Phím tắt) from the commands in ui/js/commands.js:
// every command that has a key list and is not hidden, with its label and default keys.
//   node scripts/gen-shortcuts.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'ui/js/commands.js'), 'utf8');
const body = src.slice(src.indexOf('export const COMMANDS = {'), src.indexOf('\n};', src.indexOf('export const COMMANDS = {')));
const out = {};
for (const line of body.split('\n')) {
  const m = /^\s{2}(?:'([\w.]+)'|(\w+)):\s*\{(.*)\},?\s*$/.exec(line);
  if (!m) continue;
  const id = m[1] || m[2];
  const rest = m[3];
  if (/hidden:\s*true/.test(rest)) continue;
  const label = /label:\s*'([^']*)'/.exec(rest)?.[1];
  const keys = /keys:\s*\[([^\]]*)\]/.exec(rest);
  if (!label || !keys) continue;
  out[id] = { label, keys: [...keys[1].matchAll(/'([^']+)'/g)].map((k) => k[1]) };
}
fs.writeFileSync(path.join(root, 'ui/shared/shortcuts.js'), `// The browser's commands and their default keys, for Settings → Phím tắt (generated from ui/js/commands.js\n// by scripts/gen-shortcuts.mjs).\nexport const SHORTCUTS = ${JSON.stringify(out, null, 1)};\n`);
console.log(Object.keys(out).length, 'commands');
