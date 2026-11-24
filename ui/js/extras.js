// The shell's extra tools: videos found on the page, extensions, a tab's back / forward list, the
// browser's entries in the page's context menu, lobby mode, quick theme and wallpaper switches.
import { invoke, listen, h, esc, fmtBytes, hostOf } from '../shared/api.js';
import { icon } from '../shared/icons.js';
import { PRESETS } from '../shared/themes.js';
import { t, LANG } from '../shared/i18n.js';
import { S, $, emit, on } from './state.js';
import { T, active, byId, createTab } from './tabs.js';
import { menu, toast, closeFloating } from './menus.js';
import { layout } from './view.js';
import { openGrab } from './grab.js';

// ---------- videos on the page ----------
export function mediaMenu(anchor) {
  const tab = active();
  const list = tab?.media || [];
  const kindName = { hls: t('Luồng HLS'), video: 'Video', audio: t('Âm thanh') };
  const fromLink = { label: t('Tải từ đường dẫn… (YouTube, TikTok, X…)'), icon: 'link', run: () => openGrab() };
  menu(
    list.length
      ? [
          fromLink,
          'sep',
          { head: t('Tải video và âm thanh trên trang này') },
          ...list.map((m) =>
            // (on the Gecko core: each video with its picture, size and length, read by playing it unseen)
            window.__TAURI__?.gecko && m.kind === 'video'
              ? { el: mediaRow(tab, m) }
              : {
                  // (a stream's size is its playlist's, a few KB: only plain files say how big they are)
                  label: `${kindName[m.kind]} · ${m.kind !== 'hls' && m.size > 0 ? fmtBytes(m.size) : hostOf(m.url)} · ${decodeURIComponent(m.url.split(/[?#]/)[0].split('/').pop() || '').slice(0, 40)}`,
                  icon: m.kind === 'audio' ? 'music' : 'video',
                  run: () => downloadMedia(tab, m.url, m.kind),
                }
          ),
          'sep',
          { label: t('Hình trong hình'), icon: 'pip', keys: 'Alt+P', run: () => pip() },
        ]
      : [fromLink, 'sep', { label: t('Chưa thấy video nào trên trang. Hãy bấm phát video rồi mở lại menu này.'), disabled: true }, 'sep', { label: t('Hình trong hình'), icon: 'pip', keys: 'Alt+P', run: () => pip() }],
    { anchor, align: 'end' }
  );
}

// a video of the page: its picture, size in pixels, length and file size; a press downloads it
const probed = new Map(); // url -> facts
function mediaRow(tab, m) {
  const name = decodeURIComponent(m.url.split(/[?#]/)[0].split('/').pop() || '').slice(0, 48) || hostOf(m.url);
  const row = h('button', { class: 'item media-row', title: m.url }, h('span', { class: 'mthumb', html: icon('video', 18) }), h('span', { class: 'mtext' }, h('span', { class: 'mname', text: name }), h('span', { class: 'mfacts', text: [m.size > 0 ? fmtBytes(m.size) : '', hostOf(m.url)].filter(Boolean).join(' · ') })), h('span', { class: 'mdl', html: icon('download', 16) }));
  row.addEventListener('click', () => {
    closeFloating();
    downloadMedia(tab, m.url, m.kind);
  });
  const show = (f) => {
    if (!f) return;
    if (f.thumb) row.querySelector('.mthumb').replaceChildren(h('img', { src: f.thumb, alt: '' }));
    const dur = f.duration ? `${Math.floor(f.duration / 60)}:${String(Math.round(f.duration % 60)).padStart(2, '0')}` : '';
    row.querySelector('.mfacts').textContent = [f.width ? `${f.width}×${f.height}` : '', dur, m.size > 0 ? fmtBytes(m.size) : '', hostOf(m.url)].filter(Boolean).join(' · ');
  };
  if (probed.has(m.url)) show(probed.get(m.url));
  else
    invoke('media_probe', { url: m.url, page: tab.url })
      .then((f) => (probed.set(m.url, f), row.isConnected && show(f)))
      .catch(() => probed.set(m.url, null));
  return row;
}

export async function downloadMedia(tab, url, kind) {
  try {
    await invoke('media_download', { tab: tab.id, url, kind, title: tab.title });
  } catch (e) {
    toast(t('Không tải được: ') + e);
  }
}

export function pip() {
  const tab = active();
  if (tab?.live) invoke('tab_pip', { id: tab.id });
}

// ---------- extensions ----------
const STORE = /^https:\/\/(chromewebstore\.google\.com\/detail|chrome\.google\.com\/webstore\/detail|microsoftedge\.microsoft\.com\/addons\/detail)\//;

export async function installExtension(source) {
  toast(t('Đang cài tiện ích…'), { iconName: 'puzzle', timeout: 2500 });
  try {
    const r = await invoke('ext_install', { source });
    toast(t('Đã cài {0}', r.name), { iconName: 'check' });
  } catch (e) {
    toast(t('Không cài được tiện ích: ') + e, { timeout: 7000 });
  }
}

export async function extensionsMenu(anchor) {
  const tab = active();
  let list = [];
  try {
    list = await invoke('ext_list', { lang: LANG });
  } catch {}
  menu(
    [
      ...(tab && STORE.test(tab.url) ? [{ label: t('Cài tiện ích đang xem'), icon: 'plus', run: () => installExtension(tab.url) }, 'sep'] : []),
      ...(list.length ? [{ head: t('Tiện ích mở rộng') }] : []),
      ...list.map((x) => ({
        label: x.name + (x.enabled ? '' : ` (${t('tắt')})`),
        icon: 'puzzle',
        disabled: !x.enabled || (!x.popup && !x.options),
        run: () => invoke('ext_open', { id: x.id, page: x.popup || x.options, popup: !!x.popup }),
      })),
      ...(list.length ? ['sep'] : []),
      { label: t('Mở Chrome Web Store'), icon: 'external', run: () => createTab({ url: 'https://chromewebstore.google.com/category/extensions' }) },
      { label: t('Quản lý tiện ích'), icon: 'sliders', run: () => createTab({ url: 'unk://settings/#extensions' }) },
    ],
    { anchor, align: 'end' }
  );
}

// ---------- a tab's back / forward list ----------
export async function historyMenu(anchor) {
  const tab = active();
  if (!tab?.live) return;
  let hist;
  try {
    hist = await invoke('tab_history', { id: tab.id });
  } catch {
    return;
  }
  const cur = hist.currentIndex;
  const entries = hist.entries.map((e, i) => ({ ...e, i })).filter((e) => e.i !== cur);
  menu(
    [
      ...entries.reverse().slice(0, 16).map((e) => ({
        label: e.title || e.url,
        icon: e.i < cur ? 'back' : 'forward',
        run: () => invoke('tab_history_go', { id: tab.id, entry: e.id }),
      })),
      'sep',
      { label: t('Toàn bộ lịch sử'), icon: 'history', keys: 'Ctrl+H', run: () => createTab({ url: 'unk://history' }) },
    ],
    { anchor }
  );
}

// ---------- lobby: the wallpaper alone ----------
export function setLobby(v) {
  S.lobby = v;
  document.body.classList.toggle('lobby', v);
  layout(!v);
  if (v) {
    invoke('shell_focus');
    toast(t('Chế độ Lobby: bấm Esc hoặc nhấp chuột để quay lại'), { timeout: 2500 });
  }
}

// ---------- quick switches ----------
export function nextTheme() {
  const ids = Object.keys(PRESETS);
  const cur = ids.indexOf(S.settings.appearance.preset);
  const id = ids[(cur + 1) % ids.length];
  const p = PRESETS[id];
  invoke('settings_set', { patch: { appearance: { preset: id, dark: p.dark, accent: p.accent, bg: p.bg, surface: p.surface, text: p.text }, wallpaper: { ...p.wallpaper } } });
  toast(t('Chủ đề: {0}', p.name), { iconName: 'palette', timeout: 1500 });
}

export async function nextWallpaper() {
  const files = await invoke('wallpaper_list');
  if (!files.length) return toast(t('Chưa có hình nền nào'), { action: { label: t('Tìm hình nền'), run: () => createTab({ url: 'unk://store/#images' }) } });
  const w = S.settings.wallpaper;
  const cur = files.findIndex((f) => f.url === (w.type === 'video' ? w.video : w.image));
  const f = files[(cur + 1) % files.length];
  invoke('settings_set', { patch: { wallpaper: f.kind === 'video' ? { type: 'video', video: f.url } : { type: 'image', image: f.url } } });
  toast(f.title || f.name, { iconName: f.kind === 'video' ? 'video' : 'image', timeout: 1500 });
}

export function initExtras() {
  // what pages load: the media button
  listen('media', (m) => {
    const tab = byId(m.tab);
    if (!tab) return;
    tab.media = [...(tab.media || []).filter((x) => x.url !== m.url), m].slice(-20);
    emit('tab-changed', tab);
  });
  // the browser's entries in a page's context menu
  listen('ctx', async (c) => {
    const tab = byId(c.tab);
    if (!tab) return;
    if (c.action === 'wallpaper') {
      toast(t('Đang tải ảnh…'), { iconName: 'image', timeout: 2000 });
      try {
        await invoke('wallpaper_from_url', { url: c.url, page: tab.url });
        toast(t('Đã đặt làm hình nền'), { iconName: 'image', action: { label: t('Hình nền khác'), run: () => createTab({ url: 'unk://store/#mine' }) } });
      } catch (e) {
        toast(t('Không đặt được hình nền: ') + e);
      }
    } else if (c.action === 'lens') createTab({ url: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(c.url)}`, openerId: tab.id });
    else if (c.action === 'translate') createTab({ url: `https://translate.google.com/translate?sl=auto&tl=${LANG}&u=${encodeURIComponent(c.url)}`, openerId: tab.id });
    else if (c.action === 'media') downloadMedia(tab, c.url, /\.(mp3|m4a|ogg|opus|wav|flac)/i.test(c.url) ? 'audio' : /\.m3u8/i.test(c.url) ? 'hls' : 'video');
    else if (c.action === 'pip') invoke('tab_pip', { id: tab.id });
    else if (c.action === 'window') invoke('win_new', { private: false, url: c.url });
    else if (c.action === 'private') invoke('win_new', { private: true, url: c.url });
  });
  // lobby: back with Esc or a click
  document.addEventListener('keydown', (e) => S.lobby && e.key === 'Escape' && setLobby(false));
  $('#wallpaper').addEventListener('click', () => S.lobby && setLobby(false));
  // the browser's own menu entries in the interface's language
  invoke('labels_set', {
    labels: {
      'ctx.wallpaper': t('Đặt làm hình nền'),
      'ctx.lens': t('Tìm ảnh này với Google Lens'),
      'ctx.translate': t('Dịch trang này'),
      'ctx.media': t('Tải xuống bằng trình tải của trình duyệt'),
      'ctx.pip': t('Hình trong hình'),
      'ctx.window': t('Mở liên kết trong cửa sổ mới'),
      'ctx.private': t('Mở liên kết trong cửa sổ InPrivate'),
    },
  });
  // a newer version (Settings → Chung → Kho phát hành)
  if (S.settings.general.checkUpdates && S.settings.general.updateRepo && S.win === 'win-1') {
    setTimeout(async () => {
      try {
        const u = await invoke('update_check');
        if (u.newer) toast(t('Có phiên bản mới {0}', u.latest), { iconName: 'download', timeout: 10000, action: { label: t('Xem'), run: () => createTab({ url: u.url }) } });
      } catch {}
    }, 8000);
  }
}
