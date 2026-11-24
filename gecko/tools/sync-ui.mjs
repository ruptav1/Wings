// Puts the interface (ui/, shared with the Tauri build) into the Gecko app: app/chrome/content/ui/,
// each page with bridge.js first (the Tauri API on Gecko), and unkcore.dll beside application.ini.
//   node gecko/tools/sync-ui.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const from = path.join(root, 'ui');
const app = path.join(root, 'gecko', 'app');
const to = path.join(app, 'chrome', 'content', 'ui');
const BRIDGE = '<script src="chrome://unknowweb/content/bridge.js"></script>';

fs.rmSync(to, { recursive: true, force: true });
let pages = 0;
let files = 0;
(function copy(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copy(s, d);
    else if (e.name === 'index.html') {
      let html = fs.readFileSync(s, 'utf8');
      // (first in <head>: before the modules that ask for window.__TAURI__)
      html = html.replace(/<head>(\s*)/i, (m, ws) => `<head>${ws}${BRIDGE}${ws}`);
      fs.writeFileSync(d, html);
      pages++;
    } else {
      fs.copyFileSync(s, d);
      files++;
    }
  }
})(from, to);

const dll = path.join(root, 'gecko', 'core', 'target', 'release', 'unkcore.dll');
const dst = path.join(app, 'unkcore.dll');
let dllNote = '';
if (fs.existsSync(dll)) {
  const same = fs.existsSync(dst) && fs.statSync(dst).size === fs.statSync(dll).size && fs.readFileSync(dst).equals(fs.readFileSync(dll));
  try {
    if (!same) fs.copyFileSync(dll, dst);
    dllNote = same ? ', unkcore.dll unchanged' : ', unkcore.dll';
  } catch (e) {
    dllNote = ', unkcore.dll NOT copied (the browser is running: close it first)';
  }
}
console.log(`ui -> ${path.relative(root, to)}: ${pages} pages, ${files} files${dllNote || ' (no unkcore.dll built yet)'}`);
