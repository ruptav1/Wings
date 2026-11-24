// The mouse cursor chosen in Settings → Giao diện (from TyranWeb), put on the interface and the
// browser's own pages: its own arrow everywhere, its link cursor wherever a hand would show, its text
// cursor in text fields; an .ani's frames are played. (Websites get it from the page actor.)
import { invoke, listen } from './api.js';

const FALLBACK = { arrow: 'default', hand: 'pointer', text: 'text' };

function cursorKit(doc) {
  let style = null;
  let timers = {};
  let on = false;
  // (an element's own hand / arrow, found as the pointer comes over it)
  doc.addEventListener(
    'mouseover',
    (e) => {
      const el = e.target;
      if (!on || !el || el.nodeType !== 1 || el.hasAttribute('data-unk-cur')) return;
      const c = getComputedStyle(el).cursor;
      if (c === 'pointer') el.setAttribute('data-unk-cur', 'hand');
      else if (c === 'default') el.setAttribute('data-unk-cur', 'arrow');
    },
    true
  );
  return (cfg) => {
    for (const t of Object.values(timers)) clearTimeout(t);
    timers = {};
    for (const k of Object.keys(FALLBACK)) doc.documentElement.style.removeProperty('--unk-cur-' + k);
    on = !!cfg;
    if (!cfg) {
      style?.remove();
      style = null;
      for (const el of doc.querySelectorAll('[data-unk-cur]')) el.removeAttribute('data-unk-cur');
      return;
    }
    style ||= Object.assign(doc.createElement('style'), { id: 'unk-cursor' });
    const slot = (k) => cfg[k]?.css || FALLBACK[k];
    style.textContent =
      `:root{--unk-cur-arrow:${slot('arrow')};--unk-cur-hand:${slot('hand')};--unk-cur-text:${slot('text')};cursor:var(--unk-cur-arrow)!important}` +
      '[data-unk-cur=arrow]{cursor:var(--unk-cur-arrow)!important}[data-unk-cur=hand]{cursor:var(--unk-cur-hand)!important}' +
      ':where(input:not([type=button],[type=submit],[type=reset],[type=checkbox],[type=radio],[type=range],[type=color],[type=file],[type=image]),textarea,[contenteditable]:not([contenteditable=false])){cursor:var(--unk-cur-text)}';
    (doc.head || doc.documentElement).append(style);
    for (const k of Object.keys(FALLBACK)) {
      const frames = cfg[k]?.frames;
      if (!frames?.length) continue;
      let i = 0;
      const next = () => {
        doc.documentElement.style.setProperty('--unk-cur-' + k, frames[i].css);
        const ms = frames[i].ms;
        i = (i + 1) % frames.length;
        timers[k] = setTimeout(next, ms);
      };
      next();
    }
  };
}

/** The interface or a page follows the chosen cursor (now and when it changes). */
export function initCursor(doc = document) {
  const apply = cursorKit(doc);
  invoke('cursor_config').then(apply, () => {});
  listen('cursor-changed', (cfg) => apply(cfg));
}
