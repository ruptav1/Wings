// The shell's start: settings, the window's tabs, the toolbar and the events from the browser.
import { invoke, listen, NEWTAB } from '../shared/api.js';
import { hydrateIcons } from '../shared/icons.js';
import { S, $, $$, emit, on } from './state.js';
import { T, createTab, activate, render, initStrip, initTabEvents, newTabMenu, active, saveSession } from './tabs.js';
import { initView, layout } from './view.js';
import { applyAll, applyLayout, applyWallpaper, applyCustomCSS, updateMotion } from './layout.js';
import { applyTheme } from '../shared/theme.js';
import { initToolbar } from './toolbar.js';
import { initCommands, initSitePopovers } from './commands.js';
import { initBookmarks } from './bookmarks.js';
import { initDownloads } from './downloads.js';
import { initSidebar } from './sidebar.js';
import { toast } from './menus.js';
import { initExtras } from './extras.js';
import { initNtp } from './ntp.js';
import { initPrompts } from './prompts.js';
import { initPlaying } from './playing.js';
import { initGrab } from './grab.js';
import { initPageMenu } from './pagemenu.js';
import { initPageDialogs } from './pagedialog.js';
import { initCursor } from '../shared/cursor.js';
import { initMusic } from './music.js';
import { initVisualizer } from './visualizer.js';
import { initTyranSync } from './tyransync.js';
import { autoColors } from './layout.js';
import { watch, t } from '../shared/i18n.js';

const appWindow = window.__TAURI__.window.getCurrentWindow();

async function boot() {
  const init = await invoke('win_init');
  S.win = init.win;
  S.private = init.private;
  S.settings = init.settings;
  S.engines = init.engines;
  S.bookmarks = init.bookmarks;
  S.maximized = init.maximized;
  document.body.classList.toggle('maximized', S.maximized);
  document.body.classList.toggle('private', S.private);

  $('#brand').innerHTML = S.private
    ? `<span class="inprivate" data-tauri-drag-region>InPrivate</span>`
    : `<img src="shared/logo-small.svg" alt="" data-tauri-drag-region>`; // (the logo's cut for 16–32 px)
  hydrateIcons(document);
  watch();
  applyAll();
  initView();
  initStrip();
  initTabEvents();
  initToolbar();
  initCommands();
  initSitePopovers();
  initBookmarks();
  initDownloads();
  initSidebar();
  initExtras();
  initNtp();
  initPrompts();
  initPlaying();
  initGrab();
  initPageMenu();
  initPageDialogs();
  initCursor();
  initMusic();
  initVisualizer();
  initTyranSync();
  wireWindow();
  wireEvents();

  T.closed.push(...(init.closed || []));
  const r = init.restore;
  if (r?.tabs?.length) {
    r.tabs.forEach((t, i) => createTab({ url: t.url, title: t.title, favicon: t.favicon, pinned: t.pinned, background: true, sleeping: i !== r.active, index: i, history: t.history || null }));
    activate(T.list[Math.min(r.active || 0, T.list.length - 1)].id);
  }
  if (init.url) createTab({ url: init.url, historyFrom: init.urlHistoryFrom || null });
  if (!T.list.length) {
    const g = S.settings.general;
    createTab({ url: g.startup === 'home' && g.homepage ? g.homepage : NEWTAB });
  }
  document.body.classList.add('ready');
  await invoke('win_show');
  layout();
}

function wireWindow() {
  $('#caption').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'close') saveSession(true);
    const st = await invoke('win_action', { action: b.dataset.act }).catch(() => null);
    if (st) setWinState(st);
  });
  // resizing from the edges (the window has no system frame)
  for (const edge of $$('.edge')) {
    edge.addEventListener('pointerdown', (e) => {
      if (e.button === 0) appWindow.startResizeDragging(edge.dataset.dir).catch(() => {});
    });
  }
  const refresh = async () => {
    const [maximized, fullscreen] = await Promise.all([appWindow.isMaximized(), appWindow.isFullscreen()]);
    setWinState({ maximized, fullscreen });
  };
  appWindow.onResized(refresh);
  // back to the window (Alt+Tab, the taskbar): the keyboard goes where it was, the page or the shell
  let lastFocus = 'page';
  listen('tab-focus', ({ id }) => {
    if (T.list.some((t) => t.id === id)) lastFocus = 'page';
  });
  document.addEventListener('focusin', () => (lastFocus = 'shell'));
  appWindow.onFocusChanged(({ payload }) => {
    S.focused = payload;
    document.body.classList.toggle('blurred', !payload);
    updateMotion();
  });
  // (sent only when the window got the focus with nothing inside it holding the keyboard)
  listen('win-refocus', ({ win }) => {
    if (win !== S.win) return;
    const t = active();
    if (lastFocus === 'page' && t?.live) invoke('tab_focus', { id: t.id });
    else invoke('shell_focus');
  });
  // zen: the toolbar comes back while the pointer is at the top edge
  $('#zen-hot').addEventListener('pointerenter', () => document.body.classList.add('zen-peek'));
  $('#chrome-top').addEventListener('pointerleave', () => document.body.classList.remove('zen-peek'));
  $('#vtabs-collapse').addEventListener('click', () => invoke('settings_set', { patch: { layout: { verticalTabsCollapsed: !S.settings.layout.verticalTabsCollapsed } } }));
  $('#vtabs-new').addEventListener('click', () => createTab());
  $('#vtabs-new').addEventListener('contextmenu', (e) => (e.preventDefault(), newTabMenu(e.clientX, e.clientY)));
  // no browser context menu over the shell itself
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('input, textarea')) e.preventDefault();
  });
}

function setWinState(st) {
  S.maximized = !!st.maximized;
  S.fullscreen = !!st.fullscreen;
  document.body.classList.toggle('maximized', S.maximized);
  document.body.classList.toggle('fullscreen', S.fullscreen);
  const max = $('#caption [data-act="maximize"]');
  max.title = S.maximized ? 'Khôi phục' : 'Phóng to';
  max.innerHTML = S.maximized
    ? '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" fill="none" stroke="currentColor"/></svg>'
    : '<svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/></svg>';
  layout();
}

function wireEvents() {
  on('win-state', setWinState);
  listen('settings', (s) => {
    const prev = S.settings;
    S.settings = s;
    applyTheme(s);
    applyCustomCSS();
    if (JSON.stringify(prev.wallpaper) !== JSON.stringify(s.wallpaper)) applyWallpaper();
    if (s.appearance.autoColor && !prev.appearance.autoColor) autoColors();
    if (JSON.stringify(prev.layout) !== JSON.stringify(s.layout) || prev.appearance.tabStyle !== s.appearance.tabStyle || prev.appearance.density !== s.appearance.density) {
      applyLayout();
      render();
    }
    emit('settings', s);
  });
  listen('history-cleared', () => (T.closed.length = 0));
  listen('toast', (p) => {
    if (!document.hasFocus()) return;
    if (p.kind === 'pdf') toast(p.ok ? t('Đã lưu PDF') : t('Không lưu được PDF'), { iconName: 'save', action: p.ok ? { label: 'Mở thư mục', run: () => invoke('file_show', { path: p.path }) } : null });
    if (p.kind === 'cleared') toast(t('Đã xóa dữ liệu duyệt web'), { iconName: 'check' });
  });
  // a page's video goes full screen: the window too, without the interface
  let enteredFs = false;
  on('html-fullscreen', (fs) => {
    S.htmlFs = fs;
    document.body.classList.toggle('html-fs', fs);
    if (fs && !S.fullscreen) {
      enteredFs = true;
      invoke('win_action', { action: 'fullscreen' }).then(setWinState);
    } else if (!fs && enteredFs) {
      enteredFs = false;
      invoke('win_action', { action: 'leaveFullscreen' }).then(setWinState);
    } else layout();
  });
  // a click in a page closes the shell's menus
  // (on the Gecko core the page itself is the focused element then: it keeps the keyboard)
  listen('tab-focus', () => document.activeElement?.localName !== 'browser' && document.activeElement?.blur?.());
}

boot().catch((err) => {
  console.error(err);
  document.body.classList.add('ready');
  document.body.innerHTML = `<pre style="padding:24px;color:#c33;white-space:pre-wrap">Wings không khởi động được:\n${String(err?.stack || err)}</pre>`;
  invoke('win_show');
});
