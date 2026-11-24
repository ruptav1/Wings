// A page's alert / confirm / prompt (and sign-in to a site): the engine's prompt service asks the
// "Prompt" actor of the page's window; here it becomes the interface's own dialog over that tab.
let seq = 1;
const pending = new Map(); // id -> resolve

export function answerPrompt(id, reply) {
  const done = pending.get(id);
  if (!done) return false;
  pending.delete(id);
  done(reply);
  return true;
}

export class PromptParent extends JSWindowActorParent {
  receiveMessage(m) {
    if (m.name !== "Prompt:Open") return undefined;
    const args = m.data;
    const browser = this.browsingContext.top.embedderElement;
    const win = browser?.documentGlobal;
    const host = win?.__unkTabs;
    const t = host?.tabFor(browser);
    if (!t) return { ...args, promptAborted: true };
    const id = seq++;
    let origin = "";
    try {
      origin = args.authOrigin || args.promptPrincipal?.URI?.displayHostPort || this.browsingContext.currentWindowGlobal?.documentURI?.displayHostPort || "";
    } catch {}
    host.B.emit("page-dialog", {
      win: host.label,
      tab: t.id,
      id,
      type: args.promptType,
      title: args.title || "",
      text: args.text || "",
      value: args.value ?? "",
      user: args.user ?? "",
      checkLabel: args.checkLabel || "",
      checked: !!args.checked,
      buttons: [args.button0Label, args.button1Label, args.button2Label].filter((x) => x != null && x !== ""),
      flags: args.buttonFlags || 0,
      origin,
      unload: !!args.inPermitUnload,
    });
    return new Promise((resolve) => {
      pending.set(id, (r) => {
        const out = { ...args };
        if (r == null) {
          out.ok = false;
          out.buttonNumClicked = 1;
          if (args.promptType === "alert" || args.promptType === "alertCheck") out.ok = true;
        } else {
          out.ok = !!r.ok;
          if ("value" in r) out.value = r.value;
          if ("user" in r) out.user = r.user;
          if ("pass" in r) out.pass = r.pass;
          if ("checked" in r) out.checked = !!r.checked;
          out.buttonNumClicked = typeof r.button === "number" ? r.button : r.ok ? 0 : 1;
        }
        resolve(out);
      });
      // (the tab closes or goes elsewhere: the page is answered as cancelled)
      this._abort = () => answerPrompt(id, null);
    });
  }

  didDestroy() {
    this._abort?.();
  }
}

