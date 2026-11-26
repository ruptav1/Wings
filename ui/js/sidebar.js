// The sidebar: bookmarks, history, quick notes, the computer's apps (from TyranWeb) and web panels
// (a small site kept beside the page).
import { invoke, listen, h, esc, fold, favicon, hostOf, timeAgo, debounce } from '../shared/api.js';
import { toast } from './menus.js';
import { t as tr } from '../shared/i18n.js';
import { icon } from '../shared/icons.js';
import { S, $, emit, on } from './state.js';
import { T, active, createTab, navigate, ensureLive } from './tabs.js';
import { layout, forget } from './view.js';
import { menu } from './menus.js';
import { row as dlRow, rowClick as dlClick, rowDragStart as dlDrag, allDownloads } from './downloads.js';

const PANELS = [
  { id: 'bookmarks', icon: 'bookmark', title: 'Dấu trang' },
  { id: 'history', icon: 'history', title: 'Lịch sử' },
  { id: 'downloads', icon: 'download', title: 'Tải xuống' },
  { id: 'notes', icon: 'note', title: 'Ghi chú nhanh' },
  { id: 'apps', icon: 'apps', title: 'Ứng dụng trên máy' },
];

const setLayout = (patch) => invoke('settings_set', { patch: { layout: patch } });

export function toggleSidebar(panel) {
  const l = S.settings.layout;
  if (panel && panel !== l.sidebarPanel) return setLayout({ sidebarOpen: true, sidebarPanel: panel });
  setLayout({ sidebarOpen: !l.sidebarOpen });
}

function rail() {
  const r = $('#sidebar-rail');
  const l = S.settings.layout;
  const btn = (id, ic, title, html) => `<button class="icon-btn ${l.sidebarPanel === id ? 'on' : ''}" data-panel="${esc(id)}" title="${esc(title)}">${html || icon(ic, 18)}</button>`;
  r.innerHTML =
    PANELS.map((p) => btn(p.id, p.icon, p.title)).join('') +
    '<div style="height:1px;background:var(--line);margin:4px 2px"></div>' +
    // (the computer's apps pinned here: a press starts one)
    (S.settings.pinnedApps || []).map((a) => `<button class="icon-btn rail-app" data-app="${esc(a.id)}" title="${esc(a.name)}">${appIcon(a)}</button>`).join('') +
    ((S.settings.pinnedApps || []).length ? '<div style="height:1px;background:var(--line);margin:4px 2px"></div>' : '') +
    (S.settings.webPanels || []).map((w) => btn(w.id, '', w.title, `<img class="fav" src="${esc(favicon(w.url))}" alt="">`)).join('') +
    `<button class="icon-btn" data-act="add-web" title="Thêm web panel">${icon('plus', 18)}</button>`;
}

// ---------- the computer's apps (from TyranWeb) ----------
// The signed apps of the Start menu (programs and Store / MSIX apps: apps.rs): a press starts one;
// the pin keeps it on the rail.
const appIcon = (a) => (a.icon ? `<img class="fav app-ico" src="${esc(a.icon)}" alt="">` : `<span class="fav letter app-ico">${esc((a.name || '?').charAt(0).toUpperCase())}</span>`);
let apps = null;

async function launchApp(a) {
  try {
    await invoke('apps_launch', { id: a.id });
    toast(tr('Đang mở {0}…', a.name), { iconName: 'apps', timeout: 2000 });
  } catch (err) {
    toast(String(err), { iconName: 'warn' });
  }
}

function pinApp(a, on) {
  const list = (S.settings.pinnedApps || []).filter((x) => x.id !== a.id);
  if (on) list.push({ id: a.id, name: a.name, icon: a.icon || '' });
  invoke('settings_set', { patch: { pinnedApps: list } });
}

function appsPanel(box) {
  box.innerHTML = `<div class="panel-head">Ứng dụng trên máy<span class="grow"></span><button class="icon-btn" data-act="apps-reload" title="Tải lại">${icon('reload', 15)}</button></div><input class="panel-search" type="search" placeholder="Tìm ứng dụng"><div class="panel-list apps-list"></div>`;
  const list = box.querySelector('.apps-list');
  const input = box.querySelector('input');
  const fill = () => {
    if (!apps) return (list.innerHTML = `<div class="empty">${esc(tr('Đang tìm các ứng dụng trên máy…'))}</div>`);
    const q = fold(input.value);
    const pinned = new Set((S.settings.pinnedApps || []).map((x) => x.id));
    const shown = apps.filter((a) => !q || fold(a.name).includes(q) || fold(a.signer || '').includes(q)).sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)));
    list.innerHTML =
      shown.map((a) => `<div class="row app-row" data-app-row="${esc(a.id)}" title="${esc(a.name)}${a.signer ? '\n' + esc(a.signer) : ''}">${appIcon(a)}<div class="col"><span class="t">${esc(a.name)}</span><span class="sub">${esc(a.signer || '')}</span></div><button class="icon-btn app-pin ${pinned.has(a.id) ? 'on' : ''}" data-pin="${esc(a.id)}" title="${esc(pinned.has(a.id) ? tr('Bỏ ghim khỏi thanh bên') : tr('Ghim vào thanh bên'))}">${icon('pin', 14)}</button></div>`).join('') ||
      `<div class="empty">${esc(tr('Không có kết quả'))}</div>`;
  };
  const load = (fresh) =>
    invoke('apps_list', { fresh })
      .then((l) => (apps = l), () => (apps = apps || []))
      .then(() => list.isConnected && fill());
  input.addEventListener('input', fill);
  box.querySelector('[data-act="apps-reload"]').addEventListener('click', () => load(true));
  list.addEventListener('click', (e) => {
    const pin = e.target.closest('[data-pin]');
    const a = apps?.find((x) => x.id === (pin?.dataset.pin || e.target.closest('[data-app-row]')?.dataset.appRow));
    if (!a) return;
    if (pin) return pinApp(a, !pin.classList.contains('on'));
    launchApp(a);
  });
  fill();
  load(false);
}

function closePanelTab() {
  if (!T.panelTab) return;
  if (T.panelTab.live) invoke('tab_close', { id: T.panelTab.id });
  forget(T.panelTab.id);
  T.panelTab = null;
  T.panel = null;
}

async function panel() {
  const l = S.settings.layout;
  const box = $('#sidebar-panel');
  const web = (S.settings.webPanels || []).find((w) => w.id === l.sidebarPanel);
  if (!web || !l.sidebarOpen) closePanelTab();
  if (!l.sidebarOpen) return;
  if (web) {
    box.innerHTML = `<div class="panel-head">${esc(web.title)}<span class="grow"></span><button class="icon-btn" data-act="web-open" title="Mở trong tab">${icon('external', 15)}</button><button class="icon-btn" data-act="web-remove" title="Gỡ panel">${icon('trash', 15)}</button></div><div id="sidebar-web" style="flex:1;margin:0 8px 8px;border-radius:var(--radius-sm);background:var(--surface-solid)"></div>`;
    if (T.panelTab?.panelId !== web.id) {
      closePanelTab();
      T.panelTab = { id: `${S.win}-panel-${Date.now().toString(36)}`, url: web.url, title: web.title, live: false, panelId: web.id, zoom: 1, hiddenSince: Date.now() };
      T.panel = T.panelTab.id;
      requestAnimationFrame(() => ensureLive(T.panelTab, true));
    } else requestAnimationFrame(() => layout());
    return;
  }
  if (l.sidebarPanel === 'apps') return appsPanel(box);
  if (l.sidebarPanel === 'notes') {
    const { text } = await invoke('notes_get');
    box.innerHTML = `<div class="panel-head">Ghi chú nhanh</div><textarea id="notes-area" placeholder="Ghi gì đó… (tự lưu)"></textarea>`;
    const ta = $('#notes-area');
    ta.value = text || '';
    ta.addEventListener('input', debounce(() => invoke('notes_set', { text: ta.value }), 400));
    return;
  }
  if (l.sidebarPanel === 'downloads') {
    box.innerHTML = `<div class="panel-head">Tải xuống<span class="grow"></span><button class="icon-btn" data-act="open-downloads" title="Mở trang tải xuống">${icon('external', 15)}</button></div><input class="panel-search" type="search" placeholder="Tìm tệp đã tải"><div class="panel-list dl-list"></div>`;
    const list = box.querySelector('.panel-list');
    list.addEventListener('click', dlClick);
    list.addEventListener('dragstart', dlDrag);
    const fill = async () => {
      const q = fold(box.querySelector('input').value);
      const items = (await allDownloads()).filter((d) => !q || fold(d.file).includes(q));
      list.innerHTML = items.slice(0, 200).map(dlRow).join('') || '<div class="empty">Chưa có tệp nào được tải xuống</div>';
    };
    box.querySelector('input').addEventListener('input', debounce(fill, 150));
    fill();
    return;
  }
  if (l.sidebarPanel === 'history') {
    box.innerHTML = `<div class="panel-head">Lịch sử<span class="grow"></span><button class="icon-btn" data-act="open-history" title="Mở trang lịch sử">${icon('external', 15)}</button></div><input class="panel-search" type="search" placeholder="Tìm trong lịch sử"><div class="panel-list"></div>`;
    const list = box.querySelector('.panel-list');
    const fill = async () => {
      const items = await invoke('history_query', { text: box.querySelector('input').value, limit: 150 });
      list.innerHTML = items.map((v) => `<div class="row" data-url="${esc(v.url)}" title="${esc(v.url)}"><img class="fav" src="${esc(favicon(v.url))}" alt=""><div class="col"><span class="t">${esc(v.title || v.url)}</span><span class="sub">${esc(hostOf(v.url))} · ${timeAgo(v.time ?? v.ts)}</span></div></div>`).join('') || '<div class="empty">Không có gì</div>';
    };
    box.querySelector('input').addEventListener('input', debounce(fill, 150));
    fill();
    return;
  }
  // bookmarks
  box.innerHTML = `<div class="panel-head">Dấu trang<span class="grow"></span><button class="icon-btn" data-act="open-bookmarks" title="Quản lý dấu trang">${icon('external', 15)}</button></div><input class="panel-search" type="search" placeholder="Tìm dấu trang"><div class="panel-list"></div>`;
  const list = box.querySelector('.panel-list');
  const fill = () => {
    const q = fold(box.querySelector('input').value);
    const out = [];
    for (const f of S.bookmarks.folders) {
      const items = S.bookmarks.items.filter((b) => b.folder === f.id && (!q || fold(b.title).includes(q) || b.url.includes(q)));
      if (!items.length) continue;
      out.push(`<div class="group-label">${esc(f.name)}</div>`);
      out.push(...items.map((b) => `<div class="row" data-url="${esc(b.url)}" title="${esc(b.url)}"><img class="fav" src="${esc(favicon(b.url))}" alt=""><span class="t">${esc(b.title)}</span></div>`));
    }
    list.innerHTML = out.join('') || '<div class="empty">Chưa có dấu trang</div>';
  };
  box.querySelector('input').addEventListener('input', fill);
  fill();
}

function apply() {
  const l = S.settings.layout;
  document.body.classList.toggle('sidebar-open', !!l.sidebarOpen);
  document.body.classList.toggle('sidebar-right', l.sidebarPosition === 'right');
  rail();
  panel();
  emit('layout');
}

export function initSidebar() {
  $('#sidebar-rail').addEventListener('click', async (e) => {
    const app = e.target.closest('[data-app]');
    if (app) return launchApp((S.settings.pinnedApps || []).find((x) => x.id === app.dataset.app) || { id: app.dataset.app, name: app.title });
    const b = e.target.closest('[data-panel]');
    if (b) return setLayout({ sidebarPanel: b.dataset.panel, sidebarOpen: true });
    if (e.target.closest('[data-act="add-web"]')) {
      const t = active();
      const url = t && /^https?:/.test(t.url) ? t.url : 'https://translate.google.com/';
      const list = [...(S.settings.webPanels || []), { id: 'wp-' + Date.now().toString(36), title: t && /^https?:/.test(t.url) ? t.title.slice(0, 40) : hostOf(url), url }];
      invoke('settings_set', { patch: { webPanels: list, layout: { sidebarPanel: list[list.length - 1].id, sidebarOpen: true } } });
    }
  });
  $('#sidebar-rail').addEventListener('contextmenu', (e) => {
    const app = e.target.closest('[data-app]');
    if (!app) return;
    e.preventDefault();
    const a = (S.settings.pinnedApps || []).find((x) => x.id === app.dataset.app);
    if (a) menu([{ label: tr('Mở'), icon: 'external', run: () => launchApp(a) }, { label: tr('Bỏ ghim khỏi thanh bên'), icon: 'pin', run: () => pinApp(a, false) }], { x: e.clientX, y: e.clientY });
  });
  // (the apps were looked for again and changed)
  listen('apps-changed', () => {
    apps = null;
    if (S.settings.layout.sidebarOpen && S.settings.layout.sidebarPanel === 'apps') panel();
  });
  $('#sidebar-panel').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'open-history') return createTab({ url: 'unk://history' });
    if (act === 'open-downloads') return createTab({ url: 'unk://downloads' });
    if (act === 'open-bookmarks') return createTab({ url: 'unk://bookmarks' });
    if (act === 'web-open' && T.panelTab) return createTab({ url: T.panelTab.url });
    if (act === 'web-remove') {
      const id = S.settings.layout.sidebarPanel;
      return invoke('settings_set', { patch: { webPanels: S.settings.webPanels.filter((w) => w.id !== id), layout: { sidebarPanel: 'bookmarks' } } });
    }
    const row = e.target.closest('.row[data-url]');
    if (row) (e.ctrlKey ? createTab({ url: row.dataset.url, background: true }) : navigate(active(), row.dataset.url));
  });
  $('#sidebar-panel').addEventListener('auxclick', (e) => {
    const row = e.target.closest('.row[data-url]');
    if (row && e.button === 1) createTab({ url: row.dataset.url, background: true });
  });
  // drag the edge to resize
  const rz = $('#sidebar .resizer');
  rz.addEventListener('pointerdown', (e) => {
    rz.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = $('#sidebar').getBoundingClientRect().width;
    const right = S.settings.layout.sidebarPosition === 'right';
    let w = startW;
    const move = (ev) => {
      w = Math.min(640, Math.max(220, startW + (right ? startX - ev.clientX : ev.clientX - startX)));
      document.documentElement.style.setProperty('--sidebar-w', `${w}px`);
      layout();
    };
    const up = () => {
      rz.removeEventListener('pointermove', move);
      rz.removeEventListener('pointerup', up);
      setLayout({ sidebarWidth: Math.round(w) });
    };
    rz.addEventListener('pointermove', move);
    rz.addEventListener('pointerup', up);
  });
  let prev = '';
  on('settings', (s) => {
    const key = JSON.stringify([s.layout.sidebarOpen, s.layout.sidebarPanel, s.layout.sidebarPosition, s.webPanels, s.pinnedApps]);
    if (key !== prev) {
      prev = key;
      apply();
    }
  });
  on('bookmarks-changed', () => S.settings.layout.sidebarOpen && S.settings.layout.sidebarPanel === 'bookmarks' && panel());
  // (a download's progress: the panel's list follows, a few times a second at most)
  let dlTimer = 0;
  on('downloads-changed', () => {
    if (!S.settings.layout.sidebarOpen || S.settings.layout.sidebarPanel !== 'downloads' || dlTimer || document.activeElement?.classList.contains('panel-search')) return;
    dlTimer = setTimeout(() => ((dlTimer = 0), panel()), 300);
  });
  prev = JSON.stringify([S.settings.layout.sidebarOpen, S.settings.layout.sidebarPanel, S.settings.layout.sidebarPosition, S.settings.webPanels, S.settings.pinnedApps]);
  apply();
}
