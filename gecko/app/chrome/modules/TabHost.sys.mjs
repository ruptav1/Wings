// A window's tabs on the Gecko core: each tab a <browser> in the interface's own document, placed over
// its content area (the rectangles view.js computes), the page in a process of its own. What the
// Tauri build's wv2.rs did with WebView2 is done here with Gecko: page events for the interface,
// find in page, zoom, captures, printing, full screen, new windows opened by pages.
import { Core } from "resource://unknowweb/Core.sys.mjs";

const Wpl = Ci.nsIWebProgressListener;
const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, { SessionHistory: "resource://gre/modules/sessionstore/SessionHistory.sys.mjs", E10SUtils: "resource://gre/modules/E10SUtils.sys.mjs" });

// A tab's back / forward list (from TyranWeb: kept when the tab sleeps, is closed or the browser quits,
// given back when it wakes, is reopened or restored): the engine's own session history entries, with
// each page's scroll position and form values for the pages near the current one.
const BACK = 25;
const AHEAD = 5;
const STATE_NEAR = 3;
const STATE_MAX = 24 * 1024;
const keepable = (e) => e && typeof e.url === "string" && e.url.length <= 8192 && (/^https?:/i.test(e.url) || e.url.startsWith("chrome://unknowweb/content/ui/pages/"));
const sameUrl = (a, b) => String(a || "").split("#")[0].replace(/\/$/, "") === String(b || "").split("#")[0].replace(/\/$/, "");

export function trimHistory(h) {
  if (!h || !Array.isArray(h.entries) || !h.entries.length) return null;
  const cur = Math.min(Math.max(1, h.index || 1), h.entries.length) - 1;
  if (!keepable(h.entries[cur])) return null;
  const list = [];
  let at = 0;
  h.entries.forEach((e, i) => {
    if (i === cur) at = list.length;
    if (keepable(e)) list.push({ e, i });
  });
  const from = Math.max(0, at - BACK);
  const entries = list.slice(from, at + AHEAD + 1).map(({ e, i }) => {
    const x = { ...e };
    if (Math.abs(i - cur) > STATE_NEAR || (typeof x.structuredCloneState === "string" && x.structuredCloneState.length > STATE_MAX)) {
      delete x.structuredCloneState;
      delete x.structuredCloneVersion;
    }
    if (typeof x.title === "string") x.title = x.title.slice(0, 500);
    return x;
  });
  return { entries, index: at - from + 1 };
}
const SYSTEM = () => Services.scriptSecurityManager.getSystemPrincipal();

// (a list written by TyranWeb has only addresses and titles: each entry is given the principal its page
// would have had, its own site's, or the browser's for its own pages)
function withPrincipals(h) {
  for (const e of h.entries || []) {
    if (e.triggeringPrincipal_base64 || typeof e.url !== "string") continue;
    try {
      const p = e.url.startsWith("chrome:") ? SYSTEM() : Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI(e.url), {});
      e.triggeringPrincipal_base64 = lazy.E10SUtils.serializePrincipal(p);
    } catch {}
    if (Array.isArray(e.children)) withPrincipals({ entries: e.children });
  }
}
export const SHELL_PAGES = ["newtab", "settings", "history", "bookmarks", "downloads", "taskmgr", "store", "scan"];
const PAGE_ROOT = "chrome://unknowweb/content/ui/pages/";

/** unk://settings/#about -> chrome://unknowweb/content/ui/pages/settings/index.html#about */
export function toReal(url) {
  const m = /^unk:\/\/([a-z]+)\/?(.*)$/i.exec(url || "");
  if (!m) return url;
  const name = SHELL_PAGES.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : "newtab";
  return `${PAGE_ROOT}${name}/index.html${m[2].replace(/^\/+/, "")}`;
}

/** chrome://unknowweb/content/ui/pages/settings/index.html#about -> unk://settings/#about */
export function toDisplay(url) {
  if (!url || !url.startsWith(PAGE_ROOT)) return url || "";
  const rest = url.slice(PAGE_ROOT.length);
  const i = rest.indexOf("/");
  if (i < 0) return url;
  const name = rest.slice(0, i);
  const tail = rest.slice(i + 1).replace(/^index\.html/, "");
  return tail ? `unk://${name}/${tail}` : `unk://${name}`;
}

export const isInternal = (url) => (url || "").startsWith("chrome://unknowweb/") || /^unk:/i.test(url || "");

// (the zoom's steps: the same as the interface's Ctrl + = / Ctrl + - and the menu's, ui/js/commands.js)
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

export class TabHost {
  constructor(win, label, isPrivate, backend) {
    this.win = win;
    this.doc = win.document;
    this.label = label;
    this.private = isPrivate;
    this.B = backend;
    this.tabs = new Map(); // id -> tab record
    this.byBrowser = new WeakMap(); // <browser> -> tab record
    this.hover = null;
    this.container = null;
    win.__unkTabs = this;
  }

  emit(t, patch) {
    patch.id = t.id;
    this.B.emit("tab", patch);
  }

  get box() {
    if (this.container?.isConnected) return this.container;
    const content = this.doc.getElementById("content") || this.doc.body;
    const c = this.doc.createElement("div");
    c.id = "unk-views";
    content.prepend(c);
    this.container = c;
    return c;
  }

  // ---------- making a tab's browser ----------
  makeBrowser({ remote, remoteType, openWindowInfo }) {
    const b = this.doc.createXULElement("browser");
    b.setAttribute("type", "content");
    b.setAttribute("messagemanagergroup", "browsers");
    b.setAttribute("maychangeremoteness", "true");
    b.setAttribute("nodefaultsrc", "true");
    b.setAttribute("datetimepicker", "DateTimePickerPanel");
    b.setAttribute("autoscroll", "true");
    b.setAttribute("remote", remote ? "true" : "false");
    if (remote && remoteType) b.setAttribute("remoteType", remoteType);
    if (openWindowInfo) b.openWindowInfo = openWindowInfo;
    b.className = "unk-view";
    return b;
  }

  /** Its back / forward list now (null: nothing worth keeping). */
  collectHistory(t) {
    try {
      const sh = t.browser.browsingContext?.sessionHistory;
      if (!sh || !sh.count) return null;
      return trimHistory(lazy.SessionHistory.collectFromParent(t.browser.currentURI?.spec || "about:blank", true, sh));
    } catch {
      return null;
    }
  }

  /** A tab's page: `adopt` is a browser a page already opened (window.open, a link to a new tab);
   * `history` its back / forward list to give it, else the one kept for `restoreFrom` (the same tab
   * asleep, a closed tab reopened, a tab copied or moved), when its current page is the one asked for. */
  create({ id, url, bounds, show, zoom, browser: adopted, history, restoreFrom }) {
    if (this.tabs.has(id)) return;
    const real = toReal(url || "unk://newtab");
    let h = !adopted ? trimHistory(history) || this.B.historyFor(restoreFrom) : null;
    if (h && !sameUrl(h.entries[h.index - 1]?.url, real)) h = null;
    const b = adopted || this.makeBrowser({ remote: !isInternal(real) });
    const t = { id, browser: b, url: toDisplay(real), zoom: zoom || 1, blocked: 0, shown: false, listener: null, fsActor: null };
    this.tabs.set(id, t);
    this.byBrowser.set(b, t);
    this.place(t, bounds, !!show);
    if (!adopted) this.box.append(b);
    this.wire(t);
    if (Math.abs((zoom || 1) - 1) > 0.001) b.fullZoom = zoom;
    if (!adopted && !(h && this.restoreHistory(t, h))) this.load(t, real);
  }

  /** Puts a kept back / forward list into a tab's new page and loads its current entry. */
  restoreHistory(t, h) {
    try {
      const bc = t.browser.browsingContext;
      const sh = bc?.sessionHistory;
      if (!sh) return false;
      withPrincipals(h);
      lazy.SessionHistory.restoreFromParent(sh, h);
      sh.reloadCurrentEntry();
      t.requested = h.entries[h.index - 1]?.url || "";
      return true;
    } catch (e) {
      console.error("unknowweb: restoring a tab's history", e);
      return false;
    }
  }

  wire(t) {
    const b = t.browser;
    this.addProgress(t);
    this.hookMedia(t);
    const on = (type, fn) => b.addEventListener(type, fn);
    on("DidChangeBrowserRemoteness", () => {
      this.addProgress(t);
      this.hookMedia(t);
      if (Math.abs(t.zoom - 1) > 0.001) b.fullZoom = t.zoom;
      b.docShellIsActive = t.shown;
    });
    const title = () => {
      const title = b.contentTitle || "";
      this.emit(t, { title });
      if (!this.private && /^https?:/.test(t.url) && title) {
        try {
          Core.call("history_title", { url: t.url, title });
        } catch {}
      }
    };
    on("pagetitlechanged", title);
    on("DOMTitleChanged", title);
    on("DOMAudioPlaybackStarted", () => this.emit(t, { audible: true }));
    on("DOMAudioPlaybackStopped", () => this.emit(t, { audible: false }));
    on("oop-browser-crashed", (e) => {
      if (e.isTopFrame !== false) this.emit(t, { crashed: true, loading: false });
    });
    on("focus", () => this.B.emit("tab-focus", { id: t.id }));
    on("mouseover", () => (this.hover = t));
  }

  /** Sound from the page (the tab's speaker): the engine's media controller for its top frame. */
  hookMedia(t) {
    const bc = t.browser.browsingContext;
    if (!bc || t.mediaBC === bc) return;
    t.mediaBC = bc;
    const mc = bc.mediaController;
    if (!mc) return;
    mc.addEventListener("audiblechange", () => {
      if (t.mediaBC === bc) this.emit(t, { audible: !!mc.isAudible });
    });
    if (mc.isAudible) this.emit(t, { audible: true });
  }

  addProgress(t) {
    const b = t.browser;
    const wp = b.webProgress;
    if (!wp) return;
    if (t.listener && t.listenerOn === wp) return;
    if (t.listener && t.listenerOn) {
      try {
        t.listenerOn.removeProgressListener(t.listener);
      } catch {}
    }
    t.listener = this.progressListener(t);
    t.listenerOn = wp;
    wp.addProgressListener(t.listener, Ci.nsIWebProgress.NOTIFY_STATE_ALL | Ci.nsIWebProgress.NOTIFY_LOCATION | Ci.nsIWebProgress.NOTIFY_STATUS);
  }

  navState(t) {
    const b = t.browser;
    let canBack = false;
    let canForward = false;
    try {
      const sh = b.browsingContext?.sessionHistory;
      if (sh) {
        canBack = sh.index > 0;
        canForward = sh.index < sh.count - 1;
      } else {
        canBack = b.canGoBack;
        canForward = b.canGoForward;
      }
    } catch {}
    return { canBack, canForward };
  }

  progressListener(t) {
    const host = this;
    return {
      QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
      onStateChange(wp, req, flags, status) {
        if (!wp.isTopLevel || !(flags & Wpl.STATE_IS_NETWORK)) return;
        if (flags & Wpl.STATE_START) {
          t.blocked = 0;
          host.emit(t, { loading: true, blocked: 0, crashed: false, media: [] });
        } else if (flags & Wpl.STATE_STOP) {
          const ok = Components.isSuccessCode(status);
          const url = t.url;
          if (ok && !host.private && /^https?:/.test(url)) {
            try {
              Core.call("history_add", { url, title: t.browser.contentTitle || "" });
            } catch {}
          }
          // (asked for http://, shown over https://: HTTPS-First moved it)
          const host2 = (u) => u.replace(/^[a-z]+:\/\/(www\.)?/i, "").split(/[/?#:]/)[0];
          const upgraded = /^http:\/\//i.test(t.requested || "") && /^https:\/\//i.test(url) && host2(t.requested) === host2(url);
          t.requested = null;
          host.emit(t, { loading: false, blocked: t.blocked, fpProtected: !!t.fp, httpsUpgraded: upgraded, cleaned: !!t.cleaned, ...host.navState(t) });
          t.cleaned = false;
        }
      },
      onLocationChange(wp, req, location, flags) {
        if (!wp.isTopLevel) return;
        host.hookMedia(t);
        const shown = toDisplay(location?.spec || "");
        if (shown === "about:blank" && !t.url) return;
        t.url = shown;
        host.emit(t, { url: shown, ...host.navState(t) });
        // (a new page: whether it is a comic chapter is told again once it has loaded)
        if (!(flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT) && t.manga) {
          t.manga = 0;
          host.emit(t, { manga: 0 });
        }
        // (the browser's own pages have the interface's icons)
        if (!(flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT) && isInternal(shown)) host.emit(t, { favicon: "" });
      },
      onStatusChange() {},
      onProgressChange() {},
      onSecurityChange() {},
      onContentBlockingEvent() {},
    };
  }

  load(t, real) {
    const b = t.browser;
    t.requested = real;
    const go = () =>
      b.fixupAndLoadURIString(real, {
        triggeringPrincipal: SYSTEM(),
        loadFlags: Ci.nsIWebNavigation.LOAD_FLAGS_NONE,
      });
    try {
      go();
    } catch (e) {
      // (the browser is not in its document yet)
      this.win.setTimeout(() => {
        try {
          go();
        } catch (e2) {
          console.error("unknowweb: load failed", real, e2);
        }
      }, 0);
    }
  }

  // ---------- placing ----------
  place(t, bounds, show) {
    const b = t.browser;
    if (bounds) {
      const c = (this.doc.getElementById("content") || this.doc.body).getBoundingClientRect();
      Object.assign(b.style, { left: `${bounds.x - c.left}px`, top: `${bounds.y - c.top}px`, width: `${Math.max(1, bounds.w)}px`, height: `${Math.max(1, bounds.h)}px` });
    }
    if (show !== undefined) {
      t.shown = show;
      b.classList.toggle("shown", show);
      try {
        b.docShellIsActive = show;
      } catch {}
      try {
        if (b.browsingContext) b.browsingContext.isActive = show;
      } catch {}
    }
  }

  get(id) {
    const t = this.tabs.get(id);
    if (!t) throw "no tab";
    return t;
  }

  close(id) {
    const t = this.tabs.get(id);
    if (!t) return;
    // (its back / forward list, for when it wakes or is reopened)
    if (!this.private) this.B.stashHistory(id, this.collectHistory(t));
    this.tabs.delete(id);
    try {
      t.listenerOn?.removeProgressListener(t.listener);
    } catch {}
    t.browser.remove();
  }

  // ---------- what the interface asks ----------
  nav(id, action) {
    const t = this.get(id);
    const b = t.browser;
    switch (action) {
      case "back":
        return b.goBack();
      case "forward":
        return b.goForward();
      case "reload":
        return b.reload();
      case "hardReload":
        return b.reloadWithFlags(Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE | Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_PROXY);
      case "stop":
        return b.stop();
      case "focus":
        return b.focus();
      case "print":
        return this.printDialog(t);
      case "saveAs":
        return this.saveAs(t);
      case "devtools":
        return this.B.emit("toast-text", { text: "Công cụ nhà phát triển chưa có trong bản Gecko" });
    }
  }

  setZoom(id, factor) {
    const t = this.get(id);
    t.zoom = Math.min(5, Math.max(0.25, factor));
    t.browser.fullZoom = t.zoom;
    this.emit(t, { zoom: t.zoom });
  }

  onZoomStep(browser, step) {
    const t = this.byBrowser.get(browser);
    if (!t) return;
    const cur = t.zoom || 1;
    const next = step > 0 ? ZOOMS.find((z) => z > cur + 0.001) || 5 : [...ZOOMS].reverse().find((z) => z < cur - 0.001) || 0.25;
    this.setZoom(t.id, next);
  }

  mute(id, muted) {
    const b = this.get(id).browser;
    muted ? b.mute() : b.unmute();
  }

  async capture(id, type = "image/jpeg") {
    const t = this.get(id);
    const wg = t.browser.browsingContext?.currentWindowGlobal;
    if (!wg) throw "capture failed";
    const bmp = await wg.drawSnapshot(null, 1, "white");
    const c = this.doc.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d").drawImage(bmp, 0, 0);
    bmp.close?.();
    return c;
  }

  async captureURL(id) {
    const c = await this.capture(id);
    return c.toDataURL("image/jpeg", 0.85);
  }

  async screenshot(id) {
    const c = await this.capture(id);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const dir = PathUtils.join(Core.call("download_dir"), "Screenshots");
    await IOUtils.makeDirectory(dir, { ignoreExisting: true });
    const path = PathUtils.join(dir, `Wings ${Math.floor(Date.now() / 1000)}.png`);
    await IOUtils.write(path, bytes);
    return { path, data: c.toDataURL("image/png") };
  }

  printSettings() {
    const ps = Cc["@mozilla.org/gfx/printsettings-service;1"].getService(Ci.nsIPrintSettingsService);
    return ps.createNewPrintSettings();
  }

  async pdf(id, title) {
    const t = this.get(id);
    const safe = String(title || "").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80).trim() || "page";
    const path = PathUtils.join(Core.call("download_dir"), `${safe}.pdf`);
    const s = this.printSettings();
    s.outputDestination = Ci.nsIPrintSettings.kOutputDestinationFile;
    s.outputFormat = Ci.nsIPrintSettings.kOutputFormatPDF;
    s.toFileName = path;
    s.printSilent = true;
    s.showMarginGuides = false;
    s.printBGColors = true;
    s.printBGImages = true;
    t.browser.browsingContext
      .print(s)
      .then(() => this.B.emit("toast", { kind: "pdf", ok: true, path }))
      .catch(() => this.B.emit("toast", { kind: "pdf", ok: false, path }));
    return path;
  }

  async printDialog(t) {
    const s = this.printSettings();
    try {
      const dlg = Cc["@mozilla.org/widget/printdialog-service;1"].getService(Ci.nsIPrintDialogService);
      await dlg.showPrintDialog(this.win.browsingContext, false, s);
    } catch {
      return; // (cancelled)
    }
    s.printSilent = true;
    await t.browser.browsingContext.print(s).catch(() => {});
  }

  saveAs(t) {
    try {
      if (!this.win.saveBrowser) Services.scriptloader.loadSubScript("chrome://global/content/contentAreaUtils.js", this.win);
      this.win.saveBrowser(t.browser);
    } catch (e) {
      console.error("unknowweb: save as", e);
    }
  }

  // ---------- find in page ----------
  find(id, text, fresh, backwards, matchCase) {
    const t = this.get(id);
    const f = t.browser.finder;
    if (!f) return;
    if (!t.findHooked) {
      t.findHooked = true;
      f.addResultListener({
        onFindResult: () => {},
        onMatchesCountResult: (r) => this.B.emit("find", { id: t.id, count: r.total || 0, active: r.current || 0 }),
        onHighlightFinished: () => {},
        onCurrentSelection: () => {},
      });
    }
    if (!text) return this.findStop(id);
    f.caseSensitive = !!matchCase;
    if (fresh) {
      f.fastFind(text, false, false);
      f.highlight(true, text, false);
    } else f.findAgain(text, !!backwards, false, false);
    f.requestMatchesCount(text, false);
  }

  findStop(id) {
    const t = this.tabs.get(id);
    const f = t?.findHooked ? t.browser.finder : null;
    if (!f) return;
    f.highlight(false);
    f.removeSelection(false);
  }

  // ---------- the page's own back / forward list ----------
  history(id) {
    const t = this.get(id);
    const sh = t.browser.browsingContext?.sessionHistory;
    if (!sh) throw "no history";
    const entries = [];
    for (let i = 0; i < sh.count; i++) {
      const e = sh.getEntryAtIndex(i);
      entries.push({ id: i, url: toDisplay(e.URI?.spec || ""), title: e.title || "" });
    }
    return { currentIndex: sh.index, entries };
  }

  historyGo(id, entry) {
    this.get(id).browser.gotoIndex(entry);
  }

  async evalIn(id, js) {
    const t = this.get(id);
    const actor = t.browser.browsingContext?.currentWindowGlobal?.getActor("UnkPage");
    if (!actor) return null;
    return actor.sendQuery("Eval", { js }).catch(() => null);
  }

  pip(id) {
    const t = this.get(id);
    try {
      t.browser.browsingContext.currentWindowGlobal.getActor("PictureInPictureLauncher").sendAsyncMessage("PictureInPicture:KeyToggle");
    } catch (e) {
      console.error("unknowweb: pip", e);
    }
  }

  // ---------- from the page (UnkPageParent) ----------
  onShields(browser, data) {
    const t = this.byBrowser.get(browser);
    if (t) t.fp = !!data.fp;
  }

  /** The page looks like a comic chapter of `count` pictures (0: it does not): the address bar offers them. */
  onMangaHint(browser, count) {
    const t = this.byBrowser.get(browser);
    if (!t || (t.manga || 0) === count) return;
    t.manga = count;
    this.emit(t, { manga: count });
  }

  onIcon(browser, url) {
    const t = this.byBrowser.get(browser);
    if (!t) return;
    this.emit(t, { favicon: url });
    // (the history keeps each visit's icon, as TyranWeb's does)
    if (!this.private && /^https?:/i.test(t.url || "") && /^https?:/i.test(url || "")) {
      try {
        Core.call("history_favicon", { url: t.url, favicon: url });
      } catch {}
    }
  }

  onOpenLink(browser, d) {
    const t = this.byBrowser.get(browser);
    if (!t) return;
    if (d.window) return this.B.invoke("win_new", { private: this.private, url: d.url }, null, this.win);
    this.B.emit("tab-open", { win: this.label, opener: t.id, url: d.url, background: !!d.background });
  }

  onCloseRequested(browser) {
    const t = this.byBrowser.get(browser);
    if (t) this.emit(t, { closeRequested: true });
  }

  onContextMenu(browser, info, actor) {
    const t = this.byBrowser.get(browser);
    if (!t) return;
    // screen pixels -> the window's CSS pixels
    const x = info.x - this.win.mozInnerScreenX;
    const y = info.y - this.win.mozInnerScreenY;
    this.menuActor = actor;
    this.B.emit("page-menu", { win: this.label, tab: t.id, ...info, x, y, canBack: this.navState(t).canBack, canForward: this.navState(t).canForward });
  }

  // ---------- a web wallpaper, and a link's music (from TyranWeb) ----------
  /** The page drawn as the window's wallpaper (behind the interface; '' takes it away). */
  wallPage(url, { audio = false } = {}) {
    if (!url) {
      this.wall?.remove();
      this.wall = null;
      this.wallUrl = "";
      return;
    }
    const host = this.doc.getElementById("wallpaper");
    if (!host) return;
    if (!this.wall?.isConnected) {
      const b = this.makeBrowser({ remote: true });
      b.className = "unk-wall";
      host.insertBefore(b, this.doc.getElementById("wall-dim"));
      this.wall = b;
      this.wallUrl = "";
    }
    const b = this.wall;
    try {
      b.docShellIsActive = true;
      audio ? b.unmute() : b.mute();
    } catch {}
    if (this.wallUrl !== url) {
      this.wallUrl = url;
      this.loadKept(b, url, () => this.wall === b && this.wallUrl === url);
    }
  }

  /** Loads a page into one of the unseen browsers (the wallpaper's, the music's). At the window's start a
   * browser just made may let its first load go and stay on about:blank: it is tried again a moment later,
   * while `still()` says the page is still wanted there. (Another # on the same page carries on in place.) */
  loadKept(b, url, still, tries = 0) {
    if (!still()) return;
    try {
      b.fixupAndLoadURIString(url, { triggeringPrincipal: SYSTEM() });
    } catch {}
    const check = (n) =>
      this.win.setTimeout(() => {
        if (!still() || (b.currentURI && b.currentURI.spec !== "about:blank")) return;
        if (b.webProgress?.isLoadingDocument && n < 20) return check(n + 1);
        if (tries < 6) this.loadKept(b, url, still, tries + 1);
        else console.error("unknowweb: page not loaded", url);
      }, 500);
    check(0);
  }

  /** A YouTube / SoundCloud / Spotify player, unseen, playing a wallpaper's music ('' stops it). */
  musicPage(embed) {
    if (!embed) {
      this.music?.remove();
      this.music = null;
      this.musicUrl = "";
      return;
    }
    if (!this.music?.isConnected) {
      const b = this.makeBrowser({ remote: true });
      b.className = "unk-music";
      this.doc.body.append(b);
      this.music = b;
      this.musicUrl = "";
    }
    try {
      this.music.docShellIsActive = true;
    } catch {}
    if (this.musicUrl !== embed) {
      this.musicUrl = embed;
      const b = this.music;
      this.loadKept(b, embed, () => this.music === b && this.musicUrl === embed);
    }
  }

  musicPause(paused) {
    const mc = this.music?.browsingContext?.mediaController;
    if (!mc) return;
    try {
      paused ? mc.pause() : mc.play();
    } catch {}
  }

  idOf(browser) {
    return this.byBrowser.get(browser)?.id || null;
  }

  tabFor(browser) {
    return this.byBrowser.get(browser) || null;
  }
}
