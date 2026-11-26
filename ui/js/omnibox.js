// The address bar: what the page is, and where to go next (open tabs, bookmarks, history, the search
// engine's suggestions), with the rest of a known address filled in as one types.
import { invoke, h, esc, isNewTab, isInternal, hostOf, toUrl, searchUrl, fold, debounce } from '../shared/api.js';
import { icon } from '../shared/icons.js';
import { S, $, on, emit } from './state.js';
import { T, active, activate, navigate, createTab } from './tabs.js';
import { cover, uncover } from './view.js';
import { closeFloating } from './menus.js';
import { t as tr } from '../shared/i18n.js';
import { openManga } from './manga.js';

let box, input, list;
let items = [];
let sel = 0;
let typed = ''; // what the user typed (before the filled-in part)
let open = false;
let lastQuery = 0;

export function buildOmnibox() {
  box = h('div', { id: 'omnibox' });
  const site = h('button', { class: 'icon-btn site', title: 'Thông tin trang' });
  input = h('input', { type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder: 'Tìm kiếm hoặc nhập địa chỉ' });
  const zoom = h('button', { class: 'zoom-chip', hidden: true, title: 'Thu phóng (bấm để về 100%)' });
  // (the page looks like a comic chapter: its pictures, ready to download - Tải truyện tranh)
  const manga = h('button', { class: 'manga-chip', hidden: true, title: 'Tải truyện tranh trên trang (Ctrl+Shift+M)' });
  const shield = h('button', { class: 'icon-btn mini shield', title: 'Chặn quảng cáo' });
  const star = h('button', { class: 'icon-btn mini star', title: 'Thêm dấu trang (Ctrl+D)' });
  box.append(site, input, manga, zoom, shield, star);
  manga.addEventListener('click', () => openManga());

  site.addEventListener('click', () => emit('site-info', site));
  star.addEventListener('click', () => emit('bookmark-popover', star));
  shield.addEventListener('click', () => emit('shield', shield));
  zoom.addEventListener('click', () => {
    const t = active();
    if (t) invoke('tab_zoom', { id: t.id, factor: 1 });
  });

  input.addEventListener('focus', () => {
    box.classList.add('focus');
    const t = active();
    input.value = t && !isNewTab(t.url) ? t.url : '';
    requestAnimationFrame(() => input.select());
  });
  input.addEventListener('blur', () => {
    box.classList.remove('focus');
    setTimeout(() => {
      if (document.activeElement !== input) {
        hide();
        sync();
      }
    }, 120);
  });
  input.addEventListener('input', (e) => {
    typed = input.value;
    const deleting = e.inputType?.startsWith('delete');
    query(typed, !deleting);
  });
  input.addEventListener('keydown', onKey);
  on('active', sync);
  on('tab-changed', (t) => t.id === T.activeId && sync());
  on('bookmarks-changed', sync);
  on('hover', (url) => {
    // (from TyranWeb: the link's address in a bubble at the foot of the page, or in the address bar)
    if (S.settings.layout.showStatusBubble !== false) {
      if (input.classList.contains('hovering')) sync();
      return statusBubble(url);
    }
    statusBubble('');
    if (document.activeElement === input) return;
    if (url) {
      input.value = url;
      input.classList.add('hovering');
    } else sync();
  });
  return box;
}

let bubble = null;
let bubbleTimer = 0;
function statusBubble(url) {
  if (!bubble) {
    bubble = h('div', { id: 'status-bubble', hidden: true });
    $('#content').append(bubble);
  }
  clearTimeout(bubbleTimer);
  if (!url) {
    bubble.classList.remove('on');
    bubbleTimer = setTimeout(() => (bubble.hidden = true), 160);
    return;
  }
  let text = url;
  try {
    text = decodeURI(url);
  } catch {}
  bubble.textContent = text;
  bubble.hidden = false;
  requestAnimationFrame(() => bubble.classList.add('on'));
}

on('focus-omnibox', () => invoke('shell_focus').then(() => focusOmnibox()));

export function focusOmnibox(text) {
  input.focus();
  if (text !== undefined) {
    input.value = text;
    typed = text;
    query(text, false);
  }
}

/** Shows the current tab's address (when not being typed in). */
export function sync() {
  if (!box) return;
  const t = active();
  input.classList.remove('hovering');
  if (document.activeElement !== input) input.value = !t || isNewTab(t.url) ? '' : prettyUrl(t.url);
  const site = box.querySelector('.site');
  const url = t?.url || '';
  site.className = 'icon-btn site ' + (isInternal(url) ? 'internal' : url.startsWith('https:') ? 'secure' : url.startsWith('http:') ? 'insecure' : '');
  site.innerHTML = icon(isInternal(url) ? 'apps' : url.startsWith('https:') ? 'lock' : url.startsWith('http:') ? 'warn' : 'search', 15);
  const manga = box.querySelector('.manga-chip');
  manga.hidden = !t || !(t.manga >= 4) || !/^https?:/.test(url);
  if (!manga.hidden) manga.innerHTML = `${icon('image', 14)}<span>${t.manga}</span>`;
  const zoom = box.querySelector('.zoom-chip');
  zoom.hidden = !t || Math.abs(t.zoom - 1) < 0.01;
  if (t) zoom.textContent = `${Math.round(t.zoom * 100)}%`;
  const shield = box.querySelector('.shield');
  const off = (S.settings.privacy.adblockOff || []).includes(hostOf(url));
  shield.hidden = !url.startsWith('http');
  shield.innerHTML = icon(!off ? 'shieldCheck' : 'shield', 16) + (!off && t?.blocked ? `<span class="n">${t.blocked > 99 ? '99+' : t.blocked}</span>` : '');
  shield.classList.toggle('down', off);
  shield.title = !off ? `Shields · ${tr('Đã chặn {0} mục trên trang này', t?.blocked || 0)}` : tr('Shields đang tắt cho trang này');
  const star = box.querySelector('.star');
  const marked = S.bookmarks.items.some((b) => b.url === url);
  star.innerHTML = icon('star', 16);
  star.classList.toggle('on', marked);
  star.querySelector('svg').setAttribute('fill', marked ? 'currentColor' : 'none');
  star.hidden = !t || isNewTab(url);
}

function prettyUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && u.pathname === '/' && !u.search && !u.hash) return u.host;
  } catch {}
  return url;
}

// ---------- suggestions ----------
const fetchSuggest = debounce(async (q, n) => {
  const g = S.settings.general;
  const eng = S.engines[g.searchEngine];
  if (!g.searchSuggestions || !eng?.suggest || !q.trim()) return;
  try {
    const res = await invoke('suggest_fetch', { url: eng.suggest.replace('%s', encodeURIComponent(q)) });
    if (n !== lastQuery || !open) return;
    const words = (Array.isArray(res) ? res[1] : []) || [];
    const extra = words
      .filter((w) => typeof w === 'string' && w.toLowerCase() !== q.toLowerCase())
      .slice(0, 5)
      .map((w) => ({ kind: 'search', title: w, url: searchUrl(w, S.settings, S.engines) }));
    items = [...items.filter((i) => i.kind !== 'search' || i.first), ...extra];
    draw();
  } catch {}
}, 120);

async function query(q, autofill) {
  const n = ++lastQuery;
  const text = q.trim();
  if (!text) return hide();
  // (open tabs and bookmarks match as the history does: every word typed, in any order, with or
  // without marks, in the title or the address)
  const words = text.split(/\s+/).map(fold);
  const decoded = (u) => {
    try {
      return decodeURI(u);
    } catch {
      return u;
    }
  };
  const matches = (title, url) => {
    const s = fold(`${title || ''} ${decoded(url || '')}`);
    return words.every((w) => s.includes(w));
  };
  const first = toUrl(text, S.settings, S.engines);
  const isSearch = first.startsWith(searchUrl('', S.settings, S.engines).replace(/%s|$/, '')) && !/^https?:\/\/[^/]+\.[^/]+/.test(text);
  const out = [{ kind: isSearch ? 'search' : 'url', title: text, url: first, first: true }];
  // open tabs
  for (const t of T.list) {
    if (t.id !== T.activeId && matches(t.title, t.url)) out.push({ kind: 'tab', title: t.title, url: t.url, id: t.id });
    if (out.length > 3) break;
  }
  // bookmarks
  for (const b of S.bookmarks.items) {
    if (matches(b.title, b.url)) out.push({ kind: 'bookmark', title: b.title, url: b.url });
    if (out.filter((o) => o.kind === 'bookmark').length >= 3) break;
  }
  items = out;
  showList();
  draw();
  let hist = [];
  try {
    hist = await invoke('history_suggest', { text });
  } catch {}
  if (n !== lastQuery) return;
  const seen = new Set(items.map((i) => i.url));
  const histItems = hist.filter((x) => !seen.has(x.url)).slice(0, 5).map((x) => ({ kind: 'history', title: x.title || x.url, url: x.url }));
  items = [items[0], ...items.slice(1), ...histItems];
  // fill in the rest of a known address
  if (autofill && hist[0] && !/\s/.test(text)) {
    const bare = hist[0].url.replace(/^https?:\/\/(www\.)?/, '');
    if (bare.toLowerCase().startsWith(text.toLowerCase()) && input.value === q) {
      const host = bare.split('/')[0];
      const fill = host.toLowerCase().startsWith(text.toLowerCase()) && host.length > text.length ? host : '';
      if (fill) {
        input.value = text + fill.slice(text.length);
        input.setSelectionRange(text.length, input.value.length);
        items[0] = { kind: 'url', title: fill, url: hist[0].url.match(/^https?:\/\/(www\.)?[^/]+/)[0] + '/', first: true };
        // (the page filled in is not listed a second time below it)
        const bareOf = (u) => u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '').toLowerCase();
        items = items.filter((it, i) => i === 0 || bareOf(it.url || '') !== bareOf(items[0].url));
      }
    }
  }
  sel = 0;
  draw();
  fetchSuggest(text, n);
}

function showList() {
  if (open) return;
  open = true;
  closeFloating();
  list = h('div', { class: 'suggest' });
  const r = box.getBoundingClientRect();
  Object.assign(list.style, { left: `${r.left}px`, top: `${r.bottom - 2}px`, width: `${r.width}px` });
  list.addEventListener('pointerdown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.s');
    if (row) go(items[+row.dataset.i], e.ctrlKey || e.button === 1);
  });
  $('#layer').append(list);
  cover();
}

function hide() {
  if (!open) return;
  open = false;
  list?.remove();
  list = null;
  uncover();
}

const KIND = { search: ['search', ''], url: ['globe', ''], tab: ['tabs', 'Chuyển tới tab'], bookmark: ['star', 'Dấu trang'], history: ['history', ''] };

function draw() {
  if (!list) return;
  list.innerHTML = items
    .map((it, i) => {
      const [ic, kind] = KIND[it.kind];
      const showUrl = it.kind !== 'search' && it.title !== it.url;
      return `<div class="s ${i === sel ? 'sel' : ''}" data-i="${i}">${icon(ic, 16)}<span class="t">${esc(it.title)}</span>${showUrl ? `<span class="u">— ${esc(it.url)}</span>` : '<span class="u"></span>'}${kind ? `<span class="kind">${kind}</span>` : ''}</div>`;
    })
    .join('');
}

function go(it, newTab = false) {
  if (!it) return;
  hide();
  input.blur();
  if (it.kind === 'tab') return activate(it.id);
  const t = active();
  if (newTab || !t) createTab({ url: it.url });
  else navigate(t, it.url);
}

function onKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!open || !items.length) return;
    e.preventDefault();
    sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    const it = items[sel];
    input.value = it.kind === 'search' ? it.title : it.url;
    draw();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    let it = open && items[sel];
    if (!it || (sel === 0 && input.value !== typed && !input.selectionStart)) {
      const v = input.value.trim();
      if (!v) return;
      it = sel === 0 && items[0]?.first && input.value.length > typed.length ? items[0] : { kind: 'url', url: toUrl(v, S.settings, S.engines) };
    }
    // Ctrl+Enter: www.<text>.com
    if (e.ctrlKey && !/[.\s/]/.test(typed.trim())) it = { kind: 'url', url: `https://www.${typed.trim()}.com/` };
    go(it, e.altKey);
  } else if (e.key === 'Escape') {
    if (open) hide();
    else {
      sync();
      input.blur();
      const t = active();
      if (t) invoke('tab_focus', { id: t.id });
    }
    e.preventDefault();
  } else if (e.key === 'Delete' && open && items[sel]?.kind === 'history' && e.shiftKey) {
    e.preventDefault();
    invoke('history_delete', { url: items[sel].url });
    items.splice(sel, 1);
    draw();
  }
}
