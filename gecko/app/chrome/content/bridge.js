// The Tauri API the interface was written against (window.__TAURI__), on the Gecko core: the same
// ui/ files run here unchanged. Loaded first in the browser window and in each unk:// page.
/* eslint-env browser */
/* global ChromeUtils, Services */
(() => {
  const { Backend } = ChromeUtils.importESModule("resource://unknowweb/Backend.sys.mjs");
  Backend.start();

  // Gecko filters HTML set into privileged documents (form fields, buttons and lists are dropped);
  // the interface's own markup is set as written, as in any page.
  const inner = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(Element.prototype, "innerHTML", {
    configurable: true,
    enumerable: true,
    get: inner.get,
    set(v) {
      this.setHTMLUnsafe(String(v ?? ""));
    },
  });
  const fragmentOf = (html) => {
    const t = document.createElement("template");
    t.setHTMLUnsafe(String(html ?? ""));
    return t.content;
  };
  Element.prototype.insertAdjacentHTML = function (where, html) {
    const f = fragmentOf(html);
    switch (String(where).toLowerCase()) {
      case "beforebegin":
        return this.before(f);
      case "afterbegin":
        return this.prepend(f);
      case "beforeend":
        return this.append(f);
      case "afterend":
        return this.after(f);
    }
    throw new DOMException("bad position", "SyntaxError");
  };
  const outer = Object.getOwnPropertyDescriptor(Element.prototype, "outerHTML");
  Object.defineProperty(Element.prototype, "outerHTML", {
    configurable: true,
    enumerable: true,
    get: outer.get,
    set(v) {
      this.replaceWith(fragmentOf(v));
    },
  });
  const isShell = location.href === "chrome://unknowweb/content/ui/index.html";

  const invoke = (cmd, args, options) =>
    Promise.resolve()
      .then(() => Backend.invoke(cmd, args, options, window))
      .then((v) => (v === undefined ? null : v));
  const listen = (event, cb) => Promise.resolve(Backend.listen(event, cb, window));

  // the window, as Tauri's getCurrentWindow() saw it
  const winListeners = { resized: new Set(), focus: new Set() };
  let lastFocused = null;
  if (isShell) {
    Backend.listen(
      "unk-window",
      ({ payload }) => {
        if (payload.win !== window.__unkLabel) return;
        for (const f of winListeners.resized) f({ payload: {} });
        if (payload.focused !== lastFocused) {
          lastFocused = payload.focused;
          for (const f of winListeners.focus) f({ payload: payload.focused });
        }
      },
      window
    );
  }
  const appWindow = {
    isMaximized: async () => window.windowState === window.STATE_MAXIMIZED,
    isFullscreen: async () => !!window.fullScreen,
    onResized: async (f) => (winListeners.resized.add(f), () => winListeners.resized.delete(f)),
    onFocusChanged: async (f) => (winListeners.focus.add(f), () => winListeners.focus.delete(f)),
    // (the window's edges are Windows' own here)
    startResizeDragging: async () => {},
    startDragging: async () => {},
  };

  window.__TAURI__ = {
    gecko: true,
    core: { invoke },
    event: { listen },
    window: { getCurrentWindow: () => appWindow },
  };

  if (!isShell) return;

  // ---------- the browser window itself ----------
  Services.scriptloader.loadSubScript("chrome://global/content/customElements.js", window);
  const root = document.documentElement;
  root.setAttribute("windowtype", "unknowweb:browser");
  // the interface draws its own title bar (Windows keeps the edges for resizing)
  root.setAttribute("customtitlebar", "true");
  root.classList.add("gecko");

  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "chrome://unknowweb/content/gecko.css";
  document.head.append(css);

  window.addEventListener(
    "DOMContentLoaded",
    () => {
      // (the pages' <select> lists: the engine makes their popup itself, in a <popupset> here)
      // the pages' tooltips (title="…")
      const tip = document.createElement("div");
      tip.id = "unk-tooltip";
      tip.hidden = true;
      document.body.append(tip);
      Backend.listen(
        "page-tooltip",
        ({ payload }) => {
          if (payload.win !== window.__unkLabel) return;
          if (!payload.text) return (tip.hidden = true);
          tip.textContent = payload.text;
          tip.hidden = false;
          const r = tip.getBoundingClientRect();
          tip.style.left = `${Math.max(4, Math.min(innerWidth - r.width - 4, payload.x))}px`;
          tip.style.top = `${Math.min(innerHeight - r.height - 4, payload.y + 20)}px`;
        },
        window
      );
    },
    { once: true }
  );
})();
