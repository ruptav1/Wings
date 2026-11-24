// Every action of the browser by name: what menus, buttons, the command palette (Ctrl+K) and the
// keyboard run. Keys can be changed in Settings → Phím tắt (settings.shortcuts: { id: [keys] }).
import { invoke, h, esc, fold, NEWTAB, isNewTab, hostOf } from '../shared/api.js';
import { icon } from '../shared/icons.js';
import { S, $, emit, on } from './state.js';
import { T, active, createTab, closeTab, activate, reopenClosed, navigate, goBack, togglePin, toggleMute, duplicate, toggleSplit } from './tabs.js';
import { focusOmnibox } from './omnibox.js';
import { t as tr } from '../shared/i18n.js';
import { menu, toast, float, popover } from './menus.js';
import { openFind } from './find.js';
import { bookmarkPopover } from './bookmarks.js';
import { downloadsPopover } from './downloads.js';
import { toggleSidebar } from './sidebar.js';
import { permIcon, permLabel } from './prompts.js';
import { openGrab } from './grab.js';
import { openManga } from './manga.js';
import { mediaMenu, extensionsMenu, historyMenu, pip, setLobby, nextTheme, nextWallpaper } from './extras.js';

const zoomSteps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const tabCmd = (action) => () => {
  const t = active();
  if (t?.live) invoke('tab_nav', { id: t.id, action });
};
const zoomBy = (dir) => () => {
  const t = active();
  if (!t) return;
  const i = zoomSteps.findIndex((z) => z >= t.zoom - 0.001);
  const next = dir === 0 ? 1 : zoomSteps[Math.min(zoomSteps.length - 1, Math.max(0, i + dir))];
  invoke('tab_zoom', { id: t.id, factor: next });
};
const open = (url) => () => {
  const existing = T.list.find((t) => t.url.split('#')[0] === url.split('#')[0]);
  if (existing) {
    activate(existing.id);
    if (url.includes('#')) navigate(existing, url);
  } else createTab({ url });
};

export const COMMANDS = {
  'tab.new': { label: 'Tab mới', icon: 'plus', keys: ['Ctrl+T'], run: () => createTab() },
  'tab.close': { label: 'Đóng tab', icon: 'x', keys: ['Ctrl+W', 'Ctrl+F4'], run: () => T.activeId && closeTab(T.activeId) },
  'tab.reopen': { label: 'Mở lại tab vừa đóng', icon: 'history', keys: ['Ctrl+Shift+T'], run: reopenClosed },
  'tab.next': { label: 'Tab kế tiếp', keys: ['Ctrl+Tab', 'Ctrl+PageDown'], run: () => cycle(1) },
  'tab.prev': { label: 'Tab trước', keys: ['Ctrl+Shift+Tab', 'Ctrl+PageUp'], run: () => cycle(-1) },
  'tab.duplicate': { label: 'Nhân đôi tab', icon: 'copy', keys: ['Alt+Shift+D'], run: () => active() && duplicate(active()) },
  'tab.pin': { label: 'Ghim / bỏ ghim tab', icon: 'pin', keys: [], run: () => active() && togglePin(active()) },
  'tab.mute': { label: 'Tắt / bật tiếng tab', icon: 'muted', keys: ['Ctrl+M'], run: () => active() && toggleMute(active()) },
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`tab.${n}`, { label: `Tới tab ${n}`, keys: [`Ctrl+${n}`], hidden: true, run: () => T.list[n - 1] && activate(T.list[n - 1].id) }])),
  'tab.last': { label: 'Tới tab cuối', keys: ['Ctrl+9'], hidden: true, run: () => T.list.length && activate(T.list[T.list.length - 1].id) },
  'window.new': { label: 'Cửa sổ mới', icon: 'window', keys: ['Ctrl+N'], run: () => invoke('win_new', { private: false }) },
  'window.private': { label: 'Cửa sổ InPrivate mới', icon: 'incognito', keys: ['Ctrl+Shift+N'], run: () => invoke('win_new', { private: true }) },
  'window.close': { label: 'Đóng cửa sổ', keys: ['Ctrl+Shift+W'], run: () => invoke('win_action', { action: 'close' }) },
  'nav.back': { label: 'Quay lại', icon: 'back', keys: ['Alt+Left', 'BrowserBack'], run: () => goBack(active()) },
  'nav.forward': { label: 'Tiến tới', icon: 'forward', keys: ['Alt+Right', 'BrowserForward'], run: tabCmd('forward') },
  'nav.reload': { label: 'Tải lại', icon: 'reload', keys: ['F5', 'Ctrl+R'], run: () => (active()?.loading ? tabCmd('stop')() : tabCmd('reload')()) },
  'nav.hardReload': { label: 'Tải lại, bỏ qua bộ nhớ đệm', icon: 'reload', keys: ['Ctrl+F5', 'Ctrl+Shift+R'], run: tabCmd('hardReload') },
  'nav.home': { label: 'Trang chủ', icon: 'home', keys: ['Alt+Home'], run: () => navigate(active(), S.settings.general.homepage || NEWTAB) },
  'nav.historyMenu': { label: 'Lịch sử của tab', hidden: true, run: (o) => historyMenu(o?.anchor || $('[data-item="back"]')) },
  'media.menu': { label: 'Video trên trang', icon: 'video', hidden: true, run: (o) => mediaMenu(o?.anchor || $('[data-item="media"]') || $('#omnibox')) },
  'extensions.menu': { label: 'Tiện ích mở rộng', icon: 'puzzle', hidden: true, run: (o) => extensionsMenu(o?.anchor || $('[data-item="extensions"]') || $('#omnibox')) },
  'grab.open': { label: 'Tải video từ đường dẫn', icon: 'link', keys: ['Ctrl+Shift+G'], run: () => openGrab() },
  'manga.open': { label: 'Tải truyện tranh trên trang', icon: 'image', keys: ['Ctrl+Shift+M'], run: () => openManga() },
  'page.pip': { label: 'Hình trong hình', icon: 'pip', keys: ['Alt+P'], run: pip },
  lobby: { label: 'Chế độ Lobby (chỉ xem hình nền)', icon: 'image', keys: ['Ctrl+Shift+L'], run: () => setLobby(!S.lobby) },
  'theme.next': { label: 'Đổi chủ đề nhanh', icon: 'palette', keys: ['Ctrl+Shift+Y'], run: nextTheme },
  'wallpaper.next': { label: 'Đổi hình nền nhanh', icon: 'image', keys: ['Ctrl+Shift+W'], run: nextWallpaper },
  'omnibox.focus': { label: 'Tới thanh địa chỉ', icon: 'search', keys: ['Ctrl+L', 'Alt+D', 'F6'], run: () => focusOmnibox() },
  'omnibox.search': { label: 'Tìm kiếm', icon: 'search', keys: ['Ctrl+E'], hidden: true, run: () => focusOmnibox('') },
  'page.find': { label: 'Tìm trong trang', icon: 'search', keys: ['Ctrl+F', 'F3'], run: () => openFind() },
  'page.zoomIn': { label: 'Phóng to', icon: 'zoomIn', keys: ['Ctrl+=', 'Ctrl+Plus', 'Ctrl+Shift+='], run: zoomBy(1) },
  'page.zoomOut': { label: 'Thu nhỏ', icon: 'zoomOut', keys: ['Ctrl+-', 'Ctrl+NumMinus'], run: zoomBy(-1) },
  'page.zoomReset': { label: 'Cỡ chữ mặc định (100%)', keys: ['Ctrl+0'], run: zoomBy(0) },
  'page.print': { label: 'In…', icon: 'printer', keys: ['Ctrl+P'], run: tabCmd('print') },
  'page.pdf': { label: 'Lưu thành PDF', icon: 'save', keys: [], run: savePdf },
  'page.saveAs': { label: 'Lưu trang thành…', icon: 'save', keys: ['Ctrl+S'], run: tabCmd('saveAs') },
  'page.devtools': { label: 'Công cụ cho nhà phát triển', icon: 'terminal', keys: ['F12', 'Ctrl+Shift+I'], run: tabCmd('devtools') },
  'page.source': { label: 'Xem mã nguồn trang', icon: 'code', keys: ['Ctrl+U'], run: () => active()?.url.startsWith('http') && createTab({ url: 'view-source:' + active().url, openerId: T.activeId }) },
  'page.screenshot': { label: 'Chụp màn hình trang', icon: 'camera', keys: ['Ctrl+Shift+S'], run: screenshot },
  'page.copyUrl': { label: 'Sao chép địa chỉ trang', icon: 'link', keys: ['Ctrl+Shift+C'], run: () => active() && navigator.clipboard.writeText(active().url).then(() => toast(tr('Đã sao chép địa chỉ'), { iconName: 'check', timeout: 1800 })) },
  'bookmark.add': { label: 'Thêm dấu trang', icon: 'star', keys: ['Ctrl+D'], run: () => bookmarkPopover($('#omnibox .star')) },
  'bookmarks.bar': { label: 'Hiện / ẩn thanh dấu trang', icon: 'bookmark', keys: ['Ctrl+Shift+B'], run: () => invoke('settings_set', { patch: { layout: { bookmarksBar: S.settings.layout.bookmarksBar === 'always' ? 'off' : 'always' } } }) },
  'open.history': { label: 'Lịch sử', icon: 'history', keys: ['Ctrl+H'], run: open('unk://history') },
  'open.downloads': { label: 'Trang tải xuống', icon: 'download', keys: ['Ctrl+J'], run: open('unk://downloads') },
  'open.bookmarks': { label: 'Quản lý dấu trang', icon: 'bookmark', keys: ['Ctrl+Shift+O'], run: open('unk://bookmarks') },
  'open.settings': { label: 'Cài đặt', icon: 'sliders', keys: ['Ctrl+,'], run: open('unk://settings') },
  'open.shields': { label: 'Cài đặt Shields', icon: 'shield', keys: [], hidden: true, run: open('unk://settings/#privacy') },
  'open.clearData': { label: 'Xóa dữ liệu duyệt web', icon: 'trash', keys: ['Ctrl+Shift+Delete'], run: open('unk://settings/#privacy') },
  'open.store': { label: 'Kho hình nền', icon: 'image', keys: [], run: open('unk://store') },
  'open.taskmgr': { label: 'Trình quản lý tác vụ', icon: 'layers', keys: ['Shift+Esc'], run: () => invoke('taskmgr_open') },
  'downloads.popover': { label: 'Tải xuống gần đây', icon: 'download', hidden: true, run: (o) => downloadsPopover(o?.anchor || $('[data-item="downloads"]') || $('#omnibox')) },
  palette: { label: 'Bảng lệnh', icon: 'command', keys: ['Ctrl+K', 'Ctrl+Shift+A'], run: () => palette() },
  'split.toggle': { label: 'Chia đôi màn hình', icon: 'split', keys: ['Ctrl+Shift+X'], run: toggleSplit },
  'sidebar.toggle': { label: 'Thanh bên', icon: 'sidebar', keys: ['Ctrl+Shift+E'], run: () => toggleSidebar() },
  'zen.toggle': { label: 'Chế độ tập trung', icon: 'eyeOff', keys: ['Ctrl+Shift+Z'], run: () => setZen(!S.zen) },
  fullscreen: { label: 'Toàn màn hình', icon: 'fullscreen', keys: ['F11'], run: () => invoke('win_action', { action: 'toggleFullscreen' }).then((st) => emit('win-state', st)) },
  'theme.dark': { label: 'Đổi chế độ sáng / tối', icon: 'moon', keys: ['Ctrl+Shift+D'], run: () => invoke('settings_set', { patch: { appearance: { dark: !S.settings.appearance.dark } } }) },
  'menu.main': { label: 'Menu', icon: 'more', keys: ['Alt+F'], hidden: true, run: (o) => mainMenu(o?.anchor || $('[data-item="menu"]')) },
  'adblock.toggleSite': { label: 'Bật / tắt Shields cho trang này', icon: 'shield', keys: [], run: toggleSiteAdblock },
};

const UI_COMMANDS = new Set(['grab.open', 'manga.open','media.menu', 'extensions.menu', 'lobby', 'omnibox.focus', 'omnibox.search', 'page.find', 'palette', 'menu.main', 'bookmark.add', 'downloads.popover']);

function cycle(dir) {
  const i = T.list.findIndex((t) => t.id === T.activeId);
  if (i < 0) return;
  activate(T.list[(i + dir + T.list.length) % T.list.length].id);
}

export function setZen(v) {
  S.zen = v;
  document.body.classList.toggle('zen', v);
  emit('layout');
  if (v) toast(tr('Chế độ tập trung: đưa chuột lên mép trên để hiện thanh công cụ. Ctrl+Shift+Z để thoát.'), { timeout: 3500 });
}

async function screenshot() {
  const t = active();
  if (!t?.live) return;
  try {
    const r = await invoke('tab_screenshot', { id: t.id });
    try {
      const blob = await (await fetch(r.data)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch {}
    toast(tr('Đã chụp màn hình và chép vào clipboard'), { iconName: 'camera', action: { label: tr('Mở thư mục'), run: () => invoke('file_show', { path: r.path }) } });
  } catch (e) {
    toast(tr('Không chụp được: ') + e);
  }
}

async function savePdf() {
  const t = active();
  if (!t?.live) return;
  const path = await invoke('tab_pdf', { id: t.id, title: t.title });
  toast(tr('Đang lưu PDF…'), { iconName: 'save', timeout: 2000 });
  return path;
}

function toggleSiteAdblock() {
  const host = hostOf(active()?.url);
  if (!host) return;
  const off = new Set(S.settings.privacy.adblockOff || []);
  off.has(host) ? off.delete(host) : off.add(host);
  invoke('settings_set', { patch: { privacy: { adblockOff: [...off] } } }).then(() => tabCmd('reload')());
}

// ---------- keys ----------
let keymap = new Map(); // combo -> command id

export function keysOf(id) {
  const custom = S.settings.shortcuts?.[id];
  return Array.isArray(custom) ? custom : COMMANDS[id]?.keys || [];
}

export function rebuildKeymap() {
  keymap = new Map();
  for (const id of Object.keys(COMMANDS)) for (const k of keysOf(id)) keymap.set(k, id);
  // the same keys work while a page has the focus (Rust catches them there)
  invoke('keys_set', { keys: [...keymap.keys()] });
}

const CODE_NAMES = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Escape: 'Esc', Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', NumpadAdd: 'Plus', NumpadSubtract: 'NumMinus', BrowserBack: 'BrowserBack', BrowserForward: 'BrowserForward' };
export function comboOf(e) {
  let k = e.code;
  if (/^Key[A-Z]$/.test(k)) k = k.slice(3);
  else if (/^Digit\d$/.test(k)) k = k.slice(5);
  else if (CODE_NAMES[k]) k = CODE_NAMES[k];
  else if (!/^(F\d{1,2}|Tab|PageUp|PageDown|Home|End|Delete|Enter|Space)$/.test(k)) return '';
  return `${e.ctrlKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${k}`;
}

export function run(id, opts) {
  const c = COMMANDS[id];
  if (c) c.run(opts);
}

export function initCommands() {
  rebuildKeymap();
  on('settings', rebuildKeymap);
  document.addEventListener('keydown', (e) => {
    const combo = comboOf(e);
    const id = combo && keymap.get(combo);
    if (!id) return;
    // typing keys stay with text fields
    const typing = e.target.matches?.('input, textarea, [contenteditable]');
    if (typing && !e.ctrlKey && !e.altKey && !/^F\d/.test(combo) && combo !== 'Shift+Esc') return;
    if (typing && /^Ctrl\+(A|C|V|X|Z|Y)$/.test(combo)) return;
    e.preventDefault();
    run(id);
  });
  window.__TAURI__.event.listen('command', async ({ payload }) => {
    if (!T.list.some((t) => t.id === payload.tab) && T.panelTab?.id !== payload.tab) return;
    const id = keymap.get(payload.combo);
    if (!id) return;
    // from a page: what opens something in the interface takes the keyboard there first
    if (UI_COMMANDS.has(id)) await invoke('shell_focus');
    run(id);
  });
  // Ctrl+Shift+F12: the interface's own developer tools
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'F12') invoke('shell_devtools');
  });
  // the mouse's back / forward buttons over the shell
  document.addEventListener('mouseup', (e) => {
    if (e.button === 3) run('nav.back');
    if (e.button === 4) run('nav.forward');
  });
}

// ---------- palette ----------
export async function palette() {
  const input = h('input', { type: 'text', placeholder: 'Gõ lệnh, tên tab, dấu trang hoặc trang đã xem…', spellcheck: 'false' });
  const list = h('div', { class: 'list' });
  const el = h('div', { class: 'palette' }, input, list);
  let items = [];
  let sel = 0;
  const close = float(el, { x: innerWidth / 2 - 320, y: 80 }, { modal: true });
  const draw = () => {
    list.innerHTML = items.map((it, i) => `<div class="item ${i === sel ? 'sel' : ''}" data-i="${i}">${icon(it.icon || 'command', 16)}<span class="label">${esc(it.label)}</span><span class="hint">${esc(it.hint || '')}</span></div>`).join('') || '<div class="empty">Không có kết quả</div>';
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  const fill = async () => {
    const q = fold(input.value.trim());
    const cmds = Object.entries(COMMANDS)
      .filter(([, c]) => !c.hidden && (!q || fold(c.label).includes(q)))
      .map(([id, c]) => ({ label: c.label, icon: c.icon, hint: keysOf(id)[0] || '', run: () => c.run() }));
    const tabs = T.list.filter((t) => q && (fold(t.title).includes(q) || t.url.toLowerCase().includes(q))).map((t) => ({ label: t.title, icon: 'tabs', hint: 'Tab', run: () => activate(t.id) }));
    const marks = S.bookmarks.items.filter((b) => q && (fold(b.title).includes(q) || b.url.toLowerCase().includes(q))).slice(0, 6).map((b) => ({ label: b.title, icon: 'star', hint: 'Dấu trang', run: () => createTab({ url: b.url }) }));
    items = [...tabs, ...cmds, ...marks];
    sel = 0;
    draw();
    if (q.length > 1) {
      const hist = await invoke('history_suggest', { text: input.value.trim() }).catch(() => []);
      items = [...items, ...hist.slice(0, 6).map((x) => ({ label: x.title || x.url, icon: 'history', hint: 'Lịch sử', run: () => createTab({ url: x.url }) }))];
      draw();
    }
  };
  input.addEventListener('input', fill);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') sel = Math.min(items.length - 1, sel + 1);
    else if (e.key === 'ArrowUp') sel = Math.max(0, sel - 1);
    else if (e.key === 'Enter') {
      const it = items[sel];
      close();
      it?.run();
      return;
    } else return;
    e.preventDefault();
    draw();
  });
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.item');
    if (!row) return;
    const it = items[+row.dataset.i];
    close();
    it?.run();
  });
  fill();
  input.focus();
}

// ---------- main menu ----------
function mainMenu(anchor) {
  const t = active();
  const k = (id) => keysOf(id)[0];
  const zoomRow = h('div', { class: 'zoom-row' }, h('span', { class: 'label', text: 'Thu phóng' }));
  const v = h('span', { class: 'v', text: `${Math.round((t?.zoom || 1) * 100)}%` });
  const mk = (ic, fn, title) => h('button', { class: 'icon-btn', title, html: icon(ic, 16), onclick: () => (fn(), setTimeout(() => (v.textContent = `${Math.round((active()?.zoom || 1) * 100)}%`), 150)) });
  zoomRow.append(mk('minus', zoomBy(-1), 'Thu nhỏ'), v, mk('plus', zoomBy(1), 'Phóng to'), mk('fullscreen', () => run('fullscreen'), 'Toàn màn hình'));
  menu(
    [
      { label: 'Tab mới', icon: 'plus', keys: k('tab.new'), run: () => run('tab.new') },
      { label: 'Cửa sổ mới', icon: 'window', keys: k('window.new'), run: () => run('window.new') },
      { label: 'Cửa sổ InPrivate mới', icon: 'incognito', keys: k('window.private'), run: () => run('window.private') },
      'sep',
      { label: 'Lịch sử', icon: 'history', keys: k('open.history'), run: () => run('open.history') },
      { label: 'Tải xuống', icon: 'download', keys: k('open.downloads'), run: () => run('open.downloads') },
      { label: 'Dấu trang', icon: 'bookmark', keys: k('open.bookmarks'), run: () => run('open.bookmarks') },
      'sep',
      { el: zoomRow },
      'sep',
      { label: 'In…', icon: 'printer', keys: k('page.print'), disabled: !t?.live, run: () => run('page.print') },
      { label: 'Lưu thành PDF', icon: 'save', disabled: !t?.live, run: () => run('page.pdf') },
      { label: 'Tìm trong trang', icon: 'search', keys: k('page.find'), disabled: !t?.live, run: () => run('page.find') },
      { label: 'Chụp màn hình trang', icon: 'camera', keys: k('page.screenshot'), disabled: !t?.live, run: () => run('page.screenshot') },
      'sep',
      { label: 'Hình trong hình', icon: 'pip', keys: k('page.pip'), disabled: !t?.live, run: () => run('page.pip') },
      { label: 'Tải video từ đường dẫn…', icon: 'link', keys: k('grab.open'), run: () => run('grab.open') },
      { label: 'Tải truyện tranh trên trang…', icon: 'image', keys: k('manga.open'), disabled: !/^https?:/.test(t?.url || ''), run: () => run('manga.open') },
      { label: 'Tiện ích mở rộng', icon: 'puzzle', run: () => run('extensions.menu') },
      { label: 'Kho hình nền', icon: 'image', run: () => run('open.store') },
      { label: 'Đổi hình nền nhanh', icon: 'shuffle', keys: k('wallpaper.next'), run: () => run('wallpaper.next') },
      { label: 'Chế độ Lobby', icon: 'eye', keys: k('lobby'), run: () => run('lobby') },
      { label: 'Trình quản lý tác vụ', icon: 'layers', keys: k('open.taskmgr'), run: () => run('open.taskmgr') },
      { label: 'Cửa sổ đã đóng gần đây', icon: 'window', run: () => closedWindowsMenu(anchor) },
      { label: 'Công cụ cho nhà phát triển', icon: 'terminal', keys: k('page.devtools'), disabled: !t?.live, run: () => run('page.devtools') },
      { label: 'Bảng lệnh', icon: 'command', keys: k('palette'), run: () => run('palette') },
      { label: 'Chế độ tập trung', icon: 'eyeOff', keys: k('zen.toggle'), checked: S.zen, run: () => run('zen.toggle') },
      'sep',
      { label: 'Cài đặt', icon: 'sliders', keys: k('open.settings'), run: () => run('open.settings') },
      { label: 'Giới thiệu Wings', icon: 'info', run: open('unk://settings/#about') },
      { label: 'Thoát', icon: 'x', run: () => invoke('win_action', { action: 'close' }) },
    ],
    { anchor, align: 'end' }
  );
}

// ---------- windows closed while others stayed open (from TyranWeb) ----------
async function closedWindowsMenu(anchor) {
  const list = await invoke('winhistory_list').catch(() => []);
  const ago = (ts) => {
    const m = Math.round((Date.now() - ts) / 60000);
    return m < 1 ? tr('vừa xong') : m < 60 ? tr('{0} phút trước', m) : m < 1440 ? tr('{0} giờ trước', Math.round(m / 60)) : new Date(ts).toLocaleDateString();
  };
  menu(
    list.length
      ? [
          { head: tr('Cửa sổ đã đóng gần đây') },
          ...list.map((w, i) => ({ label: `${(w.tabs[w.active] || w.tabs[0])?.title || tr('Cửa sổ')} · ${tr('{0} tab', w.tabs.length)} · ${ago(w.closedAt)}`, icon: 'window', run: () => invoke('winhistory_open', { index: i }) })),
          'sep',
          { label: tr('Xóa danh sách'), icon: 'trash', run: () => invoke('winhistory_clear') },
        ]
      : [{ head: tr('Cửa sổ đã đóng gần đây') }, { label: tr('Chưa có cửa sổ nào'), disabled: true }],
    { anchor, align: 'end' }
  );
}

// ---------- site info / shield ----------
export function initSitePopovers() {
  on('site-info', (anchor) => {
    const t = active();
    if (!t) return;
    const url = t.url;
    const secure = url.startsWith('https:');
    let origin = '';
    try {
      origin = /^https?:/.test(url) ? new URL(url).origin : '';
    } catch {}
    const saved = Object.entries(S.settings.sitePermissions?.[origin] || {});
    const perms = saved.map(([k, v]) => {
      const sel = h('select', { html: `<option value="allow">${esc(tr('Cho phép'))}</option><option value="deny">${esc(tr('Chặn'))}</option><option value="">${esc(tr('Hỏi lại'))}</option>` });
      sel.value = v;
      sel.addEventListener('change', () => invoke('perm_set', { origin, kind: k, value: sel.value }));
      return h('div', { class: 'si-perm' }, h('span', { class: 'si-ic', html: icon(permIcon(k), 15) }), h('span', { class: 'grow', text: permLabel(k) }), sel);
    });
    const el = h(
      'div',
      { class: 'site-info' },
      h('h3', { text: hostOf(url) || (isNewTab(url) ? tr('Tab mới') : url) }),
      h('p', { class: 'muted', html: url.startsWith('unk:') ? esc(tr('Trang của trình duyệt.')) : secure ? `${icon('lock', 14)} ${esc(tr('Kết nối an toàn (HTTPS).'))}` : `${icon('warn', 14)} ${esc(tr('Kết nối không an toàn: thông tin gửi đi có thể bị người khác đọc được.'))}` }),
      origin ? h('div', { class: 'si-perms' }, h('div', { class: 'si-title', text: tr('Quyền của trang') }), ...(perms.length ? perms : [h('small', { class: 'muted', text: tr('Trang này chưa xin quyền nào.') })])) : null,
      h('div', { class: 'actions' }, h('button', { class: 'btn', text: tr('Sao chép địa chỉ'), onclick: () => (navigator.clipboard.writeText(url), close()) }), h('button', { class: 'btn', text: tr('Cài đặt quyền'), onclick: () => (close(), run('open.shields')) }))
    );
    const close = popover(el, anchor, { align: 'start' });
  });
  // Shields: everything that protects this page, and one switch to take it all down for its site
  on('shield', (anchor) => {
    const t = active();
    const host = hostOf(t?.url);
    const p = S.settings.privacy;
    const up = !(p.adblockOff || []).includes(host);
    const row = (ok, big, label, sub) =>
      h('div', { class: `sh-row ${ok ? 'ok' : 'no'}` }, h('span', { class: 'sh-val', html: big ?? icon(ok ? 'check' : 'minus', 15) }), h('span', { class: 'sh-txt' }, h('b', { text: tr(label) }), sub ? h('small', { text: tr(sub) }) : null));
    const https = t?.url.startsWith('https:');
    const sw = h('input', { type: 'checkbox' });
    sw.checked = up;
    sw.addEventListener('change', () => (close(), toggleSiteAdblock()));
    const el = h(
      'div',
      { class: `shields ${up ? 'up' : 'down'}` },
      h('div', { class: 'sh-head' }, h('span', { class: 'sh-ic', html: icon(up ? 'shieldCheck' : 'shield', 22) }), h('span', { class: 'sh-host' }, h('b', { text: host }), h('small', { text: up ? tr('Shields đang bật') : tr('Shields đang tắt cho trang này') })), h('label', { class: 'switch' }, sw, h('span'))),
      up
        ? h(
            'div',
            { class: 'sh-list' },
            row(p.adblock, p.adblock ? `<b class="n">${t?.blocked || 0}</b>` : null, 'Quảng cáo và trình theo dõi đã chặn', p.adblock ? null : 'Đang tắt trong Cài đặt'),
            row(p.httpsUpgrade && https, null, t?.httpsUpgraded ? 'Đã tự chuyển sang HTTPS' : https ? 'Kết nối an toàn (HTTPS)' : 'Trang này không hỗ trợ HTTPS', p.httpsUpgrade ? null : 'HTTPS mặc định đang tắt'),
            row(p.fingerprint && t?.fpProtected !== false, null, 'Chống lấy dấu vân tay', p.fingerprint ? 'Canvas, WebGL, âm thanh và số nhân CPU bị làm nhiễu' : 'Đang tắt trong Cài đặt'),
            row(p.blockThirdPartyCookies, null, 'Chặn cookie bên thứ ba', p.blockThirdPartyCookies ? null : 'Đang tắt trong Cài đặt'),
            row(p.stripParams !== false, null, t?.cleaned ? 'Đã bỏ tham số theo dõi khỏi địa chỉ' : 'Bỏ tham số theo dõi trong link', p.stripParams !== false ? 'fbclid, gclid… và trang chuyển hướng theo dõi' : 'Đang tắt trong Cài đặt'),
            row(p.cookieNotices && p.adblock, null, 'Ẩn bảng hỏi cookie', p.cookieNotices ? null : 'Đang tắt trong Cài đặt')
          )
        : h('p', { class: 'sh-down', text: tr('Trang này không được chặn quảng cáo, chống theo dõi hay tự chuyển HTTPS. Bật lại khi trang đã hiển thị đúng.') }),
      h('div', { class: 'sh-foot' }, h('small', { class: 'muted', text: up ? tr('Trang hiển thị lỗi? Tắt Shields cho riêng trang này.') : '' }), h('button', { class: 'btn small', text: tr('Cài đặt Shields'), onclick: () => (close(), run('open.shields')) }))
    );
    const close = popover(el, anchor, { class: 'shields-pop' });
  });
}
