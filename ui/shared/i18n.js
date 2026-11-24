// The interface's language: Vietnamese (the source text) or English.
// t(vietnamese, ...values) gives the text in the chosen language, {0} {1}… filled with the values.
// Pages need not wrap every string: watch() translates text and tooltips as they appear in the DOM.
const T = window.__TAURI__;
const settings = await T.core.invoke('settings_get').catch(() => null);
const pick = settings?.general?.language || '';
// (Vietnamese unless English is chosen in Settings → Chung → Ngôn ngữ)
export const LANG = pick === 'en' ? 'en' : 'vi';
export const LOCALE = LANG === 'vi' ? 'vi-VN' : 'en-US';
const dict = LANG === 'en' ? await fetch(new URL('./en.json', import.meta.url)).then((r) => r.json()).catch(() => ({})) : {};

export function t(key, ...vals) {
  let s = dict[key] ?? key;
  if (vals.length) s = s.replace(/\{(\d+)\}/g, (m, i) => String(vals[i] ?? ''));
  return s;
}

const ATTRS = ['title', 'placeholder', 'aria-label'];

function translateText(n) {
  const v = n.nodeValue;
  const k = v.trim();
  if (!k) return;
  if (dict[k] !== undefined) n.nodeValue = v.replace(k, dict[k]);
  else {
    // "Lịch sử (Ctrl+H)"-like text: the words before a key hint
    const m = k.match(/^(.*?)(\s*\([^()]*\))$/);
    if (m && dict[m[1]] !== undefined) n.nodeValue = v.replace(m[1], dict[m[1]]);
  }
}

function translateEl(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (v && dict[v] !== undefined) el.setAttribute(a, dict[v]);
  }
}

export function translateTree(root) {
  if (LANG === 'vi' || !root) return;
  if (root.nodeType === 3) return translateText(root);
  if (root.nodeType !== 1 && root.nodeType !== 9) return;
  const base = root.nodeType === 9 ? root.documentElement : root;
  translateEl(base);
  const w = document.createTreeWalker(base, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) {
      const p = n.parentNode?.nodeName;
      if (p !== 'SCRIPT' && p !== 'STYLE' && p !== 'TEXTAREA') translateText(n);
    } else translateEl(n);
  }
}

/** Keeps the page translated as its code adds text (menus, lists, settings rows…). */
export function watch(root = document) {
  if (LANG === 'vi') return;
  translateTree(root);
  if (document.title && dict[document.title]) document.title = dict[document.title];
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(translateTree);
      else if (m.type === 'characterData') translateText(m.target);
      else if (m.type === 'attributes') translateEl(m.target);
    }
  }).observe(root.documentElement || root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

document.documentElement.lang = LANG;
