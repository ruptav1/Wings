// Lists the interface's Vietnamese strings that ui/shared/en.json has no English for.
//   node scripts/missing-en.mjs [files...]   (default: every .js / .html under ui/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const en = JSON.parse(fs.readFileSync(path.join(root, 'ui/shared/en.json'), 'utf8'));
const VI = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(js|html)$/.test(e.name) ? [path.join(d, e.name)] : []));
const files = process.argv.slice(2).length ? process.argv.slice(2).map((f) => path.resolve(f)) : walk(path.join(root, 'ui'));
const found = new Map();
for (const f of files) {
  if (/en\.json|i18n\.js$/.test(f)) continue;
  // (comments out: they are notes, not interface text)
  const src = fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  const strs = [...src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|>([^<>{}\n]+)</g)].map((m) => m[1] ?? m[2] ?? m[3]);
  for (let s of strs) {
    s = s.trim();
    if (!s || !VI.test(s) || /\$\{/.test(s)) continue;
    // (a key hint after the words is translated with them: "Lịch sử (Ctrl+H)")
    const words = s.replace(/\s*\([^()]*\)$/, '');
    if (en[s] !== undefined || en[words] !== undefined) continue;
    if (!found.has(s)) found.set(s, path.relative(root, f));
  }
}
for (const [s, f] of found) console.log(JSON.stringify(s), '·', f);
console.error(found.size, 'missing');
