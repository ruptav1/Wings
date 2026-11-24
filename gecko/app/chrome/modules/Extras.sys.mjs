// What came from TyranWeb on top of the browser: the mouse cursor (Settings → Giao diện → Con trỏ
// chuột), the user's own fonts (Phông chữ của bạn), Cloudflare WARP as the pages' way out.
import { Core } from "resource://unknowweb/Core.sys.mjs";

const dataDir = () => PathUtils.join(Services.dirsvc.get("ProfD", Ci.nsIFile).path, "unk");

function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function pickFiles(win, title, filters, multiple = false) {
  const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
  fp.init(win.browsingContext, title, multiple ? Ci.nsIFilePicker.modeOpenMultiple : Ci.nsIFilePicker.modeOpen);
  for (const [name, mask] of filters) fp.appendFilter(name, mask);
  const r = await new Promise((res) => fp.open(res));
  if (r !== Ci.nsIFilePicker.returnOK) return [];
  if (!multiple) return fp.file ? [fp.file.path] : [];
  return [...fp.files].map((f) => f.QueryInterface(Ci.nsIFile).path);
}

// ---------------------------------------------------------------- the mouse cursor
const CURSOR_FALLBACK = { arrow: "default", hand: "pointer", text: "text" };
const CURSOR_EXT = /\.(cur|ani|ico|png|svg|webp|gif)$/i;
const cursorDir = () => PathUtils.join(dataDir(), "cursors");
const svgUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, "%27")}")`;

// an arrow, the same arrow with a heart (links and buttons) and an I-beam, in each set's colours
function cursorSet(name) {
  const C = {
    sakura: ["#ffb3cc", "#e0718f", "#ffffff", "#ff5d8f"],
    night: ["#8f7cc9", "#3a2f5c", "#f1ecff", "#ffb3cc"],
    mint: ["#9ff0dc", "#3fb8a0", "#ffffff", "#ff7aa2"],
  }[name];
  if (!C) return null;
  const [a, b, line, heart] = C;
  const grad = `<defs><linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0.6" dy="1" stdDeviation="0.8" flood-opacity="0.35"/></filter></defs>`;
  const arrow = `<path d="M3.5 2.5v21l5.6-5.2 3.7 8.4 3.7-1.6-3.6-8.2h7.6z" fill="url(#g)" stroke="${line}" stroke-width="1.6" stroke-linejoin="round" filter="url(#s)"/>`;
  const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${grad}${body}</svg>`;
  const hand = svg(arrow + `<path d="M24.5 30s-6-3.6-6-7.4a3 3 0 0 1 6-.6 3 3 0 0 1 6 .6c0 3.8-6 7.4-6 7.4z" fill="${heart}" stroke="${line}" stroke-width="1.3" filter="url(#s)"/>`);
  const text = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${grad}<path d="M11 5.5h3.2c1 0 1.8.8 1.8 1.8 0-1 .8-1.8 1.8-1.8H21M16 7.3v17.4M11 26.5h3.2c1 0 1.8-.8 1.8-1.8 0 1 .8 1.8 1.8 1.8H21" fill="none" stroke="${line}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 5.5h3.2c1 0 1.8.8 1.8 1.8 0-1 .8-1.8 1.8-1.8H21M16 7.3v17.4M11 26.5h3.2c1 0 1.8-.8 1.8-1.8 0 1 .8 1.8 1.8 1.8H21" fill="none" stroke="${b}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return {
    arrow: { css: `${svgUrl(svg(arrow))} 4 3, default` },
    hand: { css: `${svgUrl(hand)} 4 3, pointer` },
    text: { css: `${svgUrl(text)} 16 16, text` },
  };
}

const u16 = (b, p) => b[p] | (b[p + 1] << 8);
const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
const ascii = (b, p, n) => String.fromCharCode(...b.subarray(p, p + n));

// one image of a .cur / .ico: its data URL and hotspot (an .ico's is its centre)
function icoFrame(buf) {
  if (buf.length < 22 || u16(buf, 0) !== 0 || ![1, 2].includes(u16(buf, 2))) return null;
  const w = buf[6] || 256;
  const h = buf[7] || 256;
  const cur = u16(buf, 2) === 2;
  return { url: `url("data:image/x-icon;base64,${b64(buf)}")`, x: cur ? u16(buf, 10) : Math.round(w / 2), y: cur ? u16(buf, 12) : Math.round(h / 2) };
}

// .ani (RIFF "ACON"): its frames, in the order of "seq " and for as long as "rate" says (1/60 s)
function aniFrames(buf) {
  if (ascii(buf, 0, 4) !== "RIFF" || ascii(buf, 8, 4) !== "ACON") return null;
  const icons = [];
  let rate = null;
  let seq = null;
  let jif = 10;
  const walk = (start, end) => {
    for (let p = start; p + 8 <= end; ) {
      const id = ascii(buf, p, 4);
      const size = u32(buf, p + 4);
      const body = p + 8;
      if (body + size > buf.length) break;
      if (id === "LIST") walk(body + 4, body + size);
      else if (id === "icon") icons.push(buf.subarray(body, body + size));
      else if (id === "anih" && size >= 36) jif = u32(buf, body + 28) || 10;
      else if (id === "rate") rate = Array.from({ length: size / 4 }, (_, i) => u32(buf, body + i * 4));
      else if (id === "seq ") seq = Array.from({ length: size / 4 }, (_, i) => u32(buf, body + i * 4));
      p = body + size + (size & 1);
    }
  };
  walk(12, buf.length);
  const frames = icons.map(icoFrame);
  if (!frames.length || frames.some((f) => !f)) return null;
  const order = (seq || frames.map((f, i) => i)).filter((i) => frames[i]).slice(0, 120);
  return order.map((i, step) => ({ ...frames[i], ms: Math.max(30, Math.round(((rate?.[step] ?? jif) * 1000) / 60)) }));
}

async function cursorFromFile(file, slot) {
  const fallback = CURSOR_FALLBACK[slot];
  let buf;
  try {
    buf = await IOUtils.read(PathUtils.join(cursorDir(), PathUtils.filename(String(file || ""))));
  } catch {
    return null;
  }
  const ext = (/\.[a-z0-9]+$/i.exec(file)?.[0] || "").toLowerCase();
  if (ext === ".ani") {
    const frames = aniFrames(buf);
    if (!frames) return null;
    const css = (f) => `${f.url} ${f.x} ${f.y}, ${fallback}`;
    return { css: css(frames[0]), frames: frames.length > 1 ? frames.map((f) => ({ css: css(f), ms: f.ms })) : null };
  }
  if (ext === ".cur" || ext === ".ico") {
    const f = icoFrame(buf);
    return f && { css: `${f.url} ${f.x} ${f.y}, ${fallback}` };
  }
  const type = { ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".gif": "image/gif" }[ext];
  let x = 0;
  let y = 0;
  if (slot === "text" && ext === ".png" && buf.length > 24) {
    const be = (p) => ((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) >>> 0;
    [x, y] = [Math.round(be(16) / 2), Math.round(be(20) / 2)];
  }
  return type ? { css: `url("data:${type};base64,${b64(buf)}") ${x} ${y}, ${fallback}` } : null;
}

/** What every page is given: null for Windows' own cursors, else the three slots. */
export async function cursorConfig(settings) {
  const c = settings?.appearance?.cursor || {};
  if (!c.set || c.set === "system") return null;
  const set = c.set === "custom" ? {} : cursorSet(c.set);
  if (!set) return null;
  if (c.set === "custom") for (const slot of ["arrow", "hand", "text"]) set[slot] = c[slot]?.file ? await cursorFromFile(c[slot].file, slot) : null;
  if (!set.arrow && !set.hand && !set.text) return null;
  return { ...set, pages: c.pages !== false };
}

export async function importCursor(win) {
  const [src] = await pickFiles(win, "Chọn con trỏ chuột", [["Con trỏ", "*.cur;*.ani;*.ico;*.png;*.svg;*.webp;*.gif"]]);
  if (!src || !CURSOR_EXT.test(src)) return null;
  const info = await IOUtils.stat(src);
  if (info.size > 2 * 1024 * 1024) throw "File con trỏ quá lớn (tối đa 2 MB)";
  await IOUtils.makeDirectory(cursorDir(), { ignoreExisting: true, createAncestors: true });
  const file = `cursor-${Date.now().toString(36)}${(/\.[a-z0-9]+$/i.exec(src)?.[0] || "").toLowerCase()}`;
  await IOUtils.copy(src, PathUtils.join(cursorDir(), file));
  if (!(await cursorFromFile(file, "arrow"))) {
    await IOUtils.remove(PathUtils.join(cursorDir(), file)).catch(() => {});
    throw "Không đọc được file con trỏ này";
  }
  return { file, name: PathUtils.filename(src) };
}

// ---------------------------------------------------------------- the user's own fonts
const FONT_EXT = /\.(ttf|otf|ttc|woff2?)$/i;
const fontDir = () => PathUtils.join(dataDir(), "fonts");

async function inflate(bytes) {
  const ds = new DecompressionStream("deflate");
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

// the tables of an sfnt font (the first of a collection), or of a WOFF (each zlib-compressed)
async function tables(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = ascii(buf, 0, 4);
  const out = {};
  if (tag === "wOFF") {
    const n = dv.getUint16(12);
    for (let i = 0; i < n; i++) {
      const p = 44 + i * 20;
      const t = ascii(buf, p, 4);
      const [off, comp, orig] = [dv.getUint32(p + 4), dv.getUint32(p + 8), dv.getUint32(p + 12)];
      out[t] = async () => {
        const raw = buf.subarray(off, off + comp);
        if (comp >= orig) return raw;
        // (without a decompressor here, the font is named after its file)
        if (typeof DecompressionStream === "undefined") throw new Error("no inflate");
        return inflate(raw);
      };
    }
    return out;
  }
  if (tag === "wOF2") return out;
  const base = tag === "ttcf" ? dv.getUint32(12) : 0;
  const n = dv.getUint16(base + 4);
  for (let i = 0; i < n; i++) {
    const p = base + 12 + i * 16;
    const t = ascii(buf, p, 4);
    const [off, len] = [dv.getUint32(p + 8), dv.getUint32(p + 12)];
    out[t] = async () => buf.subarray(off, off + len);
  }
  return out;
}

function nameOf(t, ids) {
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const count = dv.getUint16(2);
  const strings = dv.getUint16(4);
  const found = [];
  for (let i = 0; i < count; i++) {
    const p = 6 + i * 12;
    const [platform, , lang, id, len, off] = [0, 2, 4, 6, 8, 10].map((k) => dv.getUint16(p + k));
    if (!ids.includes(id)) continue;
    const raw = t.subarray(strings + off, strings + off + len);
    let s = "";
    if (platform === 3 || platform === 0) for (let k = 0; k + 1 < raw.length; k += 2) s += String.fromCharCode((raw[k] << 8) | raw[k + 1]);
    else if (platform === 1) s = String.fromCharCode(...raw);
    if (s.trim()) found.push({ s: s.trim(), rank: ids.indexOf(id) * 10 + (platform === 3 ? (lang === 0x409 ? 0 : 1) : 5) });
  }
  return found.sort((a, b) => a.rank - b.rank)[0]?.s || "";
}

async function readFont(file, buf) {
  const fromName = PathUtils.filename(file).replace(FONT_EXT, "").replace(/[-_]+/g, " ").replace(/\s+(regular|book|normal)$/i, "").trim();
  const info = { family: fromName, weight: 400, italic: /italic|oblique/i.test(file) };
  try {
    const t = await tables(buf);
    const family = t.name && nameOf(await t.name(), [16, 1]);
    if (family) info.family = family;
    const os2 = t["OS/2"] && (await t["OS/2"]());
    if (os2 && os2.length >= 64) {
      const dv = new DataView(os2.buffer, os2.byteOffset, os2.byteLength);
      info.weight = Math.min(900, Math.max(100, dv.getUint16(4) || 400));
      info.italic = !!(dv.getUint16(62) & 1);
    }
  } catch {}
  info.family = info.family.replace(/["\\]/g, "").slice(0, 80);
  return info;
}

async function sha10(bytes) {
  const h = Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);
  h.init(Ci.nsICryptoHash.SHA256);
  h.update(bytes, bytes.length);
  const d = h.finish(false);
  return [...d.slice(0, 5)].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}

/** Copies the font files picked; the fonts added are put in appearance.customFonts. */
export async function pickFonts(win, settings) {
  const files = await pickFiles(win, "Thêm phông chữ", [["Phông chữ", "*.ttf;*.otf;*.ttc;*.woff;*.woff2"]], true);
  if (!files.length) return [];
  await IOUtils.makeDirectory(fontDir(), { ignoreExisting: true, createAncestors: true });
  const have = Array.isArray(settings?.appearance?.customFonts) ? settings.appearance.customFonts : [];
  const added = [];
  for (const file of files) {
    if (!FONT_EXT.test(file)) continue;
    const st = await IOUtils.stat(file).catch(() => null);
    if (!st || st.size > 40 * 1024 * 1024) continue;
    const buf = await IOUtils.read(file);
    const ext = /\.[a-z0-9]+$/i.exec(file)[0].toLowerCase();
    const name = `${PathUtils.filename(file).replace(FONT_EXT, "").replace(/[^\w.-]+/g, "_").slice(0, 60)}-${await sha10(buf)}${ext}`;
    if (have.some((f) => f.file === name) || added.some((f) => f.file === name)) continue;
    await IOUtils.write(PathUtils.join(fontDir(), name), buf);
    added.push({ ...(await readFont(file, buf)), file: name });
  }
  if (added.length) Core.call("settings_set", { patch: { appearance: { customFonts: [...have, ...added] } } });
  return [...new Set(added.map((f) => f.family))];
}

export async function removeFontFamily(settings, family) {
  const list = Array.isArray(settings?.appearance?.customFonts) ? settings.appearance.customFonts : [];
  for (const f of list.filter((x) => x.family === family)) await IOUtils.remove(PathUtils.join(fontDir(), PathUtils.filename(f.file))).catch(() => {});
  const keep = list.filter((x) => x.family !== family);
  // (customFonts is a list: the whole list is put back)
  Core.call("settings_set", { patch: { appearance: { customFonts: keep } } });
  return keep;
}

export function fontsDirectory() {
  return fontDir();
}

// ---------------------------------------------------------------- Cloudflare WARP
let routedNow = false;
export const warpRouted = () => routedNow;

function setProxy(port) {
  const p = Services.prefs;
  if (port) {
    p.setIntPref("network.proxy.type", 1);
    p.setStringPref("network.proxy.socks", "127.0.0.1");
    p.setIntPref("network.proxy.socks_port", port);
    p.setIntPref("network.proxy.socks_version", 5);
    p.setBoolPref("network.proxy.socks_remote_dns", true);
    p.setStringPref("network.proxy.no_proxies_on", "localhost, 127.0.0.1, ::1");
    p.setStringPref("network.proxy.http", "");
    p.setStringPref("network.proxy.ssl", "");
  } else {
    p.setIntPref("network.proxy.type", 0);
  }
}

/** As the setting says: through WARP when it is on and WARP is ready (connected first if need be). */
export async function warpSync(on, emit) {
  let s = { installed: false };
  try {
    s = await Core.submit("warp_sync", { on: !!on });
  } catch {}
  const port = on && s.installed && s.proxy && s.connected ? s.port : 0;
  const was = routedNow;
  routedNow = !!port;
  setProxy(port);
  if (was !== routedNow) emit?.("warp-routed", routedNow);
  return s;
}

/** Where the pages come from now, as Cloudflare sees it: { ip, loc, warp } */
export async function warpWhere() {
  try {
    const res = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { cache: "no-store" });
    const text = await res.text();
    const get = (k) => new RegExp(`^${k}=(.*)$`, "m").exec(text)?.[1]?.trim() || "";
    return { ip: get("ip"), loc: get("loc"), warp: get("warp") };
  } catch {
    return null;
  }
}
