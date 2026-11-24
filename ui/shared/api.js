// The bridge to the browser (Rust side), shared by the shell and the unk:// pages.
const T = window.__TAURI__;

// (options carry the headers of a raw-bytes call, such as a file's name)
export const invoke = (cmd, args, options) => T.core.invoke(cmd, args, options);
export const listen = (event, cb) => T.event.listen(event, (e) => cb(e.payload));

export const NEWTAB = 'unk://newtab';
// Wings' own wallpaper, the default one (ui/assets/wallpapers), and its small picture
export const DEFAULT_WALLPAPER = new URL('../assets/wallpapers/wings-default.jpg', import.meta.url).href;
export const DEFAULT_WALLPAPER_THUMB = new URL('../assets/wallpapers/wings-default-thumb.jpg', import.meta.url).href;
export const isInternal = (url) => /^unk:/i.test(url || '');
export const isNewTab = (url) => /^unk:\/\/newtab\/?$/i.test(url || '');

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) p.startsWith('--') ? node.style.setProperty(p, x) : (node.style[p] = x);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/** Vietnamese without its marks, lowercase: "tieng viet" finds "Tiếng Việt". */
export const fold = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');

/** A site's icon: the page's own when known, else a letter tile drawn in place. */
export function favicon(url, given) {
  if (given) return given;
  const host = hostOf(url);
  return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32` : '';
}

export function fmtBytes(n) {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) (n /= 1024), i++;
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return new Date(ts).toLocaleDateString('vi-VN');
}

/** What the address bar should open for what was typed: a URL, or a search. */
export function toUrl(input, settings, engines) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (/^(https?|file|about|unk|view-source|edge|data):/i.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s)) return 'http://' + s;
  if (!/\s/.test(s) && /^[^\s/]+\.[a-z¡-￿]{2,}(:\d+)?(\/.*)?$/i.test(s)) return 'https://' + s;
  return searchUrl(s, settings, engines);
}

export function searchUrl(q, settings, engines) {
  const g = settings.general;
  const tpl = g.searchEngine === 'custom' ? g.customSearchUrl : engines[g.searchEngine]?.url || engines.google.url;
  return tpl.replace('%s', encodeURIComponent(q));
}
