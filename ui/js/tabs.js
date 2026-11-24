// Tabs: the model, the strip (along the top or down the side) and what happens to each tab's WebView2.
//
// A tab is "live" while it has a WebView2. Background tabs are frozen after a few minutes (WebView2
// suspends the page and gives memory back) and put to sleep later (the WebView2 is closed; the tab keeps
// its address and title and loads again when picked).
import { invoke, listen, NEWTAB, isNewTab, isInternal, hostOf, h, esc, debounce } from '../shared/api.js';
import { icon } from '../shared/icons.js';
import { S, $, emit, on } from './state.js';
import { layout, rectFor, forget, isShown } from './view.js';
import { menu, toast } from './menus.js';
import { t as tr } from '../shared/i18n.js';

export const T = { list: [], activeId: null, closed: [], seq: 0, panel: null };
export const byId = (id) => (id ? T.list.find((t) => t.id === id) || (T.panelTab?.id === id ? T.panelTab : null) : null);
export const active = () => byId(T.activeId);

const MAX_CLOSED = 25;

export function zoomFor(url) {
  const z = S.settings?.zoom?.[hostOf(url)];
  return typeof z === 'number' ? z : 1;
}

function newId() {
  return `${S.win}-${Date.now().toString(36)}${(++T.seq).toString(36)}`;
}

function blankTitle(url) {
  return isNewTab(url) ? tr('Tab mới') : url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

/** Opens a tab. `sleeping`: kept without a WebView2 until picked (a restored session's tabs). */
export function createTab(o = {}) {
  const url = o.url || NEWTAB;
  const tab = {
    id: o.id || newId(),
    url,
    title: o.title || blankTitle(url),
    favicon: o.favicon || '',
    pinned: !!o.pinned,
    loading: false,
    live: false,
    audible: false,
    muted: false,
    canBack: false,
    canForward: false,
    zoom: o.zoom || zoomFor(url),
    blocked: 0,
    crashed: false,
    lastActive: Date.now(),
    hiddenSince: Date.now(),
    frozen: false,
    openerId: o.openerId || null,
    // (its back / forward list, from the last run or from where it came from: given to its page when it loads)
    history: o.history || null,
    historyFrom: o.historyFrom || null,
    media: [], // videos and sounds found on the page (media.js)
  };
  let index = T.list.length;
  if (typeof o.index === 'number') index = o.index;
  else if (o.openerId) {
    // after the tab that opened it, and after the ones it already opened
    let i = T.list.findIndex((t) => t.id === o.openerId);
    if (i >= 0) {
      while (T.list[i + 1]?.openerId === o.openerId) i++;
      index = i + 1;
    }
  }
  if (tab.pinned) index = Math.min(index, T.list.filter((t) => t.pinned).length);
  else index = Math.max(index, T.list.filter((t) => t.pinned).length);
  T.list.splice(index, 0, tab);
  born.add(tab.id);
  // (a new tab page is drawn by the shell: no WebView2 until it goes somewhere)
  if (!o.sleeping && !isNewTab(url)) ensureLive(tab, !o.background);
  if (!o.background) {
    activate(tab.id, { focus: !isNewTab(url) });
    if (isNewTab(url) && !o.sleeping) emit('focus-omnibox');
  } else render();
  saveSession();
  return tab;
}

export function ensureLive(tab, show) {
  if (tab.live) return;
  tab.live = true;
  tab.loading = !isInternal(tab.url);
  const history = tab.history;
  const restoreFrom = tab.historyFrom || tab.id;
  tab.history = tab.historyFrom = null;
  invoke('tab_create', { id: tab.id, url: tab.url, private: S.private, bounds: rectFor(tab.id), show: false, zoom: tab.zoom, history, restoreFrom })
    .then(() => {
      if (show || tab.id === T.activeId) layout(tab.id === T.activeId && !isNewTab(tab.url) && document.activeElement?.tagName !== 'INPUT');
    })
    .catch((e) => {
      tab.live = false;
      toast(tr('Không mở được tab: ') + e);
    });
}

export function activate(id, { focus = true } = {}) {
  const tab = byId(id);
  if (!tab) return;
  const prev = active();
  if (prev && prev.id !== id) prev.hiddenSince = Date.now();
  T.activeId = id;
  tab.lastActive = Date.now();
  if (S.split && id !== S.split.a && id !== S.split.b) S.split = null;
  if (!tab.live && !isNewTab(tab.url)) ensureLive(tab, true);
  else layout(focus && tab.live && !isNewTab(tab.url));
  render();
  emit('active', tab);
  saveSession();
}

export function closeTab(id) {
  const i = T.list.findIndex((t) => t.id === id);
  if (i < 0) return;
  const tab = T.list[i];
  if (!S.private && !isNewTab(tab.url)) {
    T.closed.push({ url: tab.url, title: tab.title, favicon: tab.favicon, index: i, pinned: tab.pinned, fromId: tab.id });
    if (T.closed.length > MAX_CLOSED) T.closed.shift();
  }
  if (tab.live) invoke('tab_close', { id });
  forget(id);
  T.list.splice(i, 1);
  if (S.split && (S.split.a === id || S.split.b === id)) S.split = null;
  if (T.activeId === id) {
    if (!T.list.length) {
      saveSession(true);
      return invoke('win_action', { action: 'close' });
    }
    const opener = tab.openerId && byId(tab.openerId);
    const next = opener && opener.lastActive > tab.lastActive - 600000 ? opener : T.list[Math.min(i, T.list.length - 1)];
    activate(next.id);
  } else render();
  saveSession();
}

export function reopenClosed() {
  const c = T.closed.pop();
  if (!c) return;
  createTab({ url: c.url, title: c.title, favicon: c.favicon, pinned: c.pinned, index: Math.min(c.index, T.list.length), historyFrom: c.fromId || null });
}

export function navigate(tab, url) {
  if (!tab || !url) return;
  // to the new tab page: the shell draws it, the tab's WebView2 goes
  if (isNewTab(url) && !(S.split && (S.split.a === tab.id || S.split.b === tab.id))) {
    if (tab.live) {
      invoke('tab_close', { id: tab.id });
      forget(tab.id);
    }
    Object.assign(tab, { url: NEWTAB, title: blankTitle(NEWTAB), favicon: '', live: false, loading: false, canBack: false, canForward: false, ntpBack: false, audible: false, media: [], blocked: 0 });
    render();
    layout();
    emit('tab-changed', tab);
    if (tab.id === T.activeId) emit('focus-omnibox');
    saveSession();
    return;
  }
  const fromNtp = !tab.live && isNewTab(tab.url);
  tab.url = url;
  if (fromNtp) {
    // (Back returns to the new tab page)
    tab.ntpBack = true;
    tab.title = blankTitle(url);
  }
  tab.title = tab.title || blankTitle(url);
  if (!tab.live) {
    ensureLive(tab, tab.id === T.activeId);
  } else invoke('tab_load', { id: tab.id, url });
  if (!isInternal(url)) tab.loading = true;
  render();
  emit('tab-changed', tab);
}

/** Back, with the new tab page the tab came from as its first step. */
export function goBack(tab) {
  if (!tab) return;
  if (tab.live && tab.canBack) invoke('tab_nav', { id: tab.id, action: 'back' });
  else if (tab.ntpBack) navigate(tab, NEWTAB);
}

export function sleepTab(tab) {
  if (!tab?.live || tab.id === T.activeId) return;
  invoke('tab_close', { id: tab.id });
  forget(tab.id);
  tab.live = false;
  tab.loading = false;
  tab.audible = false;
  render();
}

export function moveTab(id, to) {
  const from = T.list.findIndex((t) => t.id === id);
  if (from < 0 || from === to) return;
  const [t] = T.list.splice(from, 1);
  T.list.splice(to, 0, t);
  render();
  saveSession();
}

export function togglePin(tab) {
  tab.pinned = !tab.pinned;
  const others = T.list.filter((t) => t !== tab);
  const pins = others.filter((t) => t.pinned).length;
  T.list = [...others.slice(0, pins), tab, ...others.slice(pins)];
  if (!tab.pinned) {
    T.list = [...T.list.filter((t) => t.pinned), ...T.list.filter((t) => !t.pinned)];
  }
  render();
  saveSession();
}

export function toggleMute(tab) {
  tab.muted = !tab.muted;
  invoke('tab_mute', { id: tab.id, muted: tab.muted });
  render();
}

export function duplicate(tab) {
  const i = T.list.indexOf(tab);
  createTab({ url: tab.url, title: tab.title, favicon: tab.favicon, index: i + 1, historyFrom: tab.live ? tab.id : null, history: tab.live ? null : tab.history });
}

export function splitWith(tab) {
  const cur = active();
  if (!cur || cur.id === tab.id) {
    // split the current tab with a new one
    const t = createTab({ url: NEWTAB, background: true, index: T.list.indexOf(cur) + 1 });
    S.split = { a: cur.id, b: t.id, ratio: 0.5 };
    ensureLive(t, true);
  } else S.split = { a: cur.id, b: tab.id, ratio: 0.5 };
  // (both halves are pages: a new tab page the shell was drawing becomes one)
  for (const id of [S.split.a, S.split.b]) if (!byId(id).live) ensureLive(byId(id), true);
  layout();
  render();
}

export function toggleSplit() {
  if (S.split) {
    S.split = null;
    layout();
    render();
  } else splitWith(active());
}

// ---------- events from the tabs' WebView2s ----------
const saveZoom = debounce((host, z) => {
  if (host) invoke('settings_set', { patch: { zoom: { [host]: Math.round(z * 100) / 100 } } });
}, 600);

export function initTabEvents() {
  listen('tab', (p) => {
    const t = byId(p.id);
    if (!t) return;
    let strip = false;
    if ('url' in p && p.url !== t.url) {
      if (hostOf(p.url) !== hostOf(t.url)) t.favicon = '';
      t.url = p.url;
      strip = true;
      emit('tab-changed', t);
    }
    if ('title' in p) {
      t.title = p.title || blankTitle(t.url);
      strip = true;
    }
    if ('favicon' in p) {
      t.favicon = p.favicon;
      strip = true;
    }
    if ('loading' in p) {
      t.loading = p.loading;
      strip = true;
      emit('tab-changed', t);
    }
    if ('canBack' in p) {
      t.canBack = p.canBack;
      t.canForward = p.canForward;
      emit('tab-changed', t);
    }
    if ('audible' in p) {
      t.audible = p.audible;
      strip = true;
    }
    if (Array.isArray(p.media)) {
      t.media = [];
      emit('tab-changed', t);
    }
    if ('blocked' in p) {
      t.blocked = p.blocked;
      emit('tab-changed', t);
    }
    // Shields on the page just loaded (shields.rs): over HTTPS by our doing, fingerprinting protected
    if ('httpsUpgraded' in p) {
      t.httpsUpgraded = !!p.httpsUpgraded;
      t.fpProtected = !!p.fpProtected;
      t.cleaned = !!p.cleaned;
      emit('tab-changed', t);
    }
    if ('crashed' in p && p.crashed) {
      t.crashed = true;
      toast(tr('Trang "{0}" đã dừng hoạt động', t.title), { action: { label: tr('Tải lại'), run: () => invoke('tab_nav', { id: t.id, action: 'reload' }) } });
    }
    // (how many comic pages the page shows: the address bar offers to download them)
    if ('manga' in p && p.manga !== t.manga) {
      t.manga = p.manga;
      emit('tab-changed', t);
    }
    if ('zoom' in p && Math.abs(p.zoom - t.zoom) > 0.001) {
      t.zoom = p.zoom;
      saveZoom(hostOf(t.url), p.zoom);
      emit('tab-changed', t);
    }
    if ('status' in p && t.id === T.activeId) {
      S.hover = p.status;
      emit('hover', p.status);
    }
    if ('fullscreen' in p) emit('html-fullscreen', p.fullscreen);
    if (p.closeRequested) closeTab(t.id);
    if (strip) {
      renderSoon();
      saveSession();
    }
  });
  listen('tab-open', (p) => {
    if (p.win !== S.win) return;
    createTab({ url: p.url, background: !!p.background, openerId: p.opener || null, id: p.id || undefined, historyFrom: p.historyFrom || null });
  });

  // freeze, then sleep, tabs out of sight
  setInterval(() => {
    const g = S.settings.general;
    const freezeMs = (g.tabFreezeMinutes || 0) * 60000;
    const sleepMs = (g.tabSleepMinutes || 0) * 60000;
    const now = Date.now();
    for (const t of T.list) {
      if (!t.live || isShown(t.id) || t.audible) continue;
      const idle = now - t.hiddenSince;
      if (sleepMs && idle > sleepMs && !t.pinned) sleepTab(t);
      else if (freezeMs && idle > freezeMs && !t.frozen) {
        t.frozen = true;
        invoke('tab_freeze', { id: t.id });
      }
    }
  }, 30000);
}

// ---------- the session ----------
let saveTimer;
export function saveSession(now = false) {
  if (S.private) return;
  clearTimeout(saveTimer);
  const doSave = () => {
    // (a tab's back / forward list is added by the browser: id, and the list a sleeping tab still holds)
    const tabs = T.list.map((t) => ({ url: t.url, title: t.title, favicon: t.favicon, pinned: t.pinned, id: t.id, live: t.live, history: t.live ? undefined : t.history || undefined }));
    const activeIndex = Math.max(0, T.list.findIndex((t) => t.id === T.activeId));
    invoke('session_save', { session: { tabs, active: activeIndex }, closed: T.closed.slice(-MAX_CLOSED) });
  };
  if (now) doSave();
  else saveTimer = setTimeout(doSave, 800);
}
on('session', () => saveSession());

// ---------- the strip ----------
let renderPending = false;
function renderSoon() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    render();
  });
}

function favEl(t) {
  if (t.loading) return '<span class="spin"></span>';
  if (isNewTab(t.url)) return icon('plus', 16, 'fav');
  if (isInternal(t.url)) return icon(/^unk:\/\/store/.test(t.url) ? 'image' : /^unk:\/\/taskmgr/.test(t.url) ? 'layers' : t.url.includes('settings') ? 'sliders' : t.url.includes('history') ? 'history' : t.url.includes('download') ? 'download' : t.url.includes('bookmark') ? 'bookmark' : 'apps', 16, 'fav');
  if (t.favicon) return `<img class="fav" src="${esc(t.favicon)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'fav letter',textContent:${esc(JSON.stringify((hostOf(t.url)[0] || '?').toUpperCase()))}}))">`;
  return `<span class="fav letter">${esc((hostOf(t.url)[0] || '?').toUpperCase())}</span>`;
}

function tabEl(t) {
  const asleep = !t.live && !isNewTab(t.url);
  const cls = ['tab', t.id === T.activeId && 'active', t.pinned && 'pinned', asleep && 'sleeping', born.has(t.id) && 'born', S.split && (S.split.a === t.id || S.split.b === t.id) && 'in-split'].filter(Boolean).join(' ');
  const audio = t.muted ? 'muted' : t.audible ? 'volume' : '';
  return `<div class="${cls}" data-id="${t.id}" title="${esc(t.title)}${asleep ? ` (${tr('đang ngủ')})` : ''}">
    ${favEl(t)}
    <span class="title">${esc(t.title)}</span>
    ${audio ? `<button class="badge audio" title="${t.muted ? 'Bật tiếng' : 'Tắt tiếng'}">${icon(audio, 14)}</button>` : ''}
    <button class="icon-btn x" title="Đóng (Ctrl+W)">${icon('x', 14)}</button>
  </div>`;
}

// tabs opened since the strip was last drawn (they grow in)
const born = new Set();

/** Where each tab is now, to slide them from there to their new places (FLIP). */
function places(box) {
  const m = new Map();
  for (const el of box.querySelectorAll('.tab')) m.set(el.dataset.id, el.getBoundingClientRect());
  return m;
}
function slide(box, before, vertical) {
  if (document.documentElement.classList.contains('no-anim')) return;
  for (const el of box.querySelectorAll('.tab')) {
    const was = before.get(el.dataset.id);
    if (!was || el.classList.contains('dragging')) continue;
    const now = el.getBoundingClientRect();
    const dx = vertical ? 0 : was.left - now.left;
    const dy = vertical ? was.top - now.top : 0;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
}

export function render() {
  const vertical = S.settings.layout.tabsPosition !== 'top';
  const hs = $('#hstrip');
  const vs = $('#vstrip');
  const box = vertical ? vs : hs;
  const before = places(box);
  draw(vertical, hs, vs);
  slide(box, before, vertical);
  born.clear();
  emit('strip-rendered');
}

function draw(vertical, hs, vs) {
  if (vertical) {
    hs.innerHTML = '';
    const pins = T.list.filter((t) => t.pinned);
    const rest = T.list.filter((t) => !t.pinned);
    vs.innerHTML = `${pins.length ? `<div class="pins tabs">${pins.map(tabEl).join('')}</div>` : ''}<div class="tabs">${rest.map(tabEl).join('')}</div><button class="new-row" data-act="new">${icon('plus', 16)}<span>Tab mới</span></button>`;
  } else {
    vs.innerHTML = '';
    hs.innerHTML = `<div class="tabs" data-tauri-drag-region>${T.list.map(tabEl).join('')}</div><button class="icon-btn new-tab-btn" data-act="new" title="Tab mới (Ctrl+T)">${icon('plus', 17)}</button>`;
  }
}

async function tabMenu(t, x, y) {
  const i = T.list.indexOf(t);
  // (the browser's other windows: the tab can go to one of them)
  const others = (await invoke('win_list').catch(() => [])).filter((w) => !w.current && !!w.private === !!S.private);
  menu(
    [
      { label: 'Tab mới bên phải', icon: 'plus', run: () => createTab({ index: i + 1 }) },
      'sep',
      { label: 'Tải lại', icon: 'reload', keys: 'F5', run: () => (t.live ? invoke('tab_nav', { id: t.id, action: 'reload' }) : activate(t.id)) },
      { label: 'Nhân đôi', icon: 'copy', run: () => duplicate(t) },
      { label: t.pinned ? 'Bỏ ghim' : 'Ghim tab', icon: 'pin', run: () => togglePin(t) },
      { label: t.muted ? 'Bật tiếng trang' : 'Tắt tiếng trang', icon: t.muted ? 'volume' : 'muted', run: () => toggleMute(t) },
      { label: S.split ? 'Bỏ chia đôi màn hình' : 'Chia đôi với tab đang xem', icon: 'split', keys: 'Ctrl+Shift+X', run: () => (S.split ? toggleSplit() : splitWith(t)) },
      { label: 'Cho tab ngủ', icon: 'sleep', disabled: !t.live || t.id === T.activeId, run: () => sleepTab(t) },
      { label: 'Chuyển sang cửa sổ mới', icon: 'window', run: () => moveToNewWindow(t) },
      ...others.map((w) => ({ label: tr('Chuyển sang cửa sổ: {0}', (w.title || w.label).slice(0, 40)), icon: 'window', run: () => sendToWindow(t, w.label) })),
      'sep',
      { label: 'Đóng', icon: 'x', keys: 'Ctrl+W', run: () => closeTab(t.id) },
      { label: 'Đóng các tab khác', run: () => T.list.filter((o) => o !== t && !o.pinned).forEach((o) => closeTab(o.id)) },
      { label: 'Đóng các tab bên phải', run: () => T.list.slice(i + 1).filter((o) => !o.pinned).forEach((o) => closeTab(o.id)) },
      { label: 'Mở lại tab vừa đóng', icon: 'history', keys: 'Ctrl+Shift+T', disabled: !T.closed.length, run: reopenClosed },
    ],
    { x, y }
  );
}

export async function moveToNewWindow(t) {
  // (its back / forward list goes with it)
  const historyFrom = await invoke('tab_stash', { id: t.id }).catch(() => null);
  invoke('win_new', { private: S.private, url: t.url, historyFrom });
  closeTab(t.id);
}

/** Moves a tab to another of the browser's windows (with its back / forward list). */
export async function sendToWindow(t, win) {
  await invoke('tab_send', { id: t.id, win, url: t.url }).catch(() => null);
  closeTab(t.id);
}

export function newTabMenu(x, y) {
  menu(
    [
      { label: 'Tab mới', icon: 'plus', keys: 'Ctrl+T', run: () => createTab() },
      { label: 'Cửa sổ mới', icon: 'window', keys: 'Ctrl+N', run: () => invoke('win_new', { private: false }) },
      { label: 'Cửa sổ InPrivate mới', icon: 'incognito', keys: 'Ctrl+Shift+N', run: () => invoke('win_new', { private: true }) },
      ...(T.closed.length ? ['sep', { head: 'Đã đóng gần đây' }, ...T.closed.slice(-6).reverse().map((c) => ({ label: c.title || c.url, icon: 'history', run: () => createTab({ url: c.url, title: c.title }) }))] : []),
    ],
    { x, y }
  );
}

function wireStrip(container, vertical) {
  container.addEventListener('click', (e) => {
    const tabEl = e.target.closest('.tab');
    if (e.target.closest('[data-act="new"]')) return createTab();
    if (!tabEl) return;
    const t = byId(tabEl.dataset.id);
    if (e.target.closest('.x')) return closeTab(t.id);
    if (e.target.closest('.audio')) return toggleMute(t);
  });
  container.addEventListener('auxclick', (e) => {
    const tabEl = e.target.closest('.tab');
    if (e.button === 1 && tabEl) closeTab(tabEl.dataset.id);
  });
  container.addEventListener('dblclick', (e) => {
    if (!e.target.closest('.tab') && !e.target.closest('button') && !vertical) createTab();
  });
  container.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const tabEl = e.target.closest('.tab');
    if (tabEl) tabMenu(byId(tabEl.dataset.id), e.clientX, e.clientY);
    else newTabMenu(e.clientX, e.clientY);
  });

  // pick and drag to reorder; dragged well out of the strip: into a window of its own
  container.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.tab');
    if (!el || e.button !== 0 || e.target.closest('button')) return;
    const id = el.dataset.id;
    const t = byId(id);
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    if (T.activeId !== id) activate(id);
    container.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
      dragging = true;
      container.querySelector(`.tab[data-id="${id}"]`)?.classList.add('dragging');
      const els = [...container.querySelectorAll('.tab')].filter((x) => byId(x.dataset.id)?.pinned === t.pinned);
      for (const other of els) {
        if (other.dataset.id === id) continue;
        const r = other.getBoundingClientRect();
        const inside = vertical ? ev.clientY > r.top && ev.clientY < r.bottom : ev.clientX > r.left && ev.clientX < r.right;
        if (inside) {
          moveTab(id, T.list.findIndex((x) => x.id === other.dataset.id));
          container.querySelector(`.tab[data-id="${id}"]`)?.classList.add('dragging');
          break;
        }
      }
    };
    const up = (ev) => {
      container.removeEventListener('pointermove', move);
      container.removeEventListener('pointerup', up);
      container.querySelector('.dragging')?.classList.remove('dragging');
      const out = vertical ? ev.clientX > innerWidth || ev.clientX < 0 : ev.clientY > $('#chrome-top').getBoundingClientRect().bottom + 80 || ev.clientY < -40;
      if (dragging && out && T.list.length > 1) moveToNewWindow(t);
    };
    container.addEventListener('pointermove', move);
    container.addEventListener('pointerup', up);
  });
}

export function initStrip() {
  wireStrip($('#hstrip'), false);
  wireStrip($('#vstrip'), true);
}
