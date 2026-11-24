// unkcore.dll (gecko/core, Rust): the browser's own back end, reached with js-ctypes.
//   call(cmd, args)   -> answered at once (settings, bookmarks, history: quick things)
//   submit(cmd, args) -> a promise; the work runs on a thread of its own (network, files, yt-dlp)
//   onEvent(fn)       -> what the core "emits" (settings, wallpapers-changed, download, store-progress…)
//   block(url, source, kind) -> the ad blocker's answer for one request
import { ctypes } from "resource://gre/modules/ctypes.sys.mjs";

const enc = new TextEncoder();
let lib = null;
let fns = null;
let worker = null;
let nextId = 1;
const waiting = new Map(); // id -> { resolve, reject }
const listeners = new Set();

function cstr(s) {
  const b = enc.encode(String(s ?? ""));
  const a = ctypes.uint8_t.array(b.length + 1)();
  for (let i = 0; i < b.length; i++) a[i] = b[i];
  a[b.length] = 0;
  return ctypes.cast(a.address(), ctypes.char.ptr);
}

function bytesOf(v) {
  if (!v) return null;
  const tag = Object.prototype.toString.call(v);
  if (tag === "[object ArrayBuffer]") return new Uint8Array(v);
  if (/^\[object (Uint8|Int8|Uint8Clamped)Array\]$/.test(tag)) return v;
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return null;
}


function take(p) {
  if (p.isNull()) return null;
  try {
    return p.readString();
  } finally {
    fns.free(p);
  }
}

function dispatchEvent(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.event === "__wake") return;
  if (msg.event === "__result") {
    const r = msg.payload;
    const w = waiting.get(r.id);
    if (!w) return;
    waiting.delete(r.id);
    "err" in r ? w.reject(r.err) : w.resolve(r.ok);
    return;
  }
  for (const fn of listeners) {
    try {
      fn(msg.event, msg.payload);
    } catch (e) {
      console.error(e);
    }
  }
}

export const Core = {
  dllPath: "",
  tmpDir: "",
  /** Loads the library and opens the profile; gives what the first window needs. */
  init(dllPath, dataDir) {
    if (lib) return null;
    this.dllPath = dllPath;
    this.tmpDir = PathUtils.join(dataDir, "tmp");
    lib = ctypes.open(dllPath);
    const charp = ctypes.char.ptr;
    const u8p = ctypes.uint8_t.ptr;
    fns = {
      init: lib.declare("unk_init", ctypes.default_abi, charp, charp),
      call: lib.declare("unk_call", ctypes.default_abi, charp, charp, charp, u8p, ctypes.size_t),
      submit: lib.declare("unk_submit", ctypes.default_abi, ctypes.void_t, ctypes.uint32_t, charp, charp, u8p, ctypes.size_t),
      free: lib.declare("unk_free", ctypes.default_abi, ctypes.void_t, charp),
      block: lib.declare("unk_block", ctypes.default_abi, ctypes.int32_t, charp, charp, charp),
      wake: lib.declare("unk_wake", ctypes.default_abi, ctypes.void_t),
      save: lib.declare("unk_save", ctypes.default_abi, ctypes.void_t),
    };
    const info = JSON.parse(take(fns.init(cstr(dataDir))) || "{}");
    // the events come through a worker that waits on them
    worker = new ChromeWorker("resource://unknowweb/CoreWorker.js");
    worker.onmessage = (e) => {
      for (const line of e.data) dispatchEvent(line);
    };
    worker.onerror = (e) => console.error("unkcore worker", e.message);
    worker.postMessage({ dll: dllPath });
    return info;
  },

  /** Answered at once: the value, or throws the core's error text. */
  call(cmd, args = {}) {
    const r = JSON.parse(take(fns.call(cstr(cmd), cstr(JSON.stringify(args ?? {})), ctypes.uint8_t.ptr(0), 0)) || '{"err":"no answer"}');
    if ("err" in r) throw r.err;
    return r.ok;
  },

  /** Run on a thread of the core's: a promise of the value. */
  async submit(cmd, args = {}, bytes = null) {
    const id = nextId++;
    const b = bytesOf(bytes);
    args = { ...(args ?? {}) };
    if (b) {
      // (a file's bytes go by way of a file: copying them through js-ctypes is slow)
      const f = PathUtils.join(this.tmpDir, `upload-${id}.bin`);
      await IOUtils.write(f, b);
      args.__bytesFile = f;
    }
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      fns.submit(id, cstr(cmd), cstr(JSON.stringify(args)), ctypes.uint8_t.ptr(0), 0);
    });
  },

  block(url, source, kind) {
    try {
      return fns.block(cstr(url), cstr(source), cstr(kind)) === 1;
    } catch {
      return false;
    }
  },

  onEvent(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  shutdown() {
    if (!lib) return;
    try {
      fns.save();
      worker?.postMessage({ stop: true });
      fns.wake();
      worker?.terminate();
    } catch {}
  },
};
