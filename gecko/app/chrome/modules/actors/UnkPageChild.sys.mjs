// In each page's own process: what the browser does inside pages.
// - Shields before the page's scripts: fingerprinting protection and the lists' scriptlets
//   (asked of the main process synchronously when the page's window is made, so they are first);
// - the lists' rules that hide ad slots (a user style sheet: the page's CSP cannot stop it);
// - the page's icon, its context menu, full screen for its videos, Ctrl+wheel zoom, window.close();
// - running a script for the interface ("Đang phát" reads and drives the page's player with it);
// - "Tải truyện tranh": a comic chapter's pictures found in the page (MangaScan.sys.mjs), and a hint to the
//   address bar when a page looks like one.
const HTTP = /^https?:$/;
const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, { MangaScan: "resource://unknowweb/actors/MangaScan.sys.mjs" });

function sandboxFor(win) {
  const sb = Cu.Sandbox(win, {
    sandboxPrototype: win,
    wantXrays: false,
    sameZoneAs: win,
    sandboxName: "Wings Shields",
  });
  sb.__unkWin = win;
  return sb;
}

/** Runs `code` as the page would (its globals, its prototypes), whatever its CSP says. */
function runInPage(win, code) {
  const sb = sandboxFor(win);
  return Cu.evalInSandbox(`(function (window, self, globalThis) {\n${code}\n}).call(__unkWin, __unkWin, __unkWin, __unkWin);`, sb);
}

function evalInPage(win, code) {
  const sb = sandboxFor(win);
  // (the expression's value, as data the interface can read)
  const v = Cu.evalInSandbox(`(function (window, self, globalThis) { return (${code}); }).call(__unkWin, __unkWin, __unkWin, __unkWin)`, sb);
  return v;
}

export class UnkPageChild extends JSWindowActorChild {
  handleEvent(e) {
    const win = this.contentWindow;
    switch (e.type) {
      case "DOMWindowCreated":
        return this.shields(win);
      case "DOMContentLoaded":
        if (e.target !== this.document) return;
        this.cosmetic(win);
        this.cursor(win);
        if (this.browsingContext === this.browsingContext.top) this.sendIcon();
        return;
      case "DOMLinkAdded":
      case "DOMLinkChanged":
        if (this.browsingContext === this.browsingContext.top && /\bicon\b/i.test(e.target?.rel || "")) this.sendIcon();
        return;
      case "pageshow":
        if (e.target !== this.document || this.browsingContext !== this.browsingContext.top) return;
        if (e.persisted) this.sendIcon();
        // (a comic's reader often fills in its pictures after the page has loaded: looked at twice)
        if (HTTP.test(win?.location?.protocol || "")) for (const ms of [1500, 5000]) win.setTimeout(() => this.mangaHint(), ms);
        return;
      case "contextmenu":
        return this.contextMenu(e);
      case "click":
      case "auxclick":
        return this.linkClick(e);
      case "DOMWindowClose":
        if (this.browsingContext === this.browsingContext.top) {
          e.preventDefault();
          this.sendAsyncMessage("Close", {});
        }
        return;
      case "wheel":
        return this.wheelZoom(e);
      case "MozDOMFullscreen:Request":
        this.sendAsyncMessage("Fullscreen:Request", {});
        return;
      case "MozDOMFullscreen:Exit":
        this.sendAsyncMessage("Fullscreen:Exit", {});
        return;
      case "MozDOMFullscreen:Entered":
      case "MozDOMFullscreen:Exited":
        if (this._notSource) {
          delete this._notSource;
          return;
        }
        if (!this.document?.fullscreenElement) this.sendAsyncMessage("Fullscreen:Exit", {});
        return;
    }
  }

  receiveMessage(m) {
    const win = this.contentWindow;
    switch (m.name) {
      case "MangaScan":
        return this.mangaScan(m.data || {});
      case "MangaThumbs":
        return lazy.MangaScan.thumbsOf(win, m.data.urls || []);
      case "MangaPages":
        return lazy.MangaScan.pagesOf(win, m.data.urls || [], m.data.hint || "");
      case "MangaFetch":
        // (a picture the page made itself, blob:…: only the page can read it)
        return win
          .fetch(m.data.url)
          .then((r) => r.arrayBuffer())
          .then((b) => new Uint8Array(b), () => null);
      case "Eval":
        try {
          // (asked by the user through the interface: the page may play, go full screen, open a window)
          this.document?.notifyUserGestureActivation();
          const v = evalInPage(win, m.data.js);
          return Promise.resolve(v).then((r) => JSON.parse(JSON.stringify(r ?? null)), () => null);
        } catch (e) {
          return null;
        }
      case "Fullscreen:Entered": {
        const wu = win?.windowUtils;
        if (!wu) return this.sendAsyncMessage("Fullscreen:Exit", {});
        const bc = m.data.remoteFrameBC;
        if (bc) {
          const frame = bc.embedderElement;
          if (!frame) return this.sendAsyncMessage("Fullscreen:Exit", {});
          this._notSource = true;
          wu.remoteFrameFullscreenChanged(frame);
        } else if (!wu.handleFullscreenRequests() && !this.document.fullscreenElement) {
          this.sendAsyncMessage("Fullscreen:Exit", {});
        }
        return null;
      }
      case "Fullscreen:CleanUp":
        if (this.document?.fullscreenElement) {
          this._notSource = !!m.data.remoteFrameBC;
          win.windowUtils?.exitFullscreen();
        }
        return null;
      case "Selection":
        return String(win?.getSelection?.() || "").slice(0, 2000);
      case "Copy":
        this.docShell?.doCommand(m.data.cmd);
        return null;
    }
    return null;
  }

  // ---------- Shields ----------
  shields(win) {
    if (!win || !HTTP.test(win.location.protocol)) return;
    let s;
    try {
      s = Services.cpmm.sendSyncMessage("UnkWeb:Shields", { url: win.location.href, top: this.browsingContext.top.currentWindowGlobal?.documentURI?.spec || "" })[0];
    } catch {
      return;
    }
    if (!s) return;
    if (this.browsingContext === this.browsingContext.top) this.sendAsyncMessage("Shields", { fp: !!s.fp });
    for (const code of [s.fp, s.lets]) {
      if (!code) continue;
      try {
        runInPage(win, code);
      } catch (e) {
        // (one site's broken scriptlet does not stop the page)
      }
    }
  }

  async cosmetic(win) {
    if (!win || !HTTP.test(win.location.protocol)) return;
    const css = await this.sendQuery("Cosmetic", { url: win.location.href }).catch(() => null);
    if (!css || this.contentWindow !== win) return;
    try {
      win.windowUtils.loadSheetUsingURIString("data:text/css;charset=utf-8," + encodeURIComponent(css), win.windowUtils.USER_SHEET);
    } catch {}
  }

  // ---------- the mouse cursor chosen in Settings (from TyranWeb) ----------
  cursor(win) {
    let c = null;
    try {
      c = Services.cpmm.sharedData.get("unk:cursor");
    } catch {}
    if (!c || !win?.document?.documentElement) return;
    const rules =
      `:root{cursor:${c.arrow || "default"}!important}` +
      `[data-unk-cur=arrow]{cursor:${c.arrow || "default"}!important}[data-unk-cur=hand]{cursor:${c.hand || "pointer"}!important}` +
      `:where(input:not([type=button],[type=submit],[type=reset],[type=checkbox],[type=radio],[type=range],[type=color],[type=file],[type=image]),textarea,[contenteditable]:not([contenteditable=false])){cursor:${c.text || "text"}!important}`;
    try {
      win.windowUtils.loadSheetUsingURIString("data:text/css;charset=utf-8," + encodeURIComponent(rules), win.windowUtils.AUTHOR_SHEET);
    } catch {
      return;
    }
    // (the page's own hand / arrow, found as the pointer comes over it)
    win.document.addEventListener(
      "mouseover",
      (e) => {
        const el = e.target;
        if (!el || el.nodeType !== 1 || el.hasAttribute("data-unk-cur")) return;
        const cur = win.getComputedStyle(el).cursor;
        if (/pointer/.test(cur) && !/^url/.test(cur)) el.setAttribute("data-unk-cur", "hand");
      },
      true
    );
  }

  // ---------- the page's icon ----------
  sendIcon() {
    const doc = this.document;
    if (!doc || !HTTP.test(doc.location?.protocol || "")) return;
    let best = null;
    let bestScore = -1;
    for (const l of doc.querySelectorAll("link[rel][href]")) {
      const rel = l.rel.toLowerCase().split(/\s+/);
      if (!rel.includes("icon") && !rel.includes("apple-touch-icon")) continue;
      // (a small one is best for a tab: 32px, else the smallest above 16)
      const sz = parseInt((l.getAttribute("sizes") || "").split(/[x\s]/i)[0], 10) || (rel.includes("apple-touch-icon") ? 180 : 32);
      const score = (rel.includes("icon") ? 1000 : 0) - Math.abs(sz - 32) + (/\.svg(\?|$)/i.test(l.href) ? 5 : 0);
      if (score > bestScore) (bestScore = score), (best = l.href);
    }
    this.sendAsyncMessage("Icon", { url: best || `${doc.location.origin}/favicon.ico` });
  }

  // ---------- Ctrl + mouse wheel: the page's size ----------
  // (the engine's own Ctrl + wheel zoom is left to Firefox's interface, so it does nothing here.) A notch
  // of a mouse's wheel is a step of the zoom (the same steps as Ctrl + = / Ctrl + -); a touchpad's pinch,
  // which comes as Ctrl + many small pixel moves, a step every 100 px of it. A page that uses Ctrl + wheel
  // itself (a map, a drawing app) and says so keeps it. (Listened to without holding the wheel up: the
  // engine does not scroll a page for Ctrl + wheel.)
  wheelZoom(e) {
    if (!e.isTrusted || !e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.defaultPrevented || !e.deltaY) return;
    let step;
    if (e.deltaMode === 0) {
      // (a pause, or the other way, starts afresh)
      const now = Date.now();
      if (now - (this.zoomAt || 0) > 400 || Math.sign(this.zoomSum || 0) !== Math.sign(e.deltaY)) this.zoomSum = 0;
      this.zoomAt = now;
      this.zoomSum += e.deltaY;
      if (Math.abs(this.zoomSum) < 100) return;
      step = this.zoomSum < 0 ? 1 : -1;
      this.zoomSum = 0;
    } else {
      step = e.deltaY < 0 ? 1 : -1;
    }
    this.sendAsyncMessage("Zoom", { step });
  }

  // ---------- Tải truyện tranh ----------
  /** The chapter's pictures. Lazy ones are known by the address they wait with; when too few are found (a
   * reader that fills itself in by script as it is scrolled), the page is scrolled through once and read
   * again. `scroll`: scroll through it first anyway. */
  async mangaScan({ scroll = false, hint = "" }) {
    const win = this.contentWindow;
    const read = () => lazy.MangaScan.scanDocument(this.document, win.location.href, { hint });
    if (scroll) await lazy.MangaScan.autoScroll(win);
    let r = read();
    if (!scroll && r.items.length < 3 && !r.paged) {
      await lazy.MangaScan.autoScroll(win);
      r = read();
    }
    return r;
  }

  /** Tells the address bar how many comic pages this page shows (it offers to download them). */
  mangaHint() {
    try {
      if (!this.document || this.browsingContext !== this.browsingContext.top) return;
      const n = lazy.MangaScan.quickCount(this.document, this.contentWindow.location.href);
      if (n >= 4 || this._mangaShown) this.sendAsyncMessage("MangaHint", { count: n });
      this._mangaShown = n >= 4;
    } catch {}
  }

  // ---------- links opened with Ctrl / Shift / the middle button ----------
  linkClick(e) {
    if (!e.isTrusted || e.defaultPrevented) return;
    const middle = e.button === 1;
    if (!middle && !(e.button === 0 && (e.ctrlKey || e.metaKey || e.shiftKey))) return;
    // (the middle button gives both: one is enough)
    if (middle && e.type === "click" && this._lastAux === e.timeStamp) return;
    if (e.type === "auxclick") this._lastAux = e.timeStamp;
    const a = (e.composedTarget || e.target).closest?.("a[href], area[href]");
    if (!a || a.hasAttribute("download")) return;
    const url = a.href;
    if (!/^(https?|ftp|file|data|blob):/i.test(url)) return;
    e.preventDefault();
    e.stopPropagation();
    this.sendAsyncMessage("OpenLink", { url, window: e.shiftKey && !middle && !e.ctrlKey, background: !e.shiftKey, referrer: this.document.location.href });
  }

  // ---------- context menu ----------
  contextMenu(e) {
    if (e.defaultPrevented || !e.isTrusted) return;
    // (Shift: the page's own menu is skipped, the browser's shown)
    const t = e.composedTarget || e.target;
    const doc = this.document;
    const link = t.closest?.("a[href], area[href]");
    const media = t.closest?.("img, video, audio, canvas, picture img");
    const editable = t.closest?.("input, textarea, [contenteditable], [contenteditable=''], [contenteditable='true']");
    const win = this.contentWindow;
    const sel = String(win.getSelection?.() || "");
    let mediaKind = "";
    let src = "";
    if (media) {
      mediaKind = media.localName === "img" ? "image" : media.localName;
      src = media.currentSrc || media.src || "";
    }
    // (a picture behind a link: both)
    const isInput = editable && (editable.localName !== "input" || /^(text|search|url|email|tel|password|number|)$/i.test(editable.type || ""));
    const info = {
      x: e.screenX,
      y: e.screenY,
      page: doc.location.href,
      frame: this.browsingContext !== this.browsingContext.top ? doc.location.href : "",
      title: doc.title,
      link: link?.href || "",
      linkText: (link?.textContent || "").trim().slice(0, 200),
      media: mediaKind,
      src,
      selection: sel.slice(0, 1000),
      editable: !!isInput,
      password: editable?.type === "password",
      canUndo: false,
    };
    e.preventDefault();
    this.sendAsyncMessage("ContextMenu", info);
  }
}
