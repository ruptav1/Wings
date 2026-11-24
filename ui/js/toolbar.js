// The toolbar: navigation buttons, the address bar and the buttons chosen in Settings → Bố cục.
import { h } from '../shared/api.js';
import { icon } from '../shared/icons.js';
import { S, $, on } from './state.js';
import { T, active } from './tabs.js';
import { buildOmnibox, sync as syncOmnibox } from './omnibox.js';
import { run } from './commands.js';

const ITEMS = {
  back: { icon: 'back', title: 'Quay lại (Alt+←)', cmd: 'nav.back' },
  forward: { icon: 'forward', title: 'Tiến tới (Alt+→)', cmd: 'nav.forward' },
  reload: { icon: 'reload', title: 'Tải lại (F5)', cmd: 'nav.reload' },
  home: { icon: 'home', title: 'Trang chủ', cmd: 'nav.home' },
  media: { icon: 'video', title: 'Video trên trang', cmd: 'media.menu', cls: 'media-btn' },
  extensions: { icon: 'puzzle', title: 'Tiện ích mở rộng', cmd: 'extensions.menu' },
  downloads: { icon: 'download', title: 'Tải xuống (Ctrl+J)', cmd: 'downloads.popover', cls: 'dl-btn' },
  split: { icon: 'split', title: 'Chia đôi màn hình (Ctrl+Shift+X)', cmd: 'split.toggle' },
  screenshot: { icon: 'camera', title: 'Chụp màn hình trang (Ctrl+Shift+S)', cmd: 'page.screenshot' },
  sidebar: { icon: 'sidebar', title: 'Thanh bên (Ctrl+Shift+E)', cmd: 'sidebar.toggle' },
  taskmgr: { icon: 'layers', title: 'Trình quản lý tác vụ (Shift+Esc)', cmd: 'open.taskmgr' },
  palette: { icon: 'command', title: 'Bảng lệnh (Ctrl+K)', cmd: 'palette' },
  menu: { icon: 'more', title: 'Menu', cmd: 'menu.main' },
};
export const TOOLBAR_ITEMS = ITEMS;

let built = '';

export function buildToolbar() {
  const bar = $('#toolbar');
  const l = S.settings.layout;
  const want = l.toolbarItems.filter((id) => id === 'omnibox' || (ITEMS[id] && !l.hiddenToolbarItems.includes(id)));
  if (!want.includes('omnibox')) want.splice(Math.min(3, want.length), 0, 'omnibox');
  const key = want.join(',');
  if (key === built) return syncToolbar();
  built = key;
  bar.replaceChildren();
  for (const id of want) {
    if (id === 'omnibox') {
      bar.append($('#omnibox') || buildOmnibox());
      continue;
    }
    const it = ITEMS[id];
    const b = h('button', { class: `icon-btn ${it.cls || ''}`, title: it.title, dataset: { item: id }, html: icon(it.icon, 18) });
    b.addEventListener('click', (e) => run(it.cmd, { anchor: b, event: e }));
    if (id === 'back' || id === 'forward') b.addEventListener('contextmenu', (e) => (e.preventDefault(), run('nav.historyMenu', { anchor: b })));
    bar.append(b);
  }
  syncToolbar();
}

export function syncToolbar() {
  const t = active();
  const bar = $('#toolbar');
  const back = bar.querySelector('[data-item="back"]');
  const fwd = bar.querySelector('[data-item="forward"]');
  const rel = bar.querySelector('[data-item="reload"]');
  if (back) back.disabled = !t?.canBack && !t?.ntpBack;
  if (fwd) fwd.disabled = !t?.canForward;
  if (rel) {
    rel.innerHTML = icon(t?.loading ? 'x' : 'reload', 18);
    rel.title = t?.loading ? 'Dừng (Esc)' : 'Tải lại (F5)';
  }
  bar.querySelector('[data-item="split"]')?.classList.toggle('on', !!S.split);
  const mb = bar.querySelector('[data-item="media"]');
  if (mb) {
    const n = t?.media?.length || 0;
    mb.classList.toggle('on', n > 0);
    mb.querySelector('.count')?.remove();
    if (n > 1) mb.insertAdjacentHTML('beforeend', `<span class="count">${n}</span>`);
  }
  bar.querySelector('[data-item="sidebar"]')?.classList.toggle('on', !!S.settings.layout.sidebarOpen);
  syncOmnibox();
}

export function initToolbar() {
  buildToolbar();
  on('active', syncToolbar);
  on('tab-changed', (t) => t.id === T.activeId && syncToolbar());
  on('settings', buildToolbar);
}
