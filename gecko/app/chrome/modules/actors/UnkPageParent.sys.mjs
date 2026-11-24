// The main-process side of UnkPageChild: hands what a page tells to the tab it is in.
import { Core } from "resource://unknowweb/Core.sys.mjs";

function hostOf(browser) {
  const win = browser?.documentGlobal;
  return win?.__unkTabs || null;
}

export class UnkPageParent extends JSWindowActorParent {
  get browser() {
    return this.browsingContext.top.embedderElement;
  }

  receiveMessage(m) {
    const browser = this.browser;
    const host = hostOf(browser);
    switch (m.name) {
      case "Cosmetic":
        try {
          return Core.call("page_cosmetic", { url: m.data.url });
        } catch {
          return null;
        }
      case "Shields":
        host?.onShields(browser, m.data);
        return null;
      case "Icon":
        host?.onIcon(browser, m.data.url);
        return null;
      case "MangaHint":
        host?.onMangaHint(browser, m.data.count);
        return null;
      case "ContextMenu":
        host?.onContextMenu(browser, m.data, this);
        return null;
      case "OpenLink":
        host?.onOpenLink(browser, m.data);
        return null;
      case "Close":
        host?.onCloseRequested(browser);
        return null;
      case "Zoom":
        host?.onZoomStep(browser, m.data.step);
        return null;
      case "Fullscreen:Request": {
        const win = browser?.documentGlobal;
        if (!win) return null;
        win.__unkFullscreenRequest = this;
        win.windowUtils.remoteFrameFullscreenChanged(browser);
        return null;
      }
      case "Fullscreen:Exit": {
        const win = browser?.documentGlobal;
        if (win?.document.fullscreenElement) win.windowUtils.remoteFrameFullscreenReverted();
        return null;
      }
    }
    return null;
  }

  /** The chrome window is in full screen for this page: each frame down to the asking one follows. */
  enteredFullscreen() {
    const chain = [];
    for (let bc = this.browsingContext; bc; bc = bc.parent) chain.unshift(bc);
    for (let i = 0; i < chain.length - 1; i++) {
      try {
        chain[i].currentWindowGlobal?.getActor("UnkPage").sendAsyncMessage("Fullscreen:Entered", { remoteFrameBC: chain[i + 1] });
      } catch {}
    }
    try {
      this.sendAsyncMessage("Fullscreen:Entered", {});
    } catch {}
  }

  exitedFullscreen() {
    for (let bc = this.browsingContext; bc; bc = bc.parent) {
      try {
        bc.currentWindowGlobal?.getActor("UnkPage").sendAsyncMessage("Fullscreen:CleanUp", { remoteFrameBC: bc === this.browsingContext ? null : bc });
      } catch {}
    }
  }
}
