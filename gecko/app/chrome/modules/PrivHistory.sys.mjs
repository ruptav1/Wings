// Lịch sử cửa sổ InPrivate (Settings → Ẩn danh; off until switched on): the pages InPrivate windows
// open, kept in private-history.dat (in the profile's unk folder) in a form nothing can read:
//  - its first line (the keys) is sealed with Windows' own keys for this Windows account (DPAPI, by
//    the core: store.rs's secret.rs): copied to another account or computer, nothing in it opens;
//  - each line after it holds visits encrypted for a key pair (X25519, a new exchange per line,
//    then HKDF and AES-256-GCM), so pages are written down without the key that reads them;
//  - that reading key is encrypted too: with the PIN when one is set (4 or 6 digits, stretched by
//    PBKDF2-SHA256), else with a key kept in the sealed first line.
// Lịch sử → Ẩn danh asks for the PIN; the reading key then stays in memory for that page only,
// until it is closed, goes elsewhere or is left alone for 5 minutes (the page locks itself when
// hidden too). Each time it is read, what was written since joins the rest in one line again.
// Five wrong PINs in a row and it waits (30 s, then twice as long each time). Changing or removing
// the PIN takes the one set; a forgotten PIN cannot be got back: the history can only be deleted.
// (TyranWeb keeps its own the same way: src/main/privhistory.js.)
import { Core } from "resource://unknowweb/Core.sys.mjs";
import * as HQ from "resource://unknowweb/HistQuery.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setInterval: "resource://gre/modules/Timer.sys.mjs",
});

const INFO = new TextEncoder().encode("Wings private history 1");
const PBKDF2_ROUNDS = 600000;
const IDLE = 5 * 60 * 1000;
const MERGE_WINDOW = 10 * 60 * 1000;
const MAX_VISITS = 20000;
const PIN = /^(\d{4}|\d{6})$/;
const TRIES = 5;

const enc = new TextEncoder();
const dec = new TextDecoder();
const cryptoOf = () => globalThis.crypto ?? Services.appShell.hiddenDOMWindow.crypto;
const subtle = () => cryptoOf().subtle;
const rand = (n) => cryptoOf().getRandomValues(new Uint8Array(n));
const unb64 = (s) => Uint8Array.fromBase64(String(s || ""));
const uid = () => "p" + Array.from(rand(6), (b) => b.toString(16).padStart(2, "0")).join("");
const iconOf = (f) => (typeof f === "string" && f.length <= 20000 ? f : "");
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

let file = "";
const FILE = () => (file ||= PathUtils.join(PathUtils.parent(Core.tmpDir), "private-history.dat"));

let head = null; // the first line, unsealed: { v, pub, pin, iv, key, salt | plain }
let headLine = ""; // ...as it is in the file
let broken = false; // the first line does not open (another Windows account or computer)
let pub = null; // the key pair's public half (CryptoKey), the lines are encrypted for
let pubRaw = null;
let visits = null; // the history read, while a page has it open...
let index = null; // ...by id
const open = new Map(); // the pages that have it open (inner window id) -> { at, win }
let recent = []; // visits written this run: { id, url, time } (repeats merged, titles and icons)
let pending = []; // records not written yet (titles and icons come in bursts)
let timer = null;
let fails = 0;
let waitUntil = 0;
let recordingOn = false;
let onChange = () => {};

// (one file operation at a time: appends, rewrites and the PIN's changes never interleave)
let chain = Promise.resolve();
function serial(fn) {
  const p = chain.then(fn);
  chain = p.catch(() => {});
  return p;
}

// ---------------------------------------------------------------- the file's first line
async function firstLine() {
  try {
    const bytes = await IOUtils.read(FILE(), { maxBytes: 64 * 1024 });
    const s = dec.decode(bytes);
    const i = s.indexOf("\n");
    return i < 0 ? s : s.slice(0, i);
  } catch {
    return null;
  }
}

const sealHead = (h) => Core.call("dpapi_protect", { data: enc.encode(JSON.stringify(h)).toBase64() });

async function usePub(raw) {
  pubRaw = unb64(raw);
  pub = await subtle().importKey("raw", pubRaw, { name: "X25519" }, true, []);
}

async function loadHead() {
  if (head || broken) return head;
  const line = await firstLine();
  if (!line || !line.trim()) return null; // (nothing kept yet)
  try {
    head = JSON.parse(dec.decode(unb64(Core.call("dpapi_unprotect", { data: line.trim() }))));
    headLine = line.trim();
    await usePub(head.pub);
  } catch {
    head = null;
    broken = true;
  }
  return head;
}

function pinKey(pin, salt) {
  return subtle()
    .importKey("raw", enc.encode(String(pin)), "PBKDF2", false, ["deriveKey"])
    .then((base) => subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ROUNDS }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
}

// The reading key encrypted with an AES key (from the PIN, or one kept beside it in the sealed line).
async function wrapWith(key, aes, extra) {
  const pk = new Uint8Array(await subtle().exportKey("pkcs8", key));
  const iv = rand(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, aes, pk));
  return { iv: iv.toBase64(), key: ct.toBase64(), ...extra };
}
async function wrap(key, pin) {
  if (!pin) {
    const plain = rand(32);
    return wrapWith(key, await subtle().importKey("raw", plain, "AES-GCM", false, ["encrypt"]), { pin: 0, plain: plain.toBase64() });
  }
  const salt = rand(16);
  return wrapWith(key, await pinKey(pin, salt), { pin: pin.length, salt: salt.toBase64() });
}
// (throws for a wrong PIN: the tag does not match)
async function unwrap(h, pin) {
  const aes = h.pin ? await pinKey(pin, unb64(h.salt)) : await subtle().importKey("raw", unb64(h.plain), "AES-GCM", false, ["decrypt"]);
  const pk = await subtle().decrypt({ name: "AES-GCM", iv: unb64(h.iv) }, aes, unb64(h.key));
  return subtle().importKey("pkcs8", pk, { name: "X25519" }, true, ["deriveBits"]);
}

// A first line for a new key pair, no PIN yet.
async function createHead() {
  const pair = await subtle().generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const raw = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
  const h = { v: 1, pub: raw.toBase64(), ...(await wrap(pair.privateKey, null)) };
  const line = sealHead(h);
  await IOUtils.writeUTF8(FILE(), line + "\n", { tmpPath: FILE() + ".tmp" });
  head = h;
  headLine = line;
  await usePub(h.pub);
  return h;
}

async function ensureHead() {
  if (await loadHead()) return head;
  if (broken) return null;
  try {
    return await createHead();
  } catch (e) {
    console.error("unknowweb: private history", e);
    return null;
  }
}

// ---------------------------------------------------------------- the lines of visits
async function lineKey(bits, epk, use) {
  const hk = await subtle().importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt: concat(epk, pubRaw), info: INFO }, hk, { name: "AES-GCM", length: 256 }, false, [use]);
}

// Records encrypted for the key pair: written without the key that reads them.
async function seal(records) {
  const eph = await subtle().generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const epk = new Uint8Array(await subtle().exportKey("raw", eph.publicKey));
  const k = await lineKey(await subtle().deriveBits({ name: "X25519", public: pub }, eph.privateKey, 256), epk, "encrypt");
  const iv = rand(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, k, enc.encode(JSON.stringify(records))));
  return concat(epk, iv, ct).toBase64();
}

async function unseal(line, key) {
  const b = unb64(line);
  if (b.length < 61) throw new Error("short");
  const epk = b.subarray(0, 32);
  const other = await subtle().importKey("raw", epk, { name: "X25519" }, false, []);
  const k = await lineKey(await subtle().deriveBits({ name: "X25519", public: other }, key, 256), epk, "decrypt");
  return JSON.parse(dec.decode(await subtle().decrypt({ name: "AES-GCM", iv: b.subarray(32, 44) }, k, b.subarray(44))));
}

// A record into the list read: a visit ('v') or what changed in one ('u': a title, an icon, a time).
function apply(r) {
  if (!r || typeof r !== "object") return;
  if (r.k === "v" && r.id && r.url) {
    if (index.has(r.id)) return;
    const v = { id: r.id, url: String(r.url), title: String(r.title || r.url), favicon: iconOf(r.favicon), time: Number(r.time) || 0 };
    visits.push(v);
    index.set(v.id, v);
  } else if (r.k === "u") {
    const v = index.get(r.id);
    if (!v) return;
    if (r.title) v.title = String(r.title);
    if (r.favicon) v.favicon = iconOf(r.favicon);
    if (r.time) v.time = Number(r.time);
  }
}

// What waits is written (inside a file operation already: flushNow; else flush, which takes its turn).
async function flushNow() {
  if (timer) lazy.clearTimeout(timer);
  timer = null;
  if (!pending.length || !head) return;
  const records = pending;
  pending = [];
  try {
    await IOUtils.writeUTF8(FILE(), (await seal(records)) + "\n", { mode: "appendOrCreate" });
  } catch (e) {
    console.error("unknowweb: private history", e); // (not written: lost, as an InPrivate page is anyway)
  }
}
const flush = () => serial(flushNow);

function queue(rec) {
  if (rec.k === "u") {
    const p = pending.find((x) => x.id === rec.id);
    if (p) {
      const { k, id, ...rest } = rec;
      Object.assign(p, rest);
    } else pending.push(rec);
  } else pending.push(rec);
  if (visits) {
    apply(rec);
    onChange();
  }
  if (!timer) timer = lazy.setTimeout(flush, 1500);
}

// Every visit read, in one line again (after deleting some, or when read and there were more lines).
async function writeAll() {
  if (!head) return;
  if (timer) lazy.clearTimeout(timer);
  timer = null;
  pending = []; // (already in the list)
  visits.sort((a, b) => a.time - b.time);
  if (visits.length > MAX_VISITS) for (const v of visits.splice(0, visits.length - MAX_VISITS)) index.delete(v.id);
  const body = visits.length ? (await seal(visits.map((v) => ({ k: "v", ...v })))) + "\n" : "";
  await IOUtils.writeUTF8(FILE(), headLine + "\n" + body, { tmpPath: FILE() + ".tmp" });
}

async function read(key) {
  let text = "";
  try {
    text = await IOUtils.readUTF8(FILE());
  } catch {
    /* nothing yet */
  }
  const lines = text.split("\n").slice(1).filter((l) => l.trim());
  visits = [];
  index = new Map();
  let bad = 0;
  for (const line of lines) {
    let records;
    try {
      records = await unseal(line.trim(), key);
    } catch {
      bad++;
      continue;
    }
    for (const r of Array.isArray(records) ? records : [records]) apply(r);
  }
  visits.sort((a, b) => a.time - b.time);
  if (lines.length > 1 || bad) await writeAll();
}

// ---------------------------------------------------------------- written by the InPrivate windows
async function add({ url, title, favicon } = {}) {
  if (!recordingOn || !/^https?:\/\//i.test(url || "")) return false;
  if (!(await ensureHead())) return false;
  const now = Date.now();
  const last = recent[recent.length - 1];
  if (last && last.url === url && now - last.time < MERGE_WINDOW) {
    last.time = now;
    queue({ k: "u", id: last.id, time: now, ...(title ? { title: String(title).slice(0, 500) } : {}), ...(favicon ? { favicon: iconOf(favicon) } : {}) });
  } else {
    const id = uid();
    recent.push({ id, url, time: now });
    if (recent.length > 300) recent.shift();
    queue({ k: "v", id, url: url.slice(0, 8192), title: String(title || url).slice(0, 500), favicon: iconOf(favicon), time: now });
  }
  return true;
}

function update({ url, title, favicon } = {}) {
  if (!recordingOn || !head || (!title && !favicon)) return false;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].url !== url) continue;
    queue({ k: "u", id: recent[i].id, ...(title ? { title: String(title).slice(0, 500) } : {}), ...(favicon ? { favicon: iconOf(favicon) } : {}) });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- the PIN
// The reading key for the PIN given, or why not: { ok, key } | { ok: false, wait, left }
async function verify(pin) {
  const h = await loadHead();
  if (!h) return { ok: true, key: null };
  if (!h.pin) return { ok: true, key: await unwrap(h) };
  if (waitUntil > Date.now()) return { ok: false, wait: waitUntil - Date.now(), left: 0 };
  try {
    if (typeof pin !== "string" || pin.length !== h.pin || !PIN.test(pin)) throw new Error("pin");
    const key = await unwrap(h, pin);
    fails = 0;
    waitUntil = 0;
    return { ok: true, key };
  } catch {
    fails++;
    if (fails >= TRIES) waitUntil = Date.now() + Math.min(15 * 60000, 30000 * 2 ** (fails - TRIES));
    return { ok: false, wait: Math.max(0, waitUntil - Date.now()), left: Math.max(0, TRIES - fails) };
  }
}

const answer = (r) => (r.ok ? { ok: true } : { ok: false, wait: r.wait || 0, left: r.left ?? 0 });

function lockAll() {
  for (const { win } of open.values()) {
    try {
      if (win && !win.closed && !Cu.isDeadWrapper(win)) win.dispatchEvent(new win.CustomEvent("unk-privhist-locked"));
    } catch {}
  }
  open.clear();
  visits = null;
  index = null;
}

export const PrivHistory = {
  /** Settings → Ẩn danh's switch, as the settings are now. */
  setRecording(on) {
    recordingOn = !!on;
  },
  set onChange(fn) {
    onChange = fn;
  },
  add,
  update,
  flush,

  async status(id) {
    const h = await loadHead();
    return { recording: recordingOn, available: true, kept: !!h, broken, pin: h?.pin || 0, open: open.has(id), wait: Math.max(0, waitUntil - Date.now()) };
  },

  // Settings → Ẩn danh: the PIN set is right (before a new one is asked for)
  async check(pin) {
    return answer(await verify(pin));
  },

  // A new PIN (null: none), the one set given first. Pages that have the history open lock.
  async setPin(current, next) {
    if (next !== null && (typeof next !== "string" || !PIN.test(next))) return { ok: false, bad: true };
    if (broken) return { ok: false, broken: true };
    const r = await verify(current);
    if (!r.ok) return answer(r);
    return serial(async () => {
      const h = head || (await createHead());
      const key = r.key || (await unwrap(h));
      const nh = { v: 1, pub: h.pub, ...(await wrap(key, next)) };
      await flushNow();
      const line = sealHead(nh);
      let rest = "";
      try {
        const text = await IOUtils.readUTF8(FILE());
        const i = text.indexOf("\n");
        rest = i < 0 ? "" : text.slice(i + 1);
      } catch {}
      await IOUtils.writeUTF8(FILE(), line + "\n" + rest, { tmpPath: FILE() + ".tmp" });
      head = nh;
      headLine = line;
      lockAll();
      return { ok: true, pin: nh.pin };
    });
  },

  // Forgotten PIN (or a file that does not open here): the history and the PIN deleted.
  reset() {
    return serial(async () => {
      lockAll();
      if (timer) lazy.clearTimeout(timer);
      timer = null;
      pending = [];
      recent = [];
      head = null;
      headLine = "";
      pub = pubRaw = null;
      broken = false;
      fails = 0;
      waitUntil = 0;
      for (const f of [FILE(), FILE() + ".tmp"]) await IOUtils.remove(f, { ignoreAbsent: true });
      onChange();
      return true;
    });
  },

  // ---- Lịch sử → Ẩn danh (each page by its inner window id, and its window to tell it when locked)
  async unlock(id, win, pin) {
    if (broken) return { ok: false, broken: true };
    const r = await verify(pin);
    if (!r.ok) return answer(r);
    if (!visits) {
      await serial(async () => {
        await flushNow(); // (what waits to be written goes in first)
        if (visits) return;
        if (r.key) await read(r.key);
        else {
          visits = [];
          index = new Map();
        }
      });
    }
    open.set(id, { at: Date.now(), win });
    try {
      win?.addEventListener("pagehide", () => PrivHistory.lock(id), { once: true });
    } catch {}
    return { ok: true };
  },

  lock(id) {
    open.delete(id);
    if (!open.size) {
      visits = null;
      index = null;
    }
    return true;
  },

  find(id, f) {
    need(id);
    return HQ.find(visits, f);
  },
  domains(id, f) {
    need(id);
    return HQ.domains(visits, f);
  },
  async removeWhere(id, f) {
    need(id);
    const { keep, removed } = HQ.without(visits, f);
    if (removed) {
      visits = keep;
      index = new Map(keep.map((v) => [v.id, v]));
      await serial(writeAll);
      onChange();
    }
    return removed;
  },
  async remove(id, ids) {
    need(id);
    const set = new Set(ids);
    const before = visits.length;
    visits = visits.filter((v) => !set.has(v.id));
    for (const x of set) index.delete(x);
    if (visits.length !== before) {
      await serial(writeAll);
      onChange();
    }
    return before - visits.length;
  },
};

function need(id) {
  const o = open.get(id);
  if (!o || !visits) throw "locked";
  o.at = Date.now();
}

// (what waits to be written goes in before the browser closes)
try {
  ChromeUtils.importESModule("resource://gre/modules/AsyncShutdown.sys.mjs").AsyncShutdown.quitApplicationGranted.addBlocker("Wings: private history", () => flush());
} catch {}

// (pages left open and alone lock)
lazy.setInterval(() => {
  for (const [id, o] of open) {
    if (Date.now() - o.at < IDLE) continue;
    PrivHistory.lock(id);
    try {
      if (o.win && !o.win.closed) o.win.dispatchEvent(new o.win.CustomEvent("unk-privhist-locked"));
    } catch {}
  }
}, 30000);
