// Unknow Web Browser's main-process side on the Gecko core. The interface (ui/, the same files as the
// Tauri build) talks to it through bridge.js, which gives it the Tauri API it was written against:
//   invoke(cmd, args)  -> a window or tab thing done here (TabHost), or the Rust core (unkcore.dll)
//   listen(event, cb)  -> the same events with the same payloads ("tab", "settings", "download"…)
// Here too: Shields on the network (the ad blocker, tracking parameters, the store's referrers),
// the engine set up from the settings, downloads, permission prompts, the browser's windows.
import { Core } from "resource://unknowweb/Core.sys.mjs";
import { TabHost, toReal, toDisplay, isInternal } from "resource://unknowweb/TabHost.sys.mjs";
import { answerPrompt } from "resource://unknowweb/actors/PromptParent.sys.mjs";
import * as Extras from "resource://unknowweb/Extras.sys.mjs";
import { initManga, scanManga, thumbsManga, startManga, cancelManga, isMangaId } from "resource://unknowweb/Manga.sys.mjs";
import { PrivHistory } from "resource://unknowweb/PrivHistory.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

export const SHELL_URL = "chrome://unknowweb/content/ui/index.html";
const TASKMGR_URL = "chrome://unknowweb/content/ui/pages/taskmgr/index.html";
const SYSTEM = () => Services.scriptSecurityManager.getSystemPrincipal();
const STORE_REFERERS = {
  "go.moewalls.com": "https://moewalls.com/",
  "moewalls.com": "https://moewalls.com/",
  "motionbgs.com": "https://motionbgs.com/",
  "go.wallpaperwaifu.com": "https://wallpaperwaifu.com/",
  "wallpaperwaifu.com": "https://wallpaperwaifu.com/",
  "w.wallhaven.cc": "https://wallhaven.cc/",
  // (Pixiv's pictures, in Tải từ đường dẫn)
  "i.pximg.net": "https://www.pixiv.net/",
};

let started = false;
let settings = null;
let engines = null;
let bookmarks = null;
let firstSession = null; // the windows of the last run, handed out at start
let winSeq = 0;
const windows = new Map(); // label -> { win, private, host, meta }
const listeners = new Set(); // { event, cb, win }
let keys = new Set(); // shortcuts the interface keeps while a page has the focus
let labels = {};
const shieldsCache = new Map(); // host -> { fp, lets } (until the settings change)
// tabs' back / forward lists kept (a tab asleep or closed, a tab on its way to another window)
const historyStash = new Map();
function stashHistory(key, h) {
  if (!key || !h) return;
  historyStash.delete(key);
  historyStash.set(key, h);
  if (historyStash.size > 600) historyStash.delete(historyStash.keys().next().value);
}
function historyFor(key) {
  if (!key) return null;
  // (a tab still open: its list now, copied; else the one kept)
  for (const w of windows.values()) {
    const t = w.host?.tabs.get(key);
    if (t) return w.host.collectHistory(t);
  }
  return historyStash.get(key) || null;
}

// ---------- events ----------
function emit(event, payload) {
  for (const l of [...listeners]) {
    if (l.event !== event) continue;
    try {
      if (Cu.isDeadWrapper(l.cb) || (l.win && (l.win.closed || Cu.isDeadWrapper(l.win)))) {
        listeners.delete(l);
        continue;
      }
      l.cb({ event, payload, id: 0 });
    } catch (e) {
      if (/dead object/.test(String(e))) listeners.delete(l);
      else console.error(`unknowweb: ${event} listener`, e);
    }
  }
}

function listen(event, cb, win) {
  const l = { event, cb, win };
  listeners.add(l);
  if (win && !win.__unkUnloadHooked) {
    win.__unkUnloadHooked = true;
    win.addEventListener(
      "unload",
      () => {
        for (const x of [...listeners]) if (x.win === win) listeners.delete(x);
      },
      { once: true }
    );
  }
  return () => listeners.delete(l);
}

// ---------- where a call comes from ----------
function contextOf(win) {
  if (win?.__unkLabel) return { shell: win, label: win.__unkLabel, host: win.__unkTabs, tab: null };
  // a browser page (unk://…) in a tab: its <browser> belongs to a shell window
  try {
    const b = win?.docShell?.chromeEventHandler;
    const shell = b?.documentGlobal;
    if (shell?.__unkLabel) return { shell, label: shell.__unkLabel, host: shell.__unkTabs, tab: shell.__unkTabs.idOf(b) };
  } catch {}
  return { shell: null, label: null, host: null, tab: null, win };
}

function anyShell() {
  for (const w of windows.values()) if (!w.win.closed && !w.private) return w;
  for (const w of windows.values()) if (!w.win.closed) return w;
  return null;
}

function hostOfTab(id, ctx) {
  if (ctx?.host?.tabs.has(id)) return ctx.host;
  for (const w of windows.values()) if (w.host?.tabs.has(id)) return w.host;
  throw "no tab";
}

// ---------- the engine, set from the settings ----------
function applyPrefs(s) {
  if (!s) return;
  PrivHistory.setRecording(!!s.privacy?.privateHistory); // (Settings → Ẩn danh: InPrivate windows' pages kept, encrypted)
  const p = s.privacy || {};
  const g = s.general || {};
  const a = s.appearance || {};
  const set = (k, v) => {
    try {
      if (typeof v === "boolean") Services.prefs.setBoolPref(k, v);
      else if (typeof v === "number") Services.prefs.setIntPref(k, v);
      else Services.prefs.setStringPref(k, v);
    } catch {}
  };
  set("privacy.donottrackheader.enabled", p.doNotTrack !== false);
  set("privacy.globalprivacycontrol.enabled", p.doNotTrack !== false);
  set("privacy.globalprivacycontrol.functionality.enabled", true);
  // HTTPS by default, back to http:// when a site has no HTTPS (Gecko's HTTPS-First)
  set("dom.security.https_first", p.httpsUpgrade !== false);
  set("dom.security.https_first_schemeless", p.httpsUpgrade !== false);
  // third-party cookies: blocked, or kept apart per site
  set("network.cookie.cookieBehavior", p.blockThirdPartyCookies !== false ? 1 : 5);
  set("privacy.fingerprintingProtection", p.fingerprint !== false);
  const mb = Math.min(4096, Math.max(50, Number(p.diskCacheMB) || 256));
  set("browser.cache.disk.smart_size.enabled", false);
  set("browser.cache.disk.capacity", mb * 1024);
  set("general.smoothScroll", g.smoothScrolling !== false);
  // the pages' light / dark: 0 dark, 1 light, 2 as Windows
  const scheme = a.pageScheme || "theme";
  set("layout.css.prefers-color-scheme.content-override", scheme === "light" ? 1 : scheme === "dark" ? 0 : scheme === "system" ? 2 : a.dark ? 0 : 1);
  const lang = g.language === "en" ? "en" : "vi";
  set("intl.accept_languages", lang === "en" ? "en-US, en, vi-VN, vi" : "vi-VN, vi, en-US, en");
  try {
    const dir = Core.call("download_dir");
    set("browser.download.dir", dir);
    set("browser.download.folderList", 2);
    set("browser.download.useDownloadDir", true);
  } catch {}
}

let cursorKey = "";
async function cursorChanged(s) {
  const key = JSON.stringify(s?.appearance?.cursor || null);
  if (key === cursorKey) return;
  cursorKey = key;
  const cfg = await Extras.cursorConfig(s).catch(() => null);
  try {
    Services.ppmm.sharedData.set("unk:cursor", cfg && cfg.pages ? { arrow: cfg.arrow?.css || "", hand: cfg.hand?.css || "", text: cfg.text?.css || "" } : null);
    Services.ppmm.sharedData.flush();
  } catch {}
  emit("cursor-changed", cfg);
}

function settingsChanged(s) {
  const prevWarp = !!settings?.privacy?.warp;
  if (!!s?.privacy?.warp !== prevWarp) Extras.warpSync(!!s.privacy.warp, emit);
  cursorChanged(s);
  settings = s;
  shieldsCache.clear();
  applyPrefs(s);
  try {
    Services.ppmm.sharedData.set("unk:shieldsVersion", Date.now());
  } catch {}
}

// ---------- Shields on the network ----------
const TYPE = Ci.nsIContentPolicy;
function kindOf(t) {
  switch (t) {
    case TYPE.TYPE_SCRIPT:
      return "script";
    case TYPE.TYPE_IMAGE:
    case TYPE.TYPE_IMAGESET:
      return "image";
    case TYPE.TYPE_STYLESHEET:
      return "stylesheet";
    case TYPE.TYPE_FONT:
      return "font";
    case TYPE.TYPE_MEDIA:
      return "media";
    case TYPE.TYPE_XMLHTTPREQUEST:
    case TYPE.TYPE_FETCH:
      return "xhr";
    case TYPE.TYPE_WEBSOCKET:
      return "websocket";
    case TYPE.TYPE_PING:
    case TYPE.TYPE_BEACON:
      return "ping";
    case TYPE.TYPE_SUBDOCUMENT:
      return "subdocument";
    case TYPE.TYPE_OBJECT:
      return "object";
    default:
      return "other";
  }
}

function classifyMedia(url, ct) {
  ct = (ct || "").toLowerCase();
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (url.includes("googlevideo.com/")) return null;
  if (ct.includes("mpegurl") || path.endsWith(".m3u8")) return "hls";
  if (ct.includes("mp2t") || path.endsWith(".ts") || path.endsWith(".m4s")) return null;
  if (ct.startsWith("video/") || [".mp4", ".webm", ".m4v", ".mov", ".mkv"].some((e) => path.endsWith(e))) return "video";
  if (ct.startsWith("audio/") || [".mp3", ".m4a", ".ogg", ".opus", ".flac", ".wav"].some((e) => path.endsWith(e))) return "audio";
  return null;
}

function tabOfChannel(li) {
  let bc = null;
  try {
    bc = li.browsingContext;
  } catch {}
  const top = bc?.top;
  const browser = top?.embedderElement;
  const host = browser?.documentGlobal?.__unkTabs;
  const t = host?.tabFor(browser) || null;
  return { bc, top, browser, host, t };
}

const lastBlockedEmit = new WeakMap();
const mediaSeen = new WeakMap(); // tab record -> Set of urls

const netObserver = {
  observe(subject, topic) {
    let ch;
    try {
      ch = subject.QueryInterface(Ci.nsIHttpChannel);
    } catch {
      return;
    }
    if (topic === "http-on-modify-request") this.request(ch);
    else this.response(ch);
  },

  request(ch) {
    const li = ch.loadInfo;
    if (!li) return;
    const url = ch.URI.spec;
    const type = li.externalContentPolicyType;
    const loader = li.loadingPrincipal || li.triggeringPrincipal;
    // the browser's own pages: the store's sites get the referrer they want
    if (loader?.isSystemPrincipal) {
      const host = ch.URI.host.replace(/^www\./, "");
      const ref = probeReferers.get(url) || STORE_REFERERS[host];
      if (ref) {
        try {
          ch.setRequestHeader("Referer", ref, false);
          ch.setRequestHeader("Origin", "", false);
        } catch {}
      }
      if (type !== TYPE.TYPE_DOCUMENT) return;
    }
    const { top, t, host } = tabOfChannel(li);
    if (!t) return;
    if (type === TYPE.TYPE_DOCUMENT) {
      // a tracker's bounce page skipped, tracking parameters taken off (Brave's lists)
      if (ch.requestMethod !== "GET") return;
      const from = t.browser.currentURI?.spec || "";
      try {
        const to = Core.call("nav_clean", { url, from, fromApp: !!li.triggeringPrincipal?.isSystemPrincipal });
        if (to && to !== url) {
          t.cleaned = true;
          ch.redirectTo(Services.io.newURI(to));
        }
      } catch {}
      return;
    }
    const page = top?.currentWindowGlobal?.documentURI?.spec || "";
    if (!/^https?:/.test(page) || !/^(https?|wss?):/.test(url)) return;
    if (Core.block(url, page, kindOf(type))) {
      ch.cancel(Cr.NS_ERROR_ABORT);
      t.blocked = (t.blocked || 0) + 1;
      const now = Date.now();
      if (now - (lastBlockedEmit.get(t) || 0) > 300) {
        lastBlockedEmit.set(t, now);
        host.emit(t, { blocked: t.blocked });
      }
    }
  },

  // videos and sounds the page loads (the media button on the toolbar)
  response(ch) {
    if (!(ch.responseStatus >= 200 && ch.responseStatus < 300)) return;
    const url = ch.URI.spec;
    let ct = "";
    try {
      ct = ch.contentType || ch.getResponseHeader("Content-Type");
    } catch {}
    const kind = classifyMedia(url, ct);
    if (!kind) return;
    const { t, host } = tabOfChannel(ch.loadInfo);
    if (!t) return;
    let seen = mediaSeen.get(t);
    if (!seen) mediaSeen.set(t, (seen = new Set()));
    const key = url.split("?")[0];
    if (seen.has(key)) return;
    seen.add(key);
    let size = -1;
    try {
      const range = ch.getResponseHeader("Content-Range");
      size = parseInt(range.split("/").pop(), 10);
    } catch {
      try {
        size = parseInt(ch.getResponseHeader("Content-Length"), 10);
      } catch {}
    }
    host.B.emit("media", { tab: t.id, url, kind, type: ct, size: Number.isFinite(size) ? size : -1, page: t.url });
  },
};

// the page script (fingerprinting protection + the site's scriptlets), asked by each new page window
function shieldsFor(url) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  let s = shieldsCache.get(host);
  if (!s) {
    try {
      const r = Core.call("page_shields", { url });
      s = { fp: r.fp || "", lets: r.lets || "", fpOn: !!r.fpOn };
    } catch {
      s = { fp: "", lets: "", fpOn: false };
    }
    if (shieldsCache.size > 300) shieldsCache.clear();
    shieldsCache.set(host, s);
  }
  return s;
}

const shieldsListener = {
  receiveMessage(m) {
    if (m.name !== "UnkWeb:Shields") return null;
    return shieldsFor(m.data.url);
  },
};

// ---------- downloads (Gecko's own) ----------
const dlIds = new WeakMap();
const dlById = new Map();
// (ids unique across runs: the kept list is keyed by them)
let dlSeq = Date.now();

function dlState(d) {
  if (d.succeeded) return "completed";
  if (d.canceled) return d.hasPartialData ? "paused" : "cancelled";
  if (d.error) return "interrupted";
  return "progressing";
}

function dlPayload(d) {
  let id = dlIds.get(d);
  if (!id) {
    id = dlSeq++;
    dlIds.set(d, id);
    dlById.set(id, d);
  }
  const path = d.target?.path || "";
  return {
    id,
    url: d.source?.url || "",
    path,
    file: PathUtils.filename(path || "download"),
    started: d.startTime ? new Date(d.startTime).getTime() : Date.now(),
    private: !!d.source?.isPrivate,
    state: dlState(d),
    received: d.currentBytes || 0,
    total: d.hasProgress ? d.totalBytes : -1,
  };
}

const dlView = {
  last: new WeakMap(),
  onDownloadAdded(d) {
    emit("download", dlPayload(d));
  },
  onDownloadChanged(d) {
    const p = dlPayload(d);
    if (p.state === "progressing") {
      const now = Date.now();
      if (now - (this.last.get(d) || 0) < 250) return;
      this.last.set(d, now);
    } else if (!this.last.get(d)?.ended) {
      p.ended = Date.now();
      this.last.set(d, { ended: true });
      if (!p.private) {
        try {
          Core.call("download_record", { item: p });
        } catch {}
      }
      // (Kiểm tra tệp tải về: a program, or an archive with one inside)
      if (p.state === "completed") Core.submit("scan_add", { item: p }).catch(() => {});
    }
    emit("download", p);
  },
  onDownloadRemoved() {},
};

// ---------- site permissions (the prompts under the address bar) ----------
const pendingPerms = new Map();
let permSeq = 1;
const PERM_KINDS = { geolocation: "geolocation", "desktop-notification": "notifications", "persistent-storage": "files", midi: "midi", "midi-sysex": "midi", "storage-access": "files" };

function originOf(principal) {
  try {
    return principal.originNoSuffix;
  } catch {
    return "";
  }
}

function permAsk({ origin, kind, browser, isPrivate, allow, deny }) {
  const saved = settings?.sitePermissions?.[origin]?.[kind];
  if (saved === "allow") return allow();
  if (saved === "deny") return deny();
  const host = browser?.documentGlobal?.__unkTabs;
  const t = host?.tabFor(browser);
  if (!t) return deny();
  const id = permSeq++;
  pendingPerms.set(id, { origin, kind, allow, deny, private: isPrivate });
  emit("perm", { id, tab: t.id, origin, kind, private: isPrivate });
}

const permissionPrompt = {
  QueryInterface: ChromeUtils.generateQI(["nsIContentPermissionPrompt"]),
  prompt(request) {
    const types = request.types.QueryInterface(Ci.nsIArray);
    const type = types.length ? types.queryElementAt(0, Ci.nsIContentPermissionType).type : "";
    const kind = PERM_KINDS[type];
    const browser = request.element;
    if (!kind) return request.cancel();
    permAsk({
      origin: originOf(request.principal),
      kind,
      browser,
      isPrivate: !!request.principal?.privateBrowsingId,
      allow: () => request.allow(),
      deny: () => request.cancel(),
    });
  },
};

function registerPermissionPrompt() {
  const reg = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
  const cid = Components.ID("{7b0e5c22-61c4-4c55-9a43-6a3c7f8f0d11}");
  const factory = {
    createInstance(iid) {
      return permissionPrompt.QueryInterface(iid);
    },
    QueryInterface: ChromeUtils.generateQI(["nsIFactory"]),
  };
  try {
    reg.registerFactory(cid, "Wings permission prompt", "@mozilla.org/content-permission/prompt;1", factory);
  } catch (e) {
    console.error("unknowweb: permission prompt", e);
  }
}

// camera and microphone (getUserMedia)
const gumObserver = {
  observe(subject, topic, data) {
    if (topic !== "getUserMedia:request") return;
    const req = subject;
    const callID = req.callID;
    const wg = WindowGlobalParent.getByInnerWindowId(req.innerWindowID);
    const browser = wg?.browsingContext?.top?.embedderElement;
    const origin = originOf(wg?.documentPrincipal);
    const kinds = [];
    if (req.constraints?.video || req.videoInputType) kinds.push("camera");
    if (req.constraints?.audio || req.audioInputType) kinds.push("microphone");
    const devices = [];
    try {
      const all = req.devices;
      for (let i = 0; i < all.length; i++) devices.push(all.queryElementAt(i, Ci.nsIMediaDevice));
    } catch {}
    const reply = (ok) => {
      if (!ok) return Services.obs.notifyObservers(null, "getUserMedia:response:deny", callID);
      const chosen = Cc["@mozilla.org/array;1"].createInstance(Ci.nsIMutableArray);
      const seen = new Set();
      for (const d of devices) {
        if (seen.has(d.type)) continue;
        seen.add(d.type);
        chosen.appendElement(d);
      }
      Services.obs.notifyObservers(chosen, "getUserMedia:response:allow", callID);
    };
    let left = kinds.length || 1;
    let allOk = true;
    for (const kind of kinds.length ? kinds : ["camera"]) {
      permAsk({
        origin,
        kind,
        browser,
        isPrivate: !!wg?.documentPrincipal?.privateBrowsingId,
        allow: () => --left === 0 && reply(allOk),
        deny: () => {
          allOk = false;
          if (--left === 0) reply(false);
        },
      });
    }
  },
};

// ---------- the windows ----------
function openWindow({ isPrivate = false, url = null, restore = null, adopt = null, historyFrom = null } = {}) {
  const label = `win-${++winSeq}`;
  windows.set(label, { win: null, private: isPrivate, host: null, meta: { restore, url, adopt, historyFrom } });
  const features = `chrome,dialog=no,all,resizable${isPrivate ? ",private" : ",non-private"}`;
  Services.ww.openWindow(null, SHELL_URL, label, features, null);
  return label;
}

function bounds(win) {
  // (a minimized window has no place of its own: Windows parks it at -32000; the last real one is kept)
  if (win.windowState === win.STATE_MINIMIZED || win.screenX <= -30000 || win.screenY <= -30000) return { ...(win.__unkNormal || {}), maximized: !!win.__unkWasMax };
  const max = win.windowState === win.STATE_MAXIMIZED;
  win.__unkWasMax = max;
  if (max) return { ...(win.__unkNormal || {}), maximized: true };
  win.__unkNormal = { x: win.screenX, y: win.screenY, w: win.outerWidth, h: win.outerHeight };
  return { ...win.__unkNormal, maximized: false };
}

/** Whether a window there would be seen (on one of the screens, not parked off them). */
function onScreen(x, y, w, h) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= -30000 || y <= -30000) return false;
  try {
    const sm = Cc["@mozilla.org/gfx/screenmanager;1"].getService(Ci.nsIScreenManager);
    const scr = sm.screenForRect(x, y, w, h);
    const L = {}, T = {}, W = {}, H = {};
    scr.GetAvailRectDisplayPix(L, T, W, H);
    const ix = Math.min(x + w, L.value + W.value) - Math.max(x, L.value);
    const iy = Math.min(y + h, T.value + H.value) - Math.max(y, T.value);
    return ix >= 120 && iy >= 60;
  } catch {
    return true;
  }
}

function placeWindow(win, b) {
  if (b?.w && b?.h) {
    const w = Math.max(480, b.w);
    const h = Math.max(360, b.h);
    win.resizeTo(w, h);
    if (onScreen(b.x, b.y, w, h)) win.moveTo(b.x, b.y);
    else win.moveTo(win.screen.availLeft + Math.max(0, (win.screen.availWidth - w) / 2), win.screen.availTop + Math.max(0, (win.screen.availHeight - h) / 2));
    win.__unkNormal = { x: win.screenX, y: win.screenY, w: win.outerWidth, h: win.outerHeight };
    if (b.maximized) win.maximize();
    return;
  }
  // a first window: most of the screen
  const sw = win.screen.availWidth;
  const sh = win.screen.availHeight;
  const w = Math.max(480, Math.min(1440, sw * 0.86));
  const h = Math.max(360, Math.min(940, sh * 0.88));
  win.resizeTo(w, h);
  win.moveTo(win.screen.availLeft + (sw - w) / 2, win.screen.availTop + (sh - h) / 2);
  if (b?.maximized || sw < 1100 || sh < 700) win.maximize();
}

// the taskbar: every window of the browser under one name of its own, so they group together and with the
// Start menu's Wings shortcut, which carries the same name - pinning a window then pins that shortcut (the
// launcher, with its icon), not the engine inside
const APP_USER_MODEL_ID = "Wings.Browser";
function taskbarIdentity(win) {
  try {
    const tb = Cc["@mozilla.org/windows-taskbar;1"].getService(Ci.nsIWinTaskbar);
    if (tb.available) tb.setGroupIdForWindow(win, APP_USER_MODEL_ID);
  } catch (e) {
    console.error("unknowweb: taskbar identity", e);
  }
}

function winInit(win) {
  taskbarIdentity(win);
  let label = win.name && windows.has(win.name) ? win.name : null;
  if (!label) {
    // the window Gecko opened at start: the last run's windows come back
    label = `win-${++winSeq}`;
    const isPrivate = PrivateBrowsingUtils.isWindowPrivate(win);
    windows.set(label, { win: null, private: isPrivate, host: null, meta: {} });
    if (!firstSession) {
      try {
        firstSession = Core.call("session_take");
      } catch {
        firstSession = { windows: [] };
      }
      const [first, ...rest] = firstSession.windows || [];
      windows.get(label).meta.restore = first || null;
      for (const s of rest) openWindow({ restore: s });
    }
  }
  const w = windows.get(label);
  // a page given on the command line (opened from another app, the browser set as the default one)
  const cli = urlOfCommandLine(win);
  if (cli && !w.meta.url) w.meta.url = cli;
  w.win = win;
  win.__unkLabel = label;
  win.name = label;
  w.host = new TabHost(win, label, w.private, Backend);
  hookWindow(win, w);
  const meta = w.meta || {};
  // (once the window is up: a maximize before that is lost)
  const place = () => placeWindow(win, meta.restore?.bounds);
  if (win.document.readyState === "complete") place();
  else win.addEventListener("load", () => win.setTimeout(place, 0), { once: true });
  let closed = [];
  try {
    closed = w.private ? [] : Core.call("session_closed") || [];
  } catch {}
  return {
    win: label,
    private: w.private,
    settings,
    engines,
    bookmarks: Core.call("bookmarks_get"),
    restore: meta.restore || null,
    url: meta.url || null,
    urlHistoryFrom: meta.historyFrom || null,
    adopt: meta.adopt || null,
    closed,
    maximized: win.windowState === win.STATE_MAXIMIZED,
  };
}

function urlOfCommandLine(win) {
  let cl = null;
  try {
    cl = win.arguments?.[0]?.QueryInterface?.(Ci.nsICommandLine);
  } catch {}
  if (!cl) return null;
  try {
    const flagged = cl.handleFlagWithParam("url", false);
    if (flagged) return cl.resolveURI(flagged).spec;
  } catch {}
  for (let i = 0; i < cl.length; i++) {
    const a = cl.getArgument(i);
    if (/^-/.test(a)) continue;
    if (/^(https?|file|ftp|data|view-source):/i.test(a)) return a;
    if (/\.(html?|xhtml|pdf|svg|xml|txt|png|jpe?g|gif|webp|mp4|webm)$/i.test(a)) {
      try {
        return cl.resolveURI(a).spec;
      } catch {}
    }
  }
  return null;
}

function hookWindow(win, w) {
  // pages that open windows: a new tab of this window (window.open, target=_blank)
  win.browserDOMWindow = browserDOMWindowFor(win, w);
  // the link under the pointer, and the pages' tooltips
  try {
    const aw = win.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIAppWindow);
    aw.XULBrowserWindow = {
      QueryInterface: ChromeUtils.generateQI(["nsIXULBrowserWindow"]),
      setOverLink(url) {
        const t = w.host.hover || [...w.host.tabs.values()].find((x) => x.shown);
        // (a link to one of the browser's own pages: shown as unk://, as in the address bar)
        if (t) w.host.emit(t, { status: url ? toDisplay(url) : "" });
      },
      onBeforeLinkTraversal(originalTarget) {
        return originalTarget;
      },
      showTooltip(x, y, text) {
        emit("page-tooltip", { win: w.host.label, x: x / win.devicePixelRatio - win.mozInnerScreenX, y: y / win.devicePixelRatio - win.mozInnerScreenY, text });
      },
      hideTooltip() {
        emit("page-tooltip", { win: w.host.label, text: "" });
      },
      getTabCount() {
        return w.host.tabs.size;
      },
    };
  } catch (e) {
    console.error("unknowweb: XULBrowserWindow", e);
  }
  // full screen for a page's video
  win.addEventListener("MozDOMFullscreen:Entered", () => {
    const actor = win.__unkFullscreenRequest;
    actor?.enteredFullscreen();
    const t = actor && w.host.tabFor(actor.browser);
    if (t) w.host.emit(t, { fullscreen: true });
  });
  win.addEventListener("MozDOMFullscreen:Exited", () => {
    const actor = win.__unkFullscreenRequest;
    win.__unkFullscreenRequest = null;
    try {
      actor?.exitedFullscreen();
    } catch {}
    const t = actor && w.host.tabFor(actor.browser);
    if (t) w.host.emit(t, { fullscreen: false });
  });
  // the window's own state (maximized, full screen, focus) for the interface
  const state = () => emit("unk-window", { win: w.host.label, maximized: win.windowState === win.STATE_MAXIMIZED, fullscreen: win.fullScreen, focused: Services.focus.activeWindow === win });
  win.addEventListener("sizemodechange", state);
  win.addEventListener("resize", state);
  win.addEventListener("activate", state);
  win.addEventListener("deactivate", state);
  win.addEventListener("unload", () => {
    const label = w.host.label;
    windows.delete(label);
    const others = [...windows.values()].filter((x) => x.win && !x.win.closed).length;
    // a window closed while others stay open is not reopened next time
    if (others > 0 && !Services.startup.shuttingDown) {
      try {
        Core.call("session_forget", { win: label });
      } catch {}
    }
  });
}

function browserDOMWindowFor(win, w) {
  const open = (aURI, openWindowInfo, aWhere, opener) => {
    const host = w.host;
    const background = aWhere === Ci.nsIBrowserDOMWindow.OPEN_NEWTAB_BACKGROUND;
    const id = `${host.label}-g${Date.now().toString(36)}${(++winSeq).toString(36)}`;
    const b = host.makeBrowser({ remote: true, remoteType: opener?.remoteType, openWindowInfo });
    host.box.append(b);
    host.create({ id, url: aURI?.spec || "about:blank", bounds: null, show: false, browser: b });
    const openerTab = opener ? host.idOf(opener) : null;
    emit("tab-open", { win: host.label, opener: openerTab, url: aURI ? toDisplay(aURI.spec) : "about:blank", background, id });
    return b;
  };
  return {
    QueryInterface: ChromeUtils.generateQI(["nsIBrowserDOMWindow"]),
    createContentWindow(aURI, aOpenWindowInfo, aWhere) {
      return open(aURI, aOpenWindowInfo, aWhere, null)?.browsingContext;
    },
    openURI(aURI, aOpenWindowInfo, aWhere, aFlags, aTriggeringPrincipal) {
      const b = open(null, aOpenWindowInfo, aWhere, null);
      if (aURI) b.fixupAndLoadURIString(aURI.spec, { triggeringPrincipal: aTriggeringPrincipal || SYSTEM() });
      return b?.browsingContext;
    },
    createContentWindowInFrame(aURI, aParams, aWhere) {
      return open(aURI, aParams.openWindowInfo, aWhere, aParams.openerBrowser);
    },
    openURIInFrame(aURI, aParams, aWhere) {
      const b = open(aURI, aParams.openWindowInfo, aWhere, aParams.openerBrowser);
      if (aURI) b.fixupAndLoadURIString(aURI.spec, { triggeringPrincipal: aParams.triggeringPrincipal || SYSTEM() });
      return b;
    },
    canClose() {
      return true;
    },
    get tabCount() {
      return w.host.tabs.size;
    },
  };
}

function winAction(win, action) {
  switch (action) {
    case "minimize":
      win.minimize();
      break;
    case "maximize":
      win.windowState === win.STATE_MAXIMIZED ? win.restore() : win.maximize();
      break;
    case "close":
      win.close();
      break;
    case "fullscreen":
      if (!win.fullScreen) win.fullScreen = true;
      break;
    case "leaveFullscreen":
      if (win.document.fullscreenElement) win.document.exitFullscreen().catch(() => {});
      else if (win.fullScreen) win.fullScreen = false;
      break;
    case "toggleFullscreen":
      win.fullScreen = !win.fullScreen;
      break;
  }
  return { maximized: win.windowState === win.STATE_MAXIMIZED, fullscreen: win.fullScreen };
}

// ---------- the task manager ----------
async function taskmgrSnapshot() {
  const info = await ChromeUtils.requestProcInfo();
  const procs = [{ pid: info.pid, kind: "host", frames: [], tabs: [] }];
  const tabsByPid = new Map();
  for (const w of windows.values()) {
    for (const t of w.host?.tabs.values() || []) {
      let pid = 0;
      try {
        pid = t.browser.browsingContext?.currentWindowGlobal?.osPid || 0;
      } catch {}
      if (!pid) continue;
      if (!tabsByPid.has(pid)) tabsByPid.set(pid, []);
      tabsByPid.get(pid).push(t.id);
    }
  }
  for (const c of info.children) {
    const web = /^(web|webIsolated|webCOOP|file|extension|privilegedabout|withCoopCoep|webServiceWorker|inference)/.test(c.type) || c.type.startsWith("web");
    const kind = web ? "renderer" : c.type === "gpu" ? "gpu" : c.type === "socket" || c.type === "utility" || c.type === "rdd" ? "utility" : "other";
    const frames = (c.windows || []).filter((x) => x.isProcessRoot !== false).map((x) => toDisplay(x.documentURI?.spec || "")).filter(Boolean);
    procs.push({ pid: c.pid, kind, frames: [...new Set(frames)], tabs: tabsByPid.get(c.pid) || [] });
  }
  // the parent's own pages (unk://…) are in the main process
  for (const w of windows.values()) {
    for (const t of w.host?.tabs.values() || []) if (isInternal(t.browser.currentURI?.spec || "") || !t.browser.isRemoteBrowser) procs[0].tabs.push(t.id);
  }
  let usage = [];
  try {
    usage = Core.call("proc_usage", { pids: procs.map((p) => p.pid) });
  } catch {}
  const byPid = new Map(usage.map((u) => [u.pid, u]));
  return procs.map((p) => ({ ...p, private: byPid.get(p.pid)?.private || 0, ws: byPid.get(p.pid)?.ws || 0, cpu: byPid.get(p.pid)?.cpu || 0 }));
}

// ---------- cookies for the core's downloads (yt-dlp, videos) ----------
function cookiesNetscape(url) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return "";
  }
  const base = host.split(".").slice(-2).join(".");
  const lines = ["# Netscape HTTP Cookie File"];
  for (const c of Services.cookies.getCookiesFromHost(base, {})) {
    const exp = c.isSession ? 0 : Math.floor(c.expiry / 1000) > 1e11 ? Math.floor(c.expiry / 1000) : c.expiry;
    lines.push([c.isHttpOnly ? `#HttpOnly_${c.host}` : c.host, c.host.startsWith(".") ? "TRUE" : "FALSE", c.path, c.isSecure ? "TRUE" : "FALSE", exp, c.name, c.value].join("\t"));
  }
  return lines.join("\n") + "\n";
}

function cookieHeader(url) {
  try {
    const u = Services.io.newURI(url);
    return Services.cookies
      .getCookiesFromHost(u.host, {})
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  } catch {
    return "";
  }
}

// ---------- the commands ----------
// (a page by its inner window: Lịch sử → Ẩn danh opened in it stays open for it only)
const pageId = (win) => {
  try {
    return win?.windowGlobalChild?.innerWindowId ?? win?.windowUtils?.currentInnerWindowID ?? 0;
  } catch {
    return 0;
  }
};
// (...and only that page of the browser's: Lịch sử, or Cài đặt)
function fromPage(win, name) {
  let uri = "";
  try {
    uri = win?.document?.documentURI || "";
  } catch {}
  if (!uri.startsWith("chrome://unknowweb/content/ui/pages/" + name + "/")) throw "not allowed";
  return pageId(win);
}
const QUICK = new Set(["settings_get", "settings_set", "settings_reset", "engines_get", "bookmarks_get", "bookmarks_set", "history_suggest", "history_delete", "history_query", "history_find", "history_domains", "history_remove_where", "history_remove_ids", "notes_get", "notes_set", "downloads_list", "downloads_clear", "perm_set", "adblock_status", "wallpaper_list", "wallpaper_meta", "wallpaper_delete", "grab_tools", "store_cancel", "backup_export", "history_delete_range", "media_cancel", "process_kill"]);

async function invoke(cmd, args, options, caller) {
  args = args || {};
  const ctx = contextOf(caller);
  const shell = ctx.shell;
  const host = ctx.host;
  const tabHost = (id) => hostOfTab(id, ctx);
  switch (cmd) {
    // ----- windows -----
    case "win_init":
      return winInit(caller);
    case "win_new":
      openWindow({ isPrivate: !!args.private, url: args.url || null, adopt: args.adopt || null, historyFrom: args.historyFrom || null });
      return null;
    case "win_action":
      return winAction(shell || caller, args.action);
    case "win_show":
      (shell || caller).focus();
      return null;
    case "shell_focus": {
      const w = shell || caller;
      const a = w.document.activeElement;
      if (a?.localName === "browser") Services.focus.clearFocus(w);
      w.focus();
      return null;
    }
    case "shell_devtools":
      return null;
    case "keys_set":
      keys = new Set(args.keys || []);
      return null;
    case "labels_set":
      labels = args.labels || {};
      return null;
    case "session_save": {
      if (!ctx.label || windows.get(ctx.label)?.private) return null;
      // (each tab with its back / forward list: the open ones' now, a sleeping one's as it was kept)
      const session = { ...args.session };
      session.tabs = (session.tabs || []).map(({ id, live, history, ...t }) => {
        const tab = live ? host?.tabs.get(id) : null;
        const h = tab ? host.collectHistory(tab) : history || historyStash.get(id) || null;
        return h ? { ...t, history: h } : t;
      });
      return Core.call("session_save", { win: ctx.label, session, closed: args.closed ?? null, bounds: bounds(shell) });
    }
    case "tab_stash": {
      // (a tab's list kept under a key of its own, to go with it to another window)
      let h = null;
      try {
        h = tabHost(args.id).collectHistory(tabHost(args.id).get(args.id));
      } catch {}
      if (!h) return null;
      const key = `move-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      stashHistory(key, h);
      return key;
    }
    case "tab_send": {
      let h = null;
      try {
        h = tabHost(args.id).collectHistory(tabHost(args.id).get(args.id));
      } catch {}
      const key = h ? `move-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` : null;
      if (key) stashHistory(key, h);
      const target = windows.get(args.win);
      if (!target?.win || target.win.closed) throw "no window";
      emit("tab-open", { win: args.win, url: args.url, background: false, historyFrom: key });
      target.win.focus();
      return null;
    }
    // ----- where the data lives (Settings → Giới thiệu → Thư mục dữ liệu)
    case "data_folder_pick": {
      const [dir] = await pick(shell || caller, { title: "Chọn thư mục dữ liệu (có settings.json, history.json… của TyranWeb)", folder: true });
      return dir || "";
    }
    case "app_restart":
      // (the windows are kept for the next start, as at any quit)
      Services.tm.dispatchToMainThread(() => Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart));
      return null;
    // ----- more of the wallpapers (from TyranWeb)
    case "wallpaper_import_many": {
      const w = shell || caller;
      const paths =
        args.kind === "folder" ? await pick(w, { title: "Thêm cả thư mục", folder: true })
        : args.kind === "zip" ? await pick(w, { title: "Thêm file zip", filters: [["Zip", "*.zip"]] })
        : await pick(w, { title: "Thêm ảnh / video", multiple: true, filters: [MEDIA_FILTER] });
      if (!paths.length) return { added: [], skipped: 0 };
      return Core.submit("wallpaper_add_paths", { paths });
    }
    case "wallpaper_link_pick": {
      const [path] = await pick(shell || caller, { title: "Liên kết thư mục ảnh / video", folder: true });
      return path ? Core.submit("wallpaper_link_folder", { path }) : null;
    }
    case "music_pick": {
      const paths = await pick(shell || caller, { title: "Chọn file nhạc", multiple: true, filters: [["Nhạc", "*.mp3;*.wav;*.ogg;*.oga;*.opus;*.flac;*.m4a;*.aac;*.weba"]] });
      return paths.length ? Core.submit("music_add", { paths }) : [];
    }
    case "web_pick": {
      const w = shell || caller;
      const [path] = args.kind === "zip" ? await pick(w, { title: "Gói hình nền web (zip)", filters: [["Zip", "*.zip"]] }) : await pick(w, { title: "Thư mục hình nền web", folder: true });
      return path ? Core.submit("web_import", { path }) : null;
    }
    case "wallweb_set":
      host?.wallPage(args.url || "", { audio: !!args.audio });
      return null;
    case "musicweb_set":
      host?.musicPage(args.embed || "");
      return null;
    case "musicweb_pause":
      host?.musicPause(!!args.paused);
      return null;
    case "media_probe":
      return probeMedia(shell || anyShell()?.win, args.url, args.page);
    case "winhistory_open": {
      const w = Core.call("winhistory_take", { index: args.index || 0 });
      if (w) openWindow({ restore: w });
      return null;
    }
    case "win_list":
      return [...windows.entries()]
        .filter(([, w]) => w.win && !w.win.closed)
        .map(([label, w]) => ({ label, private: w.private, title: w.win.document.querySelector(".tab.active")?.getAttribute("title") || "", tabs: w.host?.tabs.size || 0, current: label === ctx.label }));
    case "frame_of": {
      const w = shell || caller;
      const b = caller?.docShell?.chromeEventHandler;
      const r = b?.getBoundingClientRect?.();
      return { x: r?.left || 0, y: r?.top || 0, w: w.innerWidth, h: w.innerHeight };
    }
    // ----- Lịch sử → Ẩn danh and Settings → Ẩn danh: InPrivate windows' pages, kept encrypted when
    // switched on (PrivHistory.sys.mjs); read only by the Lịch sử page that opened it with the PIN
    case "privhist_status":
      return PrivHistory.status(pageId(caller));
    case "privhist_unlock":
      return PrivHistory.unlock(fromPage(caller, "history"), caller, args.pin ?? null);
    case "privhist_lock":
      return PrivHistory.lock(pageId(caller));
    case "privhist_find":
      return PrivHistory.find(fromPage(caller, "history"), args);
    case "privhist_domains":
      return PrivHistory.domains(fromPage(caller, "history"), args);
    case "privhist_remove":
      return PrivHistory.remove(fromPage(caller, "history"), Array.isArray(args.ids) ? args.ids : []);
    case "privhist_remove_where":
      return PrivHistory.removeWhere(fromPage(caller, "history"), args);
    case "privhist_check":
      fromPage(caller, "settings");
      return PrivHistory.check(args.pin);
    case "privhist_set_pin":
      fromPage(caller, "settings");
      return PrivHistory.setPin(args.current ?? null, args.pin ?? null);
    case "privhist_reset":
      fromPage(caller, "settings");
      return PrivHistory.reset();
    case "open_tab": {
      const target = ctx.label ? ctx.label : anyShell()?.host?.label;
      if (!target) openWindow({ url: args.url });
      else emit("tab-open", { win: target, url: args.url, background: !!args.background });
      return null;
    }
    case "taskmgr_open": {
      const w = Services.wm.getMostRecentWindow("unknowweb:taskmgr") || [...Services.wm.getEnumerator(null)].find((x) => x.location?.href === TASKMGR_URL);
      if (w) return w.focus(), null;
      const tm = Services.ww.openWindow(null, TASKMGR_URL, "unk-taskmgr", "chrome,dialog=no,resizable,centerscreen,width=760,height=520", null);
      tm.addEventListener("load", () => taskbarIdentity(tm), { once: true });
      return null;
    }
    case "taskmgr_snapshot":
      return taskmgrSnapshot();

    // ----- tabs -----
    case "tab_create":
      if (!host) throw "no window";
      host.create({ id: args.id, url: args.url, bounds: args.bounds, show: !!args.show, zoom: args.zoom, history: args.history || null, restoreFrom: args.restoreFrom || null });
      return null;
    case "tab_close":
      try {
        tabHost(args.id).close(args.id);
      } catch {}
      return null;
    case "tab_load": {
      const h = tabHost(args.id);
      h.load(h.get(args.id), toReal(args.url));
      return null;
    }
    case "tab_nav":
      tabHost(args.id).nav(args.id, args.action);
      return null;
    case "tab_bounds": {
      const h = tabHost(args.id);
      h.place(h.get(args.id), args.bounds);
      return null;
    }
    case "tab_show": {
      const h = tabHost(args.id);
      const t = h.get(args.id);
      h.place(t, args.bounds, true);
      if (args.focus) t.browser.focus();
      return null;
    }
    case "tab_hide": {
      const h = tabHost(args.id);
      h.place(h.get(args.id), null, false);
      return null;
    }
    case "tab_focus":
      tabHost(args.id).get(args.id).browser.focus();
      return null;
    case "tab_zoom":
      tabHost(args.id).setZoom(args.id, args.factor);
      return null;
    case "tab_mute":
      tabHost(args.id).mute(args.id, !!args.muted);
      return null;
    case "tab_freeze":
    case "tab_thaw":
      return null;
    case "tab_exec":
      tabHost(args.id).evalIn(args.id, args.js);
      return null;
    case "tab_eval":
      return tabHost(args.id).evalIn(args.id, args.js);
    case "tab_find":
      tabHost(args.id).find(args.id, args.text, args.newSearch, args.backwards, args.case);
      return null;
    case "tab_find_stop":
      try {
        tabHost(args.id).findStop(args.id);
      } catch {}
      return null;
    case "tab_capture":
      return tabHost(args.id).captureURL(args.id);
    case "tab_screenshot":
      return tabHost(args.id).screenshot(args.id);
    case "tab_pdf":
      return tabHost(args.id).pdf(args.id, args.title);
    case "tab_pip":
      tabHost(args.id).pip(args.id);
      return null;
    case "tab_history":
      return tabHost(args.id).history(args.id);
    case "tab_history_go":
      tabHost(args.id).historyGo(args.id, args.entry);
      return null;
    case "tab_move":
      throw "not supported";
    // ----- from TyranWeb: cursor, fonts, WARP, apps, scans
    case "cursor_config":
      return Extras.cursorConfig(settings);
    case "cursor_import":
      return Extras.importCursor(shell || caller);
    case "fonts_pick":
      return Extras.pickFonts(shell || caller, settings);
    case "fonts_remove":
      return Extras.removeFontFamily(settings, args.family);
    case "warp_state": {
      const [s, where] = await Promise.all([Core.submit("warp_state"), Extras.warpWhere()]);
      return { ...s, where, routed: Extras.warpRouted() };
    }
    case "warp_action": {
      await Core.submit("warp_action", { what: args.what });
      return Extras.warpSync(!!settings?.privacy?.warp, emit);
    }
    case "warp_routed":
      return Extras.warpRouted();
    case "apps_list": {
      const list = await Core.submit("apps_list", { fresh: !!args.fresh });
      return list.map((a) => {
        let icon = "";
        try {
          const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
          f.initWithPath(a.kind === "program" ? a.exe : a.logo);
          icon = a.kind === "program" ? `moz-icon:${Services.io.newFileURI(f).spec}?size=32` : a.logo ? Services.io.newFileURI(f).spec : "";
        } catch {}
        return { id: a.id, name: a.name, kind: a.kind, signer: a.signer, icon };
      });
    }
    case "file_open": {
      // (a download with a threat in it is not opened from here; a program still being scanned once found clean)
      const ok = await Core.submit("scan_may_open", { path: args.path }).catch(() => true);
      if (!ok) throw "Tệp này có mã độc nên không được mở";
      return Core.call("file_open", args);
    }
    case "dialog_respond":
      answerPrompt(args.id, args.reply ?? null);
      return null;
    case "ctx_emit":
      emit("ctx", { tab: args.tab, action: args.action, url: args.url || "" });
      return null;
    case "page_cmd": {
      const h = tabHost(args.id);
      let actor = h.menuActor;
      try {
        if (!actor || actor.manager?.isClosed) actor = h.get(args.id).browser.browsingContext?.currentWindowGlobal?.getActor("UnkPage");
        actor?.sendAsyncMessage("Copy", { cmd: args.cmd });
      } catch {}
      return null;
    }
    case "download_url":
      return saveURL(shell || caller, args.url, args.page);

    // ----- downloads -----
    case "download_action": {
      // (a comic chapter's row: its run is stopped)
      if (isMangaId(args.id)) {
        if (args.action === "cancel") cancelManga(args.id);
        return null;
      }
      const d = dlById.get(Number(args.id));
      if (!d) {
        if (args.action === "cancel") Core.call("media_cancel", { id: Number(args.id) });
        return null;
      }
      if (args.action === "pause") {
        d.tryToKeepPartialData = true;
        await d.cancel();
      } else if (args.action === "resume") d.start().catch(() => {});
      else if (args.action === "cancel") {
        await d.cancel();
        await d.removePartialData().catch(() => {});
        emit("download", dlPayload(d));
      }
      return null;
    }
    case "media_download": {
      let page = "";
      try {
        page = tabHost(args.tab).get(args.tab).url;
      } catch {}
      return Core.submit("media_start", { url: args.url, kind: args.kind, title: args.title, referer: page, cookies: cookieHeader(args.url) });
    }
    // ----- Tải truyện tranh -----
    case "manga_scan":
      return scanManga(args.tab, { scroll: !!args.scroll, hint: args.hint || "" });
    case "manga_thumbs":
      return thumbsManga(args.tab, args.urls || []);
    case "manga_download":
      return startManga({ ...args, private: !!tabHost(args.tab).private });
    case "grab_info":
      return Core.submit("grab_info", { url: args.url, cookies: cookiesNetscape(args.url) });
    case "grab_download":
      return Core.submit("grab_download", { ...args, cookies: cookiesNetscape(args.url) });

    // ----- permissions -----
    case "perm_respond": {
      const p = pendingPerms.get(args.id);
      if (!p) return null;
      pendingPerms.delete(args.id);
      args.allow ? p.allow() : p.deny();
      if (args.remember && !p.private) Core.call("perm_save", { origin: p.origin, kind: p.kind, value: args.allow ? "allow" : "deny" });
      return null;
    }

    // ----- data -----
    case "clear_data":
      return clearData(args.kinds, args.since);
    case "cleaner_run":
      if ((args.parts || []).includes("cache")) Services.cache2.clear();
      return Core.submit("cleaner_run", args);
    case "app_info": {
      const r = Core.call("app_info");
      return { ...r, engine: `Gecko ${Services.appinfo.platformVersion}`, webview2: `Gecko ${Services.appinfo.platformVersion}` };
    }
    case "ext_list":
      return [];
    case "ext_install":
    case "ext_toggle":
    case "ext_remove":
    case "ext_open":
      throw "Tiện ích Chrome không chạy trên lõi Gecko";
    case "wallpaper_save":
    case "wallpaper_thumb": {
      const headers = options?.headers || {};
      return Core.submit(cmd, { __headers: headers }, args);
    }
  }
  // (Windows' keys are for PrivHistory.sys.mjs only, not for the pages)
  if (cmd.startsWith("dpapi_")) throw "not allowed";
  if (QUICK.has(cmd)) return Core.call(cmd, args);
  return Core.submit(cmd, args);
}

/** Files or a folder picked (paths; [] cancelled). */
async function pick(win, { title, folder = false, multiple = false, filters = [] }) {
  const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
  fp.init(win.browsingContext, title, folder ? Ci.nsIFilePicker.modeGetFolder : multiple ? Ci.nsIFilePicker.modeOpenMultiple : Ci.nsIFilePicker.modeOpen);
  for (const [name, mask] of filters) fp.appendFilter(name, mask);
  const r = await new Promise((res) => fp.open(res));
  if (r !== Ci.nsIFilePicker.returnOK) return [];
  if (multiple && !folder) return [...fp.files].map((f) => f.QueryInterface(Ci.nsIFile).path);
  return fp.file ? [fp.file.path] : [];
}
const MEDIA_FILTER = ["Ảnh và video", "*.jpg;*.jpeg;*.png;*.webp;*.gif;*.avif;*.bmp;*.mp4;*.m4v;*.webm;*.mov"];

// (a video found on a page, played unseen for a moment: its size, length and a picture of it)
const probeReferers = new Map();
async function probeMedia(win, url, page) {
  if (!/^https?:/i.test(url)) throw "bad url";
  if (/\.m3u8(\?|$)/i.test(url)) return { stream: true };
  probeReferers.set(url, page || "");
  const doc = win.document;
  const v = doc.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.style.cssText = "position:fixed;left:-10000px;top:0;width:320px;height:180px";
  doc.body.append(v);
  try {
    v.src = url;
    await new Promise((ok, fail) => {
      v.addEventListener("loadedmetadata", ok, { once: true });
      v.addEventListener("error", () => fail("cannot play"), { once: true });
      win.setTimeout(() => fail("timeout"), 15000);
    });
    const facts = { width: v.videoWidth, height: v.videoHeight, duration: Number.isFinite(v.duration) ? v.duration : 0 };
    if (!v.videoWidth) return facts;
    v.currentTime = Math.min(facts.duration * 0.1 || 1, 8);
    await new Promise((ok) => {
      v.addEventListener("seeked", ok, { once: true });
      win.setTimeout(ok, 6000);
    });
    const w = 320;
    const h = Math.round((w * v.videoHeight) / v.videoWidth);
    const c = doc.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(v, 0, 0, w, h);
    facts.thumb = c.toDataURL("image/jpeg", 0.75);
    return facts;
  } finally {
    v.removeAttribute("src");
    v.load();
    v.remove();
    probeReferers.delete(url);
  }
}

/** "Lưu thành…": where the file goes is asked, then the engine downloads it. */
async function saveURL(win, url, page) {
  let name = "download";
  try {
    name = decodeURIComponent(new URL(url).pathname.split("/").pop()) || "download";
  } catch {}
  const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
  fp.init(win.browsingContext, "Lưu thành", Ci.nsIFilePicker.modeSave);
  fp.defaultString = name.replace(/[\\/:*?"<>|]/g, "_");
  try {
    const dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    dir.initWithPath(Core.call("download_dir"));
    fp.displayDirectory = dir;
  } catch {}
  fp.appendFilters(Ci.nsIFilePicker.filterAll);
  const r = await new Promise((res) => fp.open(res));
  if (r === Ci.nsIFilePicker.returnCancel || !fp.file) return null;
  const isPrivate = PrivateBrowsingUtils.isWindowPrivate(win);
  let referrerInfo = null;
  try {
    if (page) referrerInfo = new Components.Constructor("@mozilla.org/referrer-info;1", "nsIReferrerInfo", "init")(Ci.nsIReferrerInfo.EMPTY, true, Services.io.newURI(page));
  } catch {}
  const d = await lazy.Downloads.createDownload({ source: { url, isPrivate, referrerInfo }, target: fp.file.path });
  const list = await lazy.Downloads.getList(isPrivate ? lazy.Downloads.PRIVATE : lazy.Downloads.PUBLIC);
  await list.add(d);
  d.start().catch(() => {});
  return null;
}

function clearData(kinds, since) {
  const F = Ci.nsIClearDataService;
  const flags =
    kinds === "cache"
      ? F.CLEAR_ALL_CACHES
      : kinds === "cookies"
        ? F.CLEAR_COOKIES | F.CLEAR_COOKIE_BANNER_EXECUTED_RECORD
        : kinds === "storage"
          ? F.CLEAR_DOM_STORAGES | F.CLEAR_EME
          : F.CLEAR_ALL_CACHES | F.CLEAR_COOKIES | F.CLEAR_DOM_STORAGES | F.CLEAR_AUTH_TOKENS | F.CLEAR_SITE_PERMISSIONS | F.CLEAR_HSTS | F.CLEAR_EME | F.CLEAR_MEDIA_DEVICES | F.CLEAR_STORAGE_ACCESS;
  const done = {
    onDataDeleted() {
      emit("toast", { kind: "cleared" });
    },
    QueryInterface: ChromeUtils.generateQI(["nsIClearDataCallback"]),
  };
  if (since) Services.clearData.deleteDataInTimeRange(since * 1000, Date.now() * 1000, true, flags, done);
  else Services.clearData.deleteData(flags, done);
  return null;
}

// ---------- start ----------
function appFile(name) {
  const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
  const spec = res.resolveURI(Services.io.newURI(`resource:///${name}`));
  return Services.io.newURI(spec).QueryInterface(Ci.nsIFileURL).file.path;
}

function start() {
  if (started) return;
  started = true;
  const dataDir = PathUtils.join(Services.dirsvc.get("ProfD", Ci.nsIFile).path, "unk");
  const info = Core.init(appFile("unkcore.dll"), dataDir);
  settings = info.settings;
  engines = info.engines;
  bookmarks = info.bookmarks;
  IOUtils.makeDirectory(PathUtils.join(dataDir, "tmp"), { ignoreExisting: true }).catch(() => {});

  // wallpapers: resource://unkwall/<file>
  const walls = PathUtils.join(dataDir, "wallpapers");
  IOUtils.makeDirectory(walls, { ignoreExisting: true, createAncestors: true })
    .catch(() => {})
    .then(() => {});
  const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
  const wallDir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  wallDir.initWithPath(walls);
  try {
    if (!wallDir.exists()) wallDir.create(Ci.nsIFile.DIRECTORY_TYPE, 0o755);
  } catch {}
  res.setSubstitution("unkwall", Services.io.newFileURI(wallDir));
  // the user's own fonts: resource://unkfonts/<file>
  const fontDir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  fontDir.initWithPath(Extras.fontsDirectory());
  try {
    if (!fontDir.exists()) fontDir.create(Ci.nsIFile.DIRECTORY_TYPE, 0o755);
  } catch {}
  res.setSubstitution("unkfonts", Services.io.newFileURI(fontDir));
  // TyranWeb's wallpapers (its settings' tyran://userdata/ addresses): resource://unktyran/<file>
  if (info.tyranWalls) {
    try {
      const tw = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      // (a folder written with / as well as \: Windows paths for the engine)
      tw.initWithPath(PathUtils.normalize(info.tyranWalls.replace(/\//g, "\\")));
      if (tw.exists()) res.setSubstitution("unktyran", Services.io.newFileURI(tw));
    } catch {}
  }

  // (what sites are told the browser is: Gecko's own engine, as Firefox of the same engine says it;
  // an unknown name at its end makes sites treat it as an old browser)
  const major = parseInt(Services.appinfo.platformVersion, 10) || 140;
  Services.prefs.getDefaultBranch("").setStringPref("general.useragent.override", `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${major}.0) Gecko/20100101 Firefox/${major}.0`);

  // the engine's own page helpers (dropdowns, date pickers, find, audio, picture in picture…)
  ChromeUtils.importESModule("resource://gre/modules/ActorManagerParent.sys.mjs");
  ChromeUtils.registerWindowActor("UnkPage", {
    parent: { esModuleURI: "resource://unknowweb/actors/UnkPageParent.sys.mjs" },
    child: {
      esModuleURI: "resource://unknowweb/actors/UnkPageChild.sys.mjs",
      events: {
        DOMWindowCreated: {},
        DOMContentLoaded: {},
        DOMLinkAdded: {},
        DOMLinkChanged: {},
        pageshow: {},
        contextmenu: { mozSystemGroup: true },
        click: { mozSystemGroup: true },
        auxclick: { mozSystemGroup: true },
        DOMWindowClose: {},
        // (Ctrl + wheel: the page's zoom; after the page's own listeners, which may keep it)
        wheel: { mozSystemGroup: true, passive: true },
        "MozDOMFullscreen:Request": {},
        "MozDOMFullscreen:Entered": {},
        "MozDOMFullscreen:Exit": {},
        "MozDOMFullscreen:Exited": {},
      },
    },
    allFrames: true,
    messageManagerGroups: ["browsers"],
    // (its child runs in the sites' own processes)
    safeForUntrustedWebProcess: true,
  });
  // the pages' alert / confirm / prompt, as the interface's own dialogs
  ChromeUtils.registerWindowActor("Prompt", {
    parent: { esModuleURI: "resource://unknowweb/actors/PromptParent.sys.mjs" },
    child: { esModuleURI: "resource://unknowweb/actors/PromptChild.sys.mjs" },
    allFrames: true,
    messageManagerGroups: ["browsers"],
    safeForUntrustedWebProcess: true,
  });
  Services.ppmm.addMessageListener("UnkWeb:Shields", shieldsListener);

  Services.obs.addObserver(netObserver, "http-on-modify-request");
  Services.obs.addObserver(netObserver, "http-on-examine-response");
  Services.obs.addObserver(netObserver, "http-on-examine-cached-response");
  Services.obs.addObserver(gumObserver, "getUserMedia:request");
  registerPermissionPrompt();
  applyPrefs(settings);
  PrivHistory.onChange = () => emit("privhist-changed", {}); // (Lịch sử → Ẩn danh, open, lists it again)

  lazy.Downloads.getList(lazy.Downloads.ALL)
    .then((list) => list.addView(dlView))
    .catch((e) => console.error("unknowweb: downloads", e));
  // Tải truyện tranh: download events, chapter navigation and output directory.
  initManga({
    emit,
    tabOf: (id) => {
      try {
        return hostOfTab(id).get(id);
      } catch {
        return null;
      }
    },
    hostOf: (id) => {
      try {
        return hostOfTab(id);
      } catch {
        return null;
      }
    },
    // (a download folder typed with / as well as \: a Windows path for the engine)
    root: () => PathUtils.normalize(String(Core.call("download_dir") || "").replace(/\//g, "\\")),
  });

  cursorChanged(settings);
  if (settings?.privacy?.warp) Extras.warpSync(true, emit);
  Core.onEvent((event, payload) => {
    if (event === "settings") settingsChanged(payload);
    // a download the core made itself (videos, Tải từ đường dẫn), done: scanned too
    if (event === "download" && payload?.own && payload.state === "completed" && !payload.scan && !payload.private) Core.submit("scan_add", { item: payload }).catch(() => {});
    // the scan's result page, in the window in front
    if (event === "scan-open") {
      const w = Services.wm.getMostRecentWindow("unknowweb:browser");
      if (w?.__unkLabel) emit("tab-open", { win: w.__unkLabel, url: `unk://scan/?id=${encodeURIComponent(payload.id)}`, background: false });
    }
    if (event === "bookmarks") bookmarks = payload;
    emit(event, payload);
  });
  Services.obs.addObserver(
    {
      observe() {
        Core.shutdown();
      },
    },
    "quit-application"
  );
  testHook();
}

// (for working on the browser: UNK_TEST_DIR=<folder> runs <folder>/in.js in the newest window and
// writes what it gives to out.json; nothing of it exists without that variable)
function testHook() {
  const dir = Services.env.get("UNK_TEST_DIR");
  if (!dir) return;
  const input = PathUtils.join(dir, "in.js");
  const output = PathUtils.join(dir, "out.json");
  const tick = async () => {
    try {
      if (await IOUtils.exists(input)) {
        const code = await IOUtils.readUTF8(input);
        await IOUtils.remove(input);
        // (each run on its own, given up after 20 s: one that never ends does not stop the next)
        (async () => {
          let out;
          try {
            const win = Services.wm.getMostRecentWindow("unknowweb:browser") || Services.wm.getMostRecentWindow(null);
            const sb = Cu.Sandbox(SYSTEM(), { sandboxPrototype: win, wantXrays: false, sandboxName: "unk-test" });
            Object.assign(sb, { Backend, Core, win });
            const run = Cu.evalInSandbox(`(async () => {\n${code}\n})()`, sb);
            out = { ok: await Promise.race([run, new Promise((_, rej) => lazy.setTimeout(() => rej("test timed out"), 20000))]) };
          } catch (e) {
            out = { err: `${e}\n${e?.stack || ""}` };
          }
          await IOUtils.writeUTF8(output, JSON.stringify(out, (k, v) => (typeof v === "bigint" ? String(v) : v), 1));
        })();
      }
    } catch {}
    lazy.setTimeout(tick, 250);
  };
  tick();
}

export const Backend = {
  start,
  stashHistory,
  historyFor,
  emit,
  listen,
  invoke,
  contextOf,
  get settings() {
    return settings;
  },
  get keys() {
    return keys;
  },
  get labels() {
    return labels;
  },
};

const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
