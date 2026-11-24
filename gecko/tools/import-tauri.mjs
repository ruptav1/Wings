// Brings the Tauri build's data (profile\) into the Gecko build's profile (gecko\profile\unk): settings,
// bookmarks, history, notes, downloads list, open tabs, wallpapers (hard links: no second copy on the
// disk) and yt-dlp. What the Gecko profile already has of the user's own is kept (newer).
//   node gecko/tools/import-tauri.mjs [--keep-look]   (--keep-look: the Gecko profile's wallpaper and colours win)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const from = path.join(root, 'profile');
const to = path.join(root, 'gecko', 'profile', 'unk');
const keepLook = process.argv.includes('--keep-look');
// (pages opened while the Gecko build was being tested: not the user's)
const TEST = /^https?:\/\/(example\.(com|org|net)|www\.w3\.org\/WAI\/ER\/tests|codeload\.github\.com|vnexpress\.net)|jNQXAC9IVRw|uEj7cMB5WqI/;

const read = (p, d) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return d;
  }
};
const write = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v));
};
const wallUrl = (s) => s.split('http://unk.localhost/wall/').join('resource://unkwall/');

if (!fs.existsSync(path.join(from, 'data'))) {
  console.log('no Tauri profile at', from);
  process.exit(0);
}
fs.mkdirSync(path.join(to, 'data'), { recursive: true });
const D = (n) => path.join(to, 'data', n);
const T = (n) => path.join(from, 'data', n);

// settings: the Tauri build's, its wallpaper addresses made Gecko's
const ts = JSON.parse(wallUrl(fs.readFileSync(T('settings.json'), 'utf8')));
const gs = read(D('settings.json'), null);
if (keepLook && gs) {
  ts.wallpaper = gs.wallpaper;
  ts.appearance = gs.appearance;
}
write(D('settings.json'), ts);

for (const n of ['bookmarks.json', 'notes.json', 'downloads.json']) if (fs.existsSync(T(n))) fs.copyFileSync(T(n), D(n));

// history: both, by time
const th = read(T('history.json'), []);
const gh = read(D('history.json'), []).filter((v) => !TEST.test(v.url));
const seen = new Set();
const hist = [...th, ...gh]
  .sort((a, b) => a.ts - b.ts)
  .filter((v) => {
    const k = `${v.url} ${v.ts}`;
    return !seen.has(k) && seen.add(k);
  });
write(D('history.json'), hist);

// the open tabs: the Tauri window's, then the user's own from the Gecko test window
const tsn = read(T('sessions.json'), { windows: {}, closed: [] });
const gsn = read(D('sessions.json'), { windows: {}, closed: [] });
const twins = Object.values(tsn.windows || {});
const extra = Object.values(gsn.windows || {})
  .flatMap((w) => w.tabs || [])
  .filter((t) => /^https?:/.test(t.url) && !TEST.test(t.url));
const first = twins[0] || { tabs: [], active: 0 };
for (const t of extra) if (!first.tabs.some((x) => x.url === t.url)) first.tabs.push(t);
const windows = {};
[first, ...twins.slice(1)].forEach((w, i) => (windows[`win-${i + 1}`] = w));
write(D('sessions.json'), { windows, closed: tsn.closed || [] });

// wallpapers and their index; yt-dlp
function link(src, dst) {
  if (fs.existsSync(dst)) return 0;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    fs.linkSync(src, dst);
  } catch {
    fs.copyFileSync(src, dst);
  }
  return 1;
}
let walls = 0;
const tw = path.join(from, 'wallpapers');
const gw = path.join(to, 'wallpapers');
for (const sub of ['', 'thumbs']) {
  const dir = path.join(tw, sub);
  if (!fs.existsSync(dir)) continue;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isFile() && e.name !== 'index.json') walls += link(path.join(dir, e.name), path.join(gw, sub, e.name));
}
write(path.join(gw, 'index.json'), { ...read(path.join(tw, 'index.json'), {}), ...read(path.join(gw, 'index.json'), {}) });
let tools = 0;
for (const n of ['yt-dlp.exe', 'yt-dlp.checked']) if (fs.existsSync(path.join(from, 'tools', n))) tools += link(path.join(from, 'tools', n), path.join(to, 'tools', n));

console.log(`imported: settings, bookmarks, ${hist.length} history entries, ${first.tabs.length} tabs, ${walls} wallpaper files, ${tools} tools`);
