// Settings. Every change applies at once (to every window) and is kept by the browser.
import { invoke, listen, h, esc, hostOf, fmtBytes, DEFAULT_WALLPAPER, DEFAULT_WALLPAPER_THUMB } from '../../shared/api.js';
import { thumbOf } from '../../shared/thumbs.js';
import { icon } from '../../shared/icons.js';
import { wallpaperStyle } from '../../shared/theme.js';
import { PRESETS, ACCENTS } from '../../shared/themes.js';
import { SHORTCUTS } from '../../shared/shortcuts.js';
import { P, initPage, onSettings, setSettings } from '../../shared/page.js';
import { t, LANG } from '../../shared/i18n.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const SECTIONS = [
  { id: 'general', icon: 'sliders', title: 'Chung' },
  { id: 'appearance', icon: 'palette', title: 'Giao diện' },
  { id: 'wallpaper', icon: 'image', title: 'Hình nền' },
  { id: 'layout', icon: 'layout', title: 'Bố cục' },
  { id: 'newtab', icon: 'apps', title: 'Trang Tab mới' },
  { id: 'extensions', icon: 'puzzle', title: 'Tiện ích mở rộng' },
  { id: 'privacy', icon: 'shield', title: 'Quyền riêng tư' },
  { id: 'incognito', icon: 'incognito', title: 'Ẩn danh' },
  { id: 'performance', icon: 'sleep', title: 'Hiệu năng' },
  { id: 'shortcuts', icon: 'keyboard', title: 'Phím tắt' },
  { id: 'about', icon: 'info', title: 'Giới thiệu' },
];

// ---------- reading / writing a setting by its path ("appearance.accent") ----------
const get = (path) => path.split('.').reduce((o, k) => o?.[k], P.settings);
function patchOf(path, value) {
  const keys = path.split('.');
  const root = {};
  let o = root;
  keys.slice(0, -1).forEach((k) => (o = o[k] = {}));
  o[keys[keys.length - 1]] = value;
  return root;
}
const set = (path, value) => setSettings(patchOf(path, value));

// ---------- controls ----------
const opt = (label, desc, control, cls = '') => h('div', { class: `opt ${cls}` }, h('div', { class: 'lbl' }, h('b', { text: label }), desc ? h('small', { text: desc }) : null), control);
const group = (title, ...rows) => h('div', { class: 'group' }, title ? h('h2', { text: title }) : null, ...rows);

function toggle(path, label, desc) {
  const input = h('input', { type: 'checkbox', dataset: { path, kind: 'check' } });
  input.checked = !!get(path);
  input.addEventListener('change', () => set(path, input.checked));
  return opt(label, desc, h('label', { class: 'switch' }, input, h('span')));
}
function select(path, label, options, desc) {
  const s = h('select', { dataset: { path }, html: options.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('') });
  s.value = String(get(path));
  s.addEventListener('change', () => set(path, isNaN(+s.value) || s.value === '' ? s.value : +s.value));
  return opt(label, desc, s);
}
function seg(path, label, options, desc) {
  const box = h('div', { class: 'seg', dataset: { path, kind: 'seg' } });
  for (const [v, t] of options) box.append(h('button', { text: t, dataset: { v }, class: String(get(path)) === String(v) ? 'on' : '', onclick: () => set(path, v) }));
  return opt(label, desc, box);
}
function range(path, label, min, max, step, fmt = (v) => v, desc) {
  const r = h('input', { type: 'range', min, max, step, dataset: { path } });
  const v = h('span', { class: 'val' });
  r.value = get(path);
  v.textContent = fmt(+r.value);
  r.addEventListener('input', () => (v.textContent = fmt(+r.value)));
  r.addEventListener('change', () => set(path, +r.value));
  return opt(label, desc, h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, r, v));
}
function text(path, label, desc, placeholder = '') {
  const i = h('input', { type: 'text', placeholder, dataset: { path } });
  i.value = get(path) ?? '';
  i.addEventListener('change', () => set(path, i.value));
  return opt(label, desc, i);
}
function color(path, label) {
  const c = h('input', { type: 'color', dataset: { path } });
  c.value = get(path) || '#000000';
  c.addEventListener('change', () => set(path, c.value));
  return opt(label, null, c);
}

/** Puts current values back into the controls (after a change from anywhere). */
function syncControls() {
  for (const el of $$('[data-path]')) {
    if (el === document.activeElement && el.type !== 'checkbox') continue;
    const v = get(el.dataset.path);
    if (el.dataset.kind === 'check') el.checked = !!v;
    else if (el.dataset.kind === 'seg') $$('button', el).forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
    else if (el.type === 'range') {
      el.value = v;
      el.dispatchEvent(new Event('input'));
    } else el.value = v ?? '';
  }
}

// ---------- sections ----------
const R = {};

R.general = async () => {
  const engines = await invoke('engines_get');
  return [
    group(
      'Ngôn ngữ',
      opt('Ngôn ngữ giao diện', null, langSelect())
    ),
    group(
      'Khi khởi động',
      seg('general.startup', 'Mở', [['restore', 'Các tab lần trước'], ['newtab', 'Tab mới'], ['home', 'Trang chủ']]),
      text('general.homepage', 'Trang chủ', 'Nút Trang chủ và lúc khởi động (nếu chọn)', 'unk://newtab'),
      text('general.userName', 'Tên của bạn', 'Dùng trong lời chào ở trang Tab mới')
    ),
    group(
      'Tìm kiếm',
      select('general.searchEngine', 'Công cụ tìm kiếm', Object.entries(engines).map(([k, e]) => [k, e.name])),
      text('general.customSearchUrl', 'Địa chỉ tìm kiếm tùy chỉnh', 'Dùng %s cho từ khóa', 'https://…?q=%s'),
      toggle('general.searchSuggestions', 'Gợi ý tìm kiếm', 'Hỏi công cụ tìm kiếm gợi ý khi gõ trên thanh địa chỉ')
    ),
    group(
      'Tải xuống',
      dirPicker(),
      toggle('general.askDownloadLocation', 'Hỏi nơi lưu mỗi lần tải', '(sắp có)')
    ),
    group(
      'Kiểm tra tệp tải về',
      toggle('general.scanDownloads', 'Kiểm tra tệp tải về', 'Chương trình (.exe, .msi, .bat…) và file nén có chương trình bên trong được Windows Defender quét ngay khi tải xong. Tệp có mã độc không được mở từ trình duyệt'),
      seg('general.scanTab', 'Trang kết quả', [['risky', 'Mở khi quét'], ['off', 'Không mở']], 'Trang kết quả mở ra khi một tệp được quét'),
      ...vtRows()
    ),
  ];
};

// VirusTotal (scan.rs): the user's own API key (kept encrypted with Windows' keys), and what is sent
function vtRows() {
  const status = h('small', { class: 'muted', text: '…' });
  const input = h('input', { type: 'password', placeholder: t('Dán API key (64 ký tự)'), style: { width: '280px' } });
  const save = h('button', { class: 'btn primary', text: t('Lưu') });
  const clear = h('button', { class: 'btn', text: t('Xóa key'), hidden: true });
  const draw = async () => {
    const s = await invoke('vt_status').catch(() => null);
    status.textContent = s?.hasKey ? t('Đã có API key · lưu mã hóa bằng khóa của Windows') : t('Chưa có API key');
    clear.hidden = !s?.hasKey;
  };
  save.onclick = async () => {
    if (!input.value.trim()) return;
    save.disabled = true;
    status.textContent = t('Đang thử key…');
    const r = await invoke('vt_set_key', { key: input.value }).catch(() => 'error');
    save.disabled = false;
    if (r === 'ok') input.value = '';
    else status.textContent = r === 'badkey' ? t('API key không hợp lệ') : t('Không kết nối được VirusTotal');
    if (r === 'ok') draw();
  };
  clear.onclick = async () => (await invoke('vt_clear_key'), draw());
  draw();
  return [
    opt('VirusTotal', t('Sau Windows Defender, khoảng 70 hãng bảo mật trên VirusTotal kiểm tra tệp (theo mã SHA-256). Cần API key miễn phí của bạn'), h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' } }, input, save, clear)),
    opt('', null, h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, status, h('button', { class: 'btn', text: t('Lấy API key'), onclick: () => invoke('open_tab', { url: 'https://www.virustotal.com/gui/my-apikey' }) }))),
    seg('general.vtUpload', 'Gửi tệp VirusTotal chưa biết', [['risky', 'Chỉ chương trình'], ['never', 'Không gửi'], ['all', 'Mọi tệp được quét']], 'Tệp gửi lên VirusTotal có thể được người khác xem; tệp riêng tư thì chọn "Không gửi"'),
  ];
}

function dirPicker() {
  const i = h('input', { type: 'text', dataset: { path: 'general.downloadDir' }, placeholder: 'Mặc định: thư mục Downloads của Windows' });
  i.value = get('general.downloadDir') || '';
  i.addEventListener('change', () => set('general.downloadDir', i.value.trim()));
  return opt('Thư mục tải xuống', 'Dán đường dẫn, ví dụ D:\\Downloads (nên đặt ở ổ còn nhiều chỗ trống)', i);
}

function langSelect() {
  const sel = h('select', { html: '<option value="vi">Tiếng Việt</option><option value="en">English</option>' });
  sel.value = get('general.language') === 'en' ? 'en' : 'vi';
  // (the whole interface reads the language when it loads: the pages reload, the browser's windows on their next start)
  sel.addEventListener('change', async () => {
    await set('general.language', sel.value);
    location.reload();
  });
  return sel;
}

R.extensions = async () => {
  // (the Gecko core has no Chrome extension platform: what they were for is built in)
  if (window.__TAURI__?.gecko) return [group('Tiện ích mở rộng', opt(t('Lõi Gecko không chạy tiện ích Chrome'), t('Chặn quảng cáo và trình theo dõi, chống lấy dấu vân tay, tải video (Tải từ đường dẫn), hình trong hình… đã có sẵn trong trình duyệt'), h('span')))];
  let list = [];
  let error = '';
  try {
    list = await invoke('ext_list', { lang: LANG });
  } catch (e) {
    error = String(e);
  }
  const input = h('input', { type: 'text', placeholder: 'https://chromewebstore.google.com/detail/…', style: { width: '100%' } });
  const btn = h('button', { class: 'btn primary', text: t('Cài') });
  const msg = h('small', { class: 'muted' });
  btn.onclick = async () => {
    if (!input.value.trim()) return;
    btn.disabled = true;
    msg.textContent = t('Đang cài tiện ích…');
    try {
      const r = await invoke('ext_install', { source: input.value });
      msg.textContent = t('Đã cài {0}', r.name);
      input.value = '';
      render('extensions');
    } catch (e) {
      msg.textContent = t('Không cài được tiện ích: ') + e;
    }
    btn.disabled = false;
  };
  const rows = list.map((x) => {
    const sw = h('input', { type: 'checkbox' });
    sw.checked = x.enabled;
    sw.addEventListener('change', () => invoke('ext_toggle', { id: x.id, enabled: sw.checked }));
    const acts = h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } });
    if (x.options) acts.append(h('button', { class: 'btn', text: t('Tùy chọn'), onclick: () => invoke('ext_open', { id: x.id, page: x.options, popup: false }) }));
    acts.append(h('button', { class: 'btn danger', text: t('Gỡ'), onclick: async () => (await invoke('ext_remove', { id: x.id }), setTimeout(() => render('extensions'), 400)) }), h('label', { class: 'switch' }, sw, h('span')));
    const row = opt(x.name, `${x.version ? 'v' + x.version + ' · ' : ''}${x.description || x.id}`, acts);
    if (x.icon) row.prepend(h('img', { src: x.icon, style: { width: '28px', height: '28px' } }));
    return row;
  });
  return [
    group(
      'Cài tiện ích',
      opt('Dán link trang tiện ích trên Chrome Web Store hoặc đường dẫn thư mục tiện ích đã giải nén', null, h('span'), ''),
      h('div', { class: 'opt' }, input, btn),
      h('div', { class: 'opt' }, msg, h('span', { style: { flex: 1 } }), h('button', { class: 'btn', text: t('Mở Chrome Web Store'), onclick: () => invoke('open_tab', { url: 'https://chromewebstore.google.com/category/extensions' }) }))
    ),
    group('Tiện ích mở rộng', ...(rows.length ? rows : [opt(error || t('Chưa có tiện ích nào'), null, h('span'))]), opt('', t('Tiện ích trên Chrome Web Store chạy trong WebView2. Nội dung và phần nền của tiện ích hoạt động; biểu tượng trên thanh công cụ mở cửa sổ nhỏ của tiện ích.'), h('span'))),
  ];
};

R.appearance = () => {
  const a = P.settings.appearance;
  const presets = h('div', { class: 'presets' });
  for (const [id, p] of Object.entries(PRESETS)) {
    const bg = p.wallpaper.type === 'gradient' ? `linear-gradient(${p.wallpaper.gradientAngle}deg, ${p.wallpaper.gradientFrom}, ${p.wallpaper.gradientTo})` : p.wallpaper.color;
    presets.append(
      h('button', { class: `preset ${a.preset === id ? 'on' : ''}`, onclick: () => setSettings({ appearance: { preset: id, dark: p.dark, accent: p.accent, bg: p.bg, surface: p.surface, text: p.text }, wallpaper: { ...p.wallpaper } }), html: `<div class="sw" style="background:${bg}"><i style="background:${p.accent}"></i><i style="background:${p.surface}"></i></div><span style="background:${p.surface};color:${p.text}">${esc(p.name)}</span>` })
    );
  }
  const sw = h('div', { class: 'swatches' });
  for (const c of ACCENTS) sw.append(h('button', { class: `swatch ${a.accent === c ? 'on' : ''}`, style: { background: c }, title: c, onclick: () => set('appearance.accent', c) }));
  const custom = h('input', { type: 'color', value: a.accent, dataset: { path: 'appearance.accent' } });
  custom.addEventListener('change', () => set('appearance.accent', custom.value));
  sw.append(custom);
  return [
    group('Chủ đề', presets),
    group(
      'Màu sắc',
      toggle('appearance.dark', 'Chế độ tối', 'Ctrl+Shift+D để đổi nhanh'),
      toggle('appearance.autoColor', 'Tự lấy màu theo hình nền', 'Màu nền, màu chữ và màu nhấn lấy từ ảnh hoặc video nền đang dùng'),
      opt('Màu nhấn', null, sw, 'col'),
      color('appearance.bg', 'Màu nền'),
      color('appearance.surface', 'Màu bề mặt'),
      color('appearance.text', 'Màu chữ'),
      seg('appearance.pageScheme', 'Trang web hiển thị', [['theme', 'Theo giao diện'], ['system', 'Theo Windows'], ['light', 'Luôn sáng'], ['dark', 'Luôn tối']], 'Trang web hỗ trợ chế độ tối sẽ đổi theo')
    ),
    group(
      'Chất liệu',
      seg('appearance.chromeStyle', 'Thanh công cụ', [['solid', 'Đặc'], ['glass', 'Kính mờ'], ['clear', 'Trong suốt']]),
      range('appearance.surfaceOpacity', 'Độ đục (kính mờ / trong suốt)', 0.2, 1, 0.02, (v) => `${Math.round(v * 100)}%`),
      ...(a.chromeStyle === 'clear' ? [range('appearance.clearScrim', 'Lớp làm rõ chữ', 0, 0.8, 0.02, (v) => `${Math.round(v * 100)}%`, 'Một lớp mờ dần phía sau các thanh, giúp chữ và nút dễ đọc trên mọi hình nền')] : []),
      // (from TyranWeb: where liquid glass is used, and where it is frosted instead)
      ...(a.chromeStyle === 'clear' ? [toggle('appearance.clearBookmarks', 'Kính trong suốt ở thanh dấu trang', 'Tắt: các dấu trang nằm trên kính mờ, dễ đọc trên mọi hình nền'), toggle('appearance.clearClock', 'Kính trong suốt ở đồng hồ', 'Tắt: nền kính sau đồng hồ ở trang Tab mới là kính mờ')] : []),
      range('appearance.blur', 'Độ mờ', 0, 40, 1, (v) => `${v}px`),
      range('appearance.radius', 'Bo góc', 0, 20, 1, (v) => `${v}px`),
      seg('appearance.density', 'Mật độ', [['compact', 'Gọn'], ['comfortable', 'Vừa'], ['spacious', 'Rộng']]),
      seg('appearance.tabStyle', 'Kiểu tab', [['pill', 'Viên thuốc'], ['flat', 'Phẳng'], ['underline', 'Gạch chân']]),
      toggle('appearance.animations', 'Hiệu ứng chuyển động')
    ),
    group(
      'Chữ',
      select('appearance.font', 'Phông chữ', [
        ['"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif', 'Segoe UI (mặc định)'],
        ['"Inter", "Segoe UI", sans-serif', 'Inter'],
        ['"Roboto", "Segoe UI", sans-serif', 'Roboto'],
        ['"Be Vietnam Pro", "Segoe UI", sans-serif', 'Be Vietnam Pro'],
        ['"Bahnschrift", "Segoe UI", sans-serif', 'Bahnschrift'],
        ['Georgia, serif', 'Georgia'],
        ['Consolas, monospace', 'Consolas'],
        ...[...new Set((a.customFonts || []).map((f) => f.family))].map((f) => [`"${f}", "Segoe UI", sans-serif`, f]),
      ]),
      range('appearance.fontSize', 'Cỡ chữ giao diện', 11, 17, 1, (v) => `${v}px`),
      ownFonts()
    ),
    group('Con trỏ chuột', ...cursorRows()),
    group('CSS tùy chỉnh', opt('CSS cho giao diện trình duyệt', 'Dành cho người biết CSS', cssBox(), 'col')),
  ];
};

// The user's own fonts (from TyranWeb): listed each in itself, removed, added from a file dialog
function ownFonts() {
  const families = [...new Set((P.settings.appearance.customFonts || []).map((f) => f.family))];
  const chips = h('div', { class: 'font-chips' });
  for (const f of families) chips.append(h('span', { class: 'chip font-chip', style: { fontFamily: `"${f}"` }, html: `${esc(f)} <button class="icon-btn" style="width:20px;height:20px" title="${esc(t('Xóa'))}">${icon('x', 12)}</button>`, onclick: () => invoke('fonts_remove', { family: f }).then(() => setTimeout(() => render('appearance'), 300)) }));
  const add = h('button', { class: 'btn', html: `${icon('plus', 14)} ${esc(t('Thêm phông chữ…'))}` });
  add.onclick = async () => {
    const names = await invoke('fonts_pick').catch(() => []);
    if (names?.length) setTimeout(() => render('appearance'), 300);
  };
  return opt('Phông chữ của bạn', families.length ? null : t('Tệp .ttf, .otf, .woff của bạn: dùng cho giao diện và các trang của trình duyệt'), h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' } }, chips, add));
}

// The mouse cursor (from TyranWeb): a built-in set or the user's own files for three slots
const CURSOR_SLOTS = [
  ['arrow', 'Con trỏ thường'],
  ['hand', 'Khi trỏ vào liên kết, nút bấm'],
  ['text', 'Khi trỏ vào ô nhập chữ'],
];
function cursorRows() {
  const c = P.settings.appearance.cursor || {};
  const setCursor = (patch) => setSettings({ appearance: { cursor: patch } }).then(() => setTimeout(() => render('appearance'), 200));
  const rows = [seg('appearance.cursor.set', 'Kiểu con trỏ', [['system', 'Windows'], ['sakura', 'Sakura'], ['night', 'Đêm'], ['mint', 'Bạc hà'], ['custom', 'Tự chọn']])];
  if (c.set === 'custom') {
    for (const [slot, label] of CURSOR_SLOTS) {
      const pick = h('button', { class: 'btn', text: t('Chọn file…') });
      pick.onclick = async () => {
        try {
          const f = await invoke('cursor_import');
          if (f) setCursor({ [slot]: f });
        } catch (e) {
          alert(String(e));
        }
      };
      const acts = h('div', { style: { display: 'flex', gap: '6px' } }, pick);
      if (c[slot]) acts.append(h('button', { class: 'btn', text: t('Bỏ'), onclick: () => setCursor({ [slot]: null }) }));
      rows.push(opt(label, c[slot]?.name || t('Chưa chọn (.cur, .ani, .ico, .png)'), acts));
    }
  }
  if (c.set && c.set !== 'system') rows.push(toggle('appearance.cursor.pages', 'Dùng cả trên trang web'));
  rows.push(
    opt('Tìm con trỏ miễn phí', null, h('div', { style: { display: 'flex', gap: '6px' } }, ...[['RW Designer', 'https://www.rw-designer.com/cursor-library'], ['Cursors-4U', 'https://www.cursors-4u.com/'], ['DeviantArt', 'https://www.deviantart.com/search?q=anime+cursor']].map(([n, u]) => h('button', { class: 'btn', text: n, onclick: () => invoke('open_tab', { url: u }) }))))
  );
  return rows;
}

function cssBox() {
  const t = h('textarea', { spellcheck: 'false', dataset: { path: 'appearance.customCSS' } });
  t.value = get('appearance.customCSS') || '';
  t.addEventListener('change', () => set('appearance.customCSS', t.value));
  return t;
}

// ---------- wallpaper ----------
const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
const resOf = (w) => (w.width && w.height ? `${w.width}×${w.height}` : '');

function wallPreview(w) {
  const preview = h('div', { class: 'wall-preview' });
  const st = wallpaperStyle(w, P.settings.appearance);
  Object.assign(preview.style, { backgroundImage: st.backgroundImage || 'none', backgroundColor: st.backgroundColor || '', backgroundPosition: st.backgroundPosition || 'center', filter: st.filter });
  if (w.type === 'video' && w.video) preview.append(h('video', { src: w.video, muted: true, autoplay: true, loop: true, playsinline: true, style: { filter: st.filter, objectPosition: w.position || 'center' } }));
  preview.append(h('div', { class: 'dim', style: { opacity: String(st.dim || 0) } }));
  // a miniature browser over it: how the bars sit on this wallpaper
  preview.append(h('div', { class: 'mini', html: '<i class="m-bar"></i><i class="m-bar short"></i><i class="m-page"></i>' }));
  return preview;
}

function wallTile(f, files) {
  const w = P.settings.wallpaper;
  const bare = (u) => String(u || '').split('?')[0];
  const on = f.kind === 'video' ? w.type === 'video' && bare(w.video) === f.url : w.type === 'image' && bare(w.image) === f.url;
  const inShow = (w.slideshow || []).includes(f.url);
  const tile = h('div', { class: `wp-item ${on ? 'on' : ''}`, title: [f.title || f.name, resOf(f), fmtBytes(f.size), fmtDur(f.duration)].filter(Boolean).join(' · ') });
  const pic = h('img', { alt: '', loading: 'lazy' });
  pic.addEventListener('load', () => pic.classList.add('ok'));
  const src = thumbOf(f, (url) => (pic.src = url));
  if (src) pic.src = src;
  tile.append(pic);
  if (f.kind === 'video') {
    tile.append(h('span', { class: 'wp-kind', html: icon('video', 12) }));
    let hover = null;
    tile.addEventListener('mouseenter', () => {
      hover = h('video', { class: 'wp-hover', muted: true, loop: true, autoplay: true, playsinline: true });
      hover.muted = true;
      hover.src = f.url;
      tile.append(hover);
    });
    tile.addEventListener('mouseleave', () => {
      hover?.remove();
      hover = null;
    });
  }
  tile.append(
    h('span', { class: 'wp-cap', html: `<b>${esc(f.title || f.name)}</b><small>${esc([resOf(f), f.kind === 'video' ? fmtDur(f.duration) : '', f.source].filter(Boolean).join(' · '))}</small>` }),
    h('span', { class: 'wp-check', html: icon('check', 14) }),
    f.builtin ? h('span', { class: 'wp-builtin', text: t('Mặc định') }) : f.linked ? h('span', { class: 'wp-linked', title: t('Trong thư mục liên kết: {0}', f.folder || ''), html: icon('link', 12) }) : h('button', { class: 'wp-del', title: t('Xóa'), html: icon('trash', 13) })
  );
  if (f.kind === 'image') tile.append(h('button', { class: `wp-heart ${inShow ? 'on' : ''}`, title: t(inShow ? 'Bỏ khỏi trình chiếu' : 'Thêm vào trình chiếu'), html: icon('heart', 13) }));
  tile.addEventListener('click', async (e) => {
    if (e.target.closest('.wp-del')) {
      tile.classList.add('leaving');
      await invoke('wallpaper_delete', { name: f.name });
      const patch = { slideshow: (w.slideshow || []).filter((u) => u !== f.url) };
      if (on) Object.assign(patch, f.kind === 'video' ? { type: 'gradient', video: '' } : { type: 'gradient', image: '' });
      return setSettings({ wallpaper: patch });
    }
    if (e.target.closest('.wp-heart')) {
      const list = w.slideshow || [];
      return set('wallpaper.slideshow', inShow ? list.filter((u) => u !== f.url) : [...list, f.url]);
    }
    setSettings({ wallpaper: f.kind === 'video' ? { type: 'video', video: f.url } : { type: 'image', image: f.url } });
  });
  return tile;
}

function addTile(label, accept) {
  const input = h('input', { type: 'file', accept, multiple: true, hidden: true });
  const tile = h('button', { class: 'wp-item wp-add', html: `${icon('plus', 22)}<span>${esc(t(label))}</span>` }, input);
  tile.addEventListener('click', (e) => e.target !== input && input.click());
  input.addEventListener('change', async () => {
    tile.classList.add('busy');
    let last = null;
    for (const file of input.files) {
      try {
        last = await invoke('wallpaper_save', new Uint8Array(await file.arrayBuffer()), { headers: { 'x-name': encodeURIComponent(file.name) } });
      } catch (e) {
        alert(t('Không thêm được {0}: {1}', file.name, e));
      }
    }
    tile.classList.remove('busy');
    if (last) setSettings({ wallpaper: last.kind === 'video' ? { type: 'video', video: last.url } : { type: 'image', image: last.url } });
  });
  return tile;
}

function videoFromLink() {
  const input = h('input', { type: 'url', placeholder: 'https://…/video.mp4', style: { flex: '1', width: 'auto' } });
  const go = h('button', { class: 'btn', html: `${icon('download', 15)}<span>${esc(t('Tải về và dùng'))}</span>` });
  const bar = h('div', { class: 'progress', hidden: true }, h('i'));
  const msg = h('small', { class: 'muted' });
  const fetchIt = async () => {
    const url = input.value.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return (msg.textContent = t('Dán link tới file .mp4 hoặc .webm'));
    go.disabled = true;
    bar.hidden = false;
    const id = `link-${Date.now()}`;
    const off = await listen('store-progress', (p) => p.id === id && (bar.firstChild.style.width = `${p.total ? Math.round((p.got / p.total) * 100) : 30}%`));
    msg.textContent = t('Đang tải video…');
    try {
      const v = await invoke('wallpaper_video_url', { url, id });
      input.value = '';
      msg.textContent = '';
      setSettings({ wallpaper: { type: 'video', video: v.url } });
    } catch (e) {
      msg.textContent = t('Không tải được video: {0}', e);
    } finally {
      off();
      go.disabled = false;
      bar.hidden = true;
      bar.firstChild.style.width = '0';
    }
  };
  go.addEventListener('click', fetchIt);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && fetchIt());
  return h('div', { class: 'opt col' }, h('div', { class: 'lbl' }, h('b', { text: t('Video từ một đường link') }), h('small', { text: t('Link trực tiếp tới file .mp4 / .webm') })), h('div', { class: 'row' }, input, go), bar, msg);
}

R.wallpaper = async () => {
  const w = P.settings.wallpaper;
  const files = await invoke('wallpaper_list');
  // (Wings' own wallpaper, the default one, always there first)
  const builtin = { name: 'wings-default', builtin: true, kind: 'image', url: DEFAULT_WALLPAPER, thumb: DEFAULT_WALLPAPER_THUMB, title: 'Wings', source: t('Hình nền mặc định'), width: 2000, height: 923, size: 461848 };
  const images = [builtin, ...files.filter((f) => f.kind === 'image')];
  const videos = files.filter((f) => f.kind === 'video');
  const imgGrid = h('div', { class: 'wp-grid' }, addTile('Thêm ảnh từ máy', 'image/*'), ...images.map((f) => wallTile(f, files)));
  const vidGrid = h('div', { class: 'wp-grid' }, addTile('Thêm video từ máy', 'video/mp4,video/webm,video/quicktime'), ...videos.map((f) => wallTile(f, files)));
  const find = h(
    'div',
    { class: 'find-walls' },
    h('button', { class: 'find-card', onclick: () => invoke('open_tab', { url: 'unk://store/#images' }), html: `<span class="ic">${icon('image', 22)}</span><span><b>${esc(t('Tìm ảnh nền'))}</b><small>${esc(t('Hàng triệu ảnh 1080p–4K từ Wallhaven'))}</small></span>${icon('chevronRight', 16)}` }),
    h('button', { class: 'find-card', onclick: () => invoke('open_tab', { url: 'unk://store/#videos' }), html: `<span class="ic">${icon('video', 22)}</span><span><b>${esc(t('Kho video nền'))}</b><small>${esc(t('Video động từ MoeWalls, MotionBGs, WallpaperWaifu'))}</small></span>${icon('chevronRight', 16)}` })
  );
  const inShow = (w.slideshow || []).filter((u) => images.some((f) => f.url === u)).length;
  const desk = h('button', { class: 'btn', html: `${icon('window', 15)}<span>${esc(t('Dùng hình nền desktop'))}</span>` });
  desk.onclick = async () => {
    desk.disabled = true;
    try {
      await invoke('wallpaper_desktop');
    } catch (e) {
      alert(String(e));
    }
    desk.disabled = false;
  };
  return [
    group(
      'Hình nền',
      wallPreview(w),
      seg('wallpaper.type', 'Loại', [['gradient', 'Gradient'], ['color', 'Màu trơn'], ['image', 'Ảnh'], ['video', 'Video'], ...(GECKO ? [['web', 'Trang web']] : [])]),
      find
    ),
    ...(GECKO ? [await webSection(), await mediaTools(), musicSection()] : []),
    group(`${t('Ảnh của bạn')} · ${images.length}`, imgGrid, opt('Hình nền desktop của Windows', 'Lấy đúng ảnh đang đặt trên desktop', desk)),
    group(`${t('Video của bạn')} · ${videos.length}`, vidGrid, videoFromLink()),
    group('Màu', color('wallpaper.color', 'Màu trơn'), color('wallpaper.gradientFrom', 'Gradient: màu đầu'), color('wallpaper.gradientTo', 'Gradient: màu cuối'), range('wallpaper.gradientAngle', 'Gradient: góc', 0, 360, 5, (v) => `${v}°`)),
    group(
      'Hiệu chỉnh',
      seg('wallpaper.position', 'Căn ảnh', [['center', 'Giữa'], ['top', 'Trên'], ['bottom', 'Dưới'], ['left', 'Trái'], ['right', 'Phải']]),
      range('wallpaper.dim', 'Làm tối', 0, 0.8, 0.02, (v) => `${Math.round(v * 100)}%`),
      range('wallpaper.blur', 'Làm mờ', 0, 30, 1, (v) => `${v}px`),
      range('wallpaper.saturate', 'Độ bão hòa', 0, 2, 0.05, (v) => `${Math.round(v * 100)}%`),
      range('wallpaper.videoRate', 'Tốc độ video', 0.25, 2, 0.05, (v) => `${v}×`),
      seg('wallpaper.motion', 'Video chạy khi', [['focus', 'Đang dùng trình duyệt'], ['always', 'Luôn luôn'], ['newtab', 'Chỉ ở Tab mới']], 'Tạm dừng video khi không dùng để tiết kiệm CPU')
    ),
    group(
      'Trình chiếu',
      select('wallpaper.slideshowMinutes', 'Tự đổi ảnh', [[0, 'Tắt'], [1, 'Mỗi 1 phút'], [5, 'Mỗi 5 phút'], [15, 'Mỗi 15 phút'], [30, 'Mỗi 30 phút'], [60, 'Mỗi giờ'], [180, 'Mỗi 3 giờ']]),
      opt(
        t('Ảnh trong trình chiếu: {0}', inShow),
        'Bấm biểu tượng trái tim trên ảnh để thêm hoặc bỏ',
        h('div', { class: 'row' }, h('button', { class: 'btn', text: t('Chọn tất cả'), onclick: () => set('wallpaper.slideshow', images.map((f) => f.url)) }), h('button', { class: 'btn', text: t('Bỏ chọn'), onclick: () => set('wallpaper.slideshow', []) }))
      )
    ),
  ];
};

// ---------- more of the wallpapers (from TyranWeb; the Gecko build) ----------
const GECKO = !!window.__TAURI__?.gecko;

// Hình nền web: a site, or a web wallpaper package (Wallpaper Engine / Lively: a folder or a zip),
// and Specials: web wallpapers found on GitHub
async function webSection() {
  const w = P.settings.wallpaper;
  const web = w.web || {};
  const packs = await invoke('web_list').catch(() => []);
  const url = h('input', { type: 'url', placeholder: 'https://…', value: web.package ? '' : web.url || '', style: { width: '320px' } });
  const useUrl = h('button', { class: 'btn primary', text: t('Dùng trang này') });
  useUrl.onclick = () => {
    let u = url.value.trim();
    if (!u) return;
    if (!/^[a-z]+:/i.test(u)) u = 'https://' + u;
    setSettings({ wallpaper: { type: 'web', web: { url: u, package: '', preset: 'url' } } });
  };
  const grid = h('div', { class: 'wp-grid' });
  for (const p of packs) {
    const on = w.type === 'web' && web.package === p.id;
    const tile = h('div', { class: `wp-item ${on ? 'on' : ''}`, title: [p.title, p.source, p.license].filter(Boolean).join(' · ') });
    tile.append(p.previewUrl ? h('img', { src: p.previewUrl, alt: '', class: 'ok' }) : h('div', { class: 'wp-web-ph', html: icon('globe', 26) }));
    tile.append(h('span', { class: 'wp-cap', html: `<b>${esc(p.title)}</b><small>${esc([p.source, p.license].filter(Boolean).join(' · '))}</small>` }), h('span', { class: 'wp-check', html: icon('check', 14) }), h('button', { class: 'wp-del', title: t('Xóa'), html: icon('trash', 13) }));
    tile.addEventListener('click', async (e) => {
      if (e.target.closest('.wp-del')) {
        await invoke('web_remove', { id: p.id });
        if (on) await setSettings({ wallpaper: { type: 'gradient', web: { url: '', package: '' } } });
        return render('wallpaper');
      }
      setSettings({ wallpaper: { type: 'web', web: { url: p.url, package: p.id, preset: 'package' } } });
    });
    grid.append(tile);
  }
  const imp = (kind, label) =>
    h('button', {
      class: 'btn',
      html: `${icon(kind === 'zip' ? 'download' : 'folder', 14)} ${esc(t(label))}`,
      onclick: async () => {
        try {
          const p = await invoke('web_pick', { kind });
          if (p) await setSettings({ wallpaper: { type: 'web', web: { url: p.url, package: p.id, preset: 'package' } } });
          render('wallpaper');
        } catch (e) {
          alert(String(e));
        }
      },
    });
  return group(
    'Hình nền web',
    opt('Trang web làm hình nền', t('Một trang web (đồng hồ, hiệu ứng, trang động…) chạy phía sau giao diện'), h('div', { style: { display: 'flex', gap: '6px' } }, url, useUrl)),
    opt('Gói hình nền web', t('Thư mục hoặc file zip có index.html: hình nền web của Wallpaper Engine, Lively…'), h('div', { style: { display: 'flex', gap: '6px' } }, imp('folder', 'Thêm thư mục'), imp('zip', 'Thêm file zip'))),
    packs.length ? grid : null,
    toggle('wallpaper.web.audio', 'Phát âm thanh của hình nền web'),
    specialsBox()
  );
}

// Specials: GitHub's repositories tagged wallpaper-engine / lively-wallpaper / live-wallpaper
function specialsBox() {
  const box = h('div', { class: 'specials' });
  const q = h('input', { type: 'search', placeholder: t('Tìm hình nền web trên GitHub (để trống: nhiều sao nhất)'), style: { flex: '1' } });
  const go = h('button', { class: 'btn', html: `${icon('search', 14)} ${esc(t('Tìm'))}` });
  const list = h('div', { class: 'sp-list' });
  let page = 1;
  const more = h('button', { class: 'btn', text: t('Xem thêm'), hidden: true });
  const search = async (reset) => {
    if (reset) {
      page = 1;
      list.replaceChildren(h('small', { class: 'muted', text: t('Đang tìm…') }));
    }
    try {
      const r = await invoke('specials_search', { q: q.value, page });
      if (reset) list.replaceChildren();
      for (const it of r.items) list.append(specialRow(it));
      more.hidden = r.items.length < 20;
    } catch (e) {
      list.replaceChildren(h('small', { class: 'muted', text: String(e) }));
    }
  };
  go.onclick = () => search(true);
  q.addEventListener('keydown', (e) => e.key === 'Enter' && search(true));
  more.onclick = () => (page++, search(false));
  box.append(h('div', { class: 'sp-head' }, h('b', { text: t('Tìm trên GitHub') }), h('small', { class: 'muted', text: t('Hình nền web người dùng chia sẻ (Wallpaper Engine, Lively). Chỉ cài từ người bạn tin; trang chạy trong hình nền như một trang web') })), h('div', { style: { display: 'flex', gap: '6px' } }, q, go), list, more);
  return h('div', { class: 'opt col' }, box);
}

function specialRow(it) {
  const state = h('small', { class: 'muted', text: '' });
  const btn = h('button', { class: 'btn', text: t('Cài') });
  const row = h('div', { class: 'sp-row' }, h('div', { class: 'sp-text' }, h('b', { text: it.id }), h('small', { class: 'muted', text: [`★ ${it.stars}`, it.license, it.desc].filter(Boolean).join(' · ') }), state), h('button', { class: 'btn ghost', text: 'GitHub', onclick: () => invoke('open_tab', { url: it.url }) }), btn);
  btn.onclick = async () => {
    btn.disabled = true;
    state.textContent = t('Đang xem kho…');
    const info = await invoke('specials_inspect', { full: it.id, branch: it.branch }).catch(() => null);
    if (!info?.kind) {
      state.textContent = info?.why ? t('Không phải hình nền web ({0})', info.why) : t('Không tìm thấy trang hình nền trong kho này');
      return;
    }
    state.textContent = t('Đang tải…');
    const off = await listen('specials-progress', (p) => p.id === it.id && (state.textContent = t('Đang tải {0}', fmtBytes(p.got))));
    try {
      const p = await invoke('specials_install', { item: { id: it.id, full: it.id, branch: it.branch, license: it.license, size: it.size } });
      await setSettings({ wallpaper: { type: 'web', web: { url: p.url, package: p.id, preset: 'package' } } });
      render('wallpaper');
    } catch (e) {
      state.textContent = String(e);
      btn.disabled = false;
    }
    off?.();
  };
  return row;
}

// many pictures / videos at once (files, a folder, a zip); folders linked to be used in place
async function mediaTools() {
  const info = await invoke('wallpaper_folders').catch(() => ({ folders: [], dir: '' }));
  const add = (kind, label, ic) =>
    h('button', {
      class: 'btn',
      html: `${icon(ic, 14)} ${esc(t(label))}`,
      onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const r = await invoke('wallpaper_import_many', { kind });
          if (r.added.length || r.skipped) alert(t('Đã thêm {0} hình nền{1}', r.added.length, r.skipped ? t(' · bỏ qua {0} file trùng', r.skipped) : ''));
        } catch (err) {
          alert(String(err));
        }
        render('wallpaper');
      },
    });
  const link = h('button', {
    class: 'btn',
    html: `${icon('link', 14)} ${esc(t('Liên kết thư mục'))}`,
    onclick: async () => {
      await invoke('wallpaper_link_pick').catch((e) => alert(String(e)));
      render('wallpaper');
    },
  });
  const chips = info.folders.map((f) =>
    h('span', { class: `chip wp-folder ${f.missing ? 'deny' : ''}`, title: f.path, html: `${icon('folder', 13)} ${esc(f.title)} · ${esc(f.missing ? t('không tìm thấy') : t('{0} file', f.count))} <button class="icon-btn" style="width:20px;height:20px" title="${esc(t('Bỏ liên kết (không xoá file nào)'))}">${icon('x', 12)}</button>`, onclick: (e) => e.target.closest('button') && invoke('wallpaper_unlink_folder', { id: f.id }).then(() => render('wallpaper')) })
  );
  return group(
    'Thêm và thư mục',
    h('div', { class: 'opt', style: { flexWrap: 'wrap', gap: '6px', justifyContent: 'flex-start' } }, add('files', 'Thêm ảnh / video…', 'plus'), add('folder', 'Thêm cả thư mục', 'folder'), add('zip', 'Thêm file zip', 'download'), link),
    chips.length ? h('div', { class: 'opt', style: { flexWrap: 'wrap', gap: '6px', justifyContent: 'flex-start' } }, ...chips) : null,
    opt('Thư mục lưu hình nền', info.dir, h('button', { class: 'btn', html: `${icon('external', 14)} ${esc(t('Mở'))}`, onclick: () => invoke('wallpaper_open_folder') }))
  );
}

// a wallpaper's own music: audio files, or a YouTube / SoundCloud / Spotify link
const MUSIC_KINDS = { files: 'File nhạc', youtube: 'YouTube', soundcloud: 'SoundCloud', spotify: 'Spotify' };
function musicKeyOf(w) {
  if (w.type === 'image') return w.image ? 'image:' + w.image : '';
  if (w.type === 'video') return w.video ? 'video:' + w.video : '';
  if (w.type === 'web') return w.web?.url ? 'web:' + w.web.url : '';
  return '';
}
function musicSection() {
  const w = P.settings.wallpaper;
  const key = musicKeyOf(w);
  if (!key) return group('Nhạc nền', opt(t('Chọn một ảnh, video hoặc trang web làm hình nền để gắn nhạc cho nó'), null, h('span')));
  const mine = w.music?.[key] || null;
  const setMusic = (entry) => setSettings({ wallpaper: { music: { ...(w.music || {}), [key]: entry } } }).then(() => render('wallpaper'));
  const state = !mine ? t('Chưa có') : mine.kind === 'files' ? t('{0} bài: {1}', mine.files.length, mine.files.slice(0, 4).map((f) => f.title).join(', ') + (mine.files.length > 4 ? '…' : '')) : `${MUSIC_KINDS[mine.kind]}: ${mine.title}`;
  const link = h('input', { type: 'url', placeholder: t('Dán link YouTube, SoundCloud hoặc Spotify'), style: { width: '320px' } });
  const useLink = h('button', { class: 'btn primary', text: t('Dùng') });
  useLink.onclick = async () => {
    useLink.disabled = true;
    try {
      setMusic(await invoke('music_link', { url: link.value }));
    } catch (e) {
      alert(String(e));
      useLink.disabled = false;
    }
  };
  const files = h('button', { class: 'btn', html: `${icon('music', 14)} ${esc(t('File nhạc…'))}` });
  files.onclick = async () => {
    const list = await invoke('music_pick').catch(() => []);
    if (list.length) setMusic({ kind: 'files', files: list, shuffle: false });
  };
  const rows = [
    opt('Nhạc của hình nền này', state, h('div', { style: { display: 'flex', gap: '6px' } }, files, mine ? h('button', { class: 'btn', text: t('Bỏ nhạc'), onclick: () => setMusic(null) }) : null)),
    opt('Link nhạc', null, h('div', { style: { display: 'flex', gap: '6px' } }, link, useLink)),
  ];
  if (mine?.kind === 'files') {
    const sh = h('input', { type: 'checkbox', checked: !!mine.shuffle });
    sh.addEventListener('change', () => setMusic({ ...mine, shuffle: sh.checked }));
    rows.push(opt('Phát ngẫu nhiên', null, h('label', { class: 'switch' }, sh, h('span'))));
  }
  if (mine) rows.push(toggle('wallpaper.musicOn', 'Phát nhạc nền', 'Phát khi trang Tab mới hoặc Lobby đang mở'), range('wallpaper.musicVolume', 'Âm lượng nhạc nền', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, mine.kind === 'files' ? null : t('Nhạc từ link dùng âm lượng của trình phát của trang đó')));
  rows.push(seg('wallpaper.pauseForSound', 'Khi tab khác phát âm thanh', [['tabs', 'Tạm dừng nhạc nền'], ['off', 'Vẫn phát']]));
  rows.push(toggle('newtab.visualizer', 'Phổ nhạc dưới hình nền', 'Các cột sóng nhạc chạy theo nhạc nền (file nhạc) ở chân hình nền'));
  return group('Nhạc nền', ...rows);
}

const TOOLBAR_LABELS = { back: 'Quay lại', forward: 'Tiến tới', reload: 'Tải lại', home: 'Trang chủ', media: 'Video trên trang', extensions: 'Tiện ích mở rộng', downloads: 'Tải xuống', split: 'Chia đôi', screenshot: 'Chụp màn hình', sidebar: 'Thanh bên', taskmgr: 'Quản lý tác vụ', palette: 'Bảng lệnh', menu: 'Menu' };

R.layout = () => {
  const l = P.settings.layout;
  const items = h('div', { class: 'items' });
  for (const [id, name] of Object.entries(TOOLBAR_LABELS)) {
    const shown = l.toolbarItems.includes(id) && !l.hiddenToolbarItems.includes(id);
    items.append(
      h('button', {
        class: `chip ${shown ? 'on' : ''}`,
        html: `${shown ? icon('check', 14) : icon('plus', 14)} ${esc(name)}`,
        onclick: () => {
          let ti = [...l.toolbarItems];
          let hidden = l.hiddenToolbarItems.filter((x) => x !== id);
          if (!ti.includes(id)) ti.splice(ti.length - 1, 0, id);
          else if (shown) hidden.push(id);
          setSettings({ layout: { toolbarItems: ti, hiddenToolbarItems: hidden } });
        },
      })
    );
  }
  return [
    group(
      'Tab',
      seg('layout.tabsPosition', 'Vị trí thanh tab', [['top', 'Trên'], ['left', 'Bên trái'], ['right', 'Bên phải']]),
      ...(l.tabsPosition !== 'top' ? [range('layout.verticalTabsWidth', 'Độ rộng cột tab', 180, 400, 4, (v) => `${v}px`), toggle('layout.verticalTabsCollapsed', 'Thu gọn cột tab', 'Chỉ còn biểu tượng của các trang')] : []),
      seg('layout.tabCloseButton', 'Nút đóng tab', [['hover', 'Khi rê chuột'], ['always', 'Luôn hiện']]),
      toggle('layout.showStatusBubble', 'Bong bóng địa chỉ liên kết', 'Rê chuột lên liên kết: địa chỉ hiện ở góc dưới trang. Tắt: hiện trên thanh địa chỉ')
    ),
    group('Thanh công cụ', seg('layout.toolbarPosition', 'Vị trí', [['top', 'Trên'], ['bottom', 'Dưới']]), opt('Các nút', 'Bấm để hiện / ẩn', h('span'), ''), items),
    group('Thanh dấu trang', seg('layout.bookmarksBar', 'Hiện thanh dấu trang', [['always', 'Luôn luôn'], ['newtab', 'Chỉ ở Tab mới'], ['off', 'Không']])),
    group('Vùng trang web', range('layout.contentInset', 'Khoảng cách viền', 0, 28, 1, (v) => `${v}px`), range('layout.contentRadius', 'Bo góc khung trang', 0, 28, 1, (v) => `${v}px`), toggle('layout.contentShadow', 'Đổ bóng')),
    group('Thanh bên', seg('layout.sidebarPosition', 'Vị trí', [['left', 'Trái'], ['right', 'Phải']]), range('layout.sidebarWidth', 'Độ rộng', 240, 720, 10, (v) => `${v}px`), toggle('layout.sidebarOpen', 'Mở thanh bên', 'Ctrl+Shift+E')),
  ];
};

R.newtab = () => [
  group(
    'Đồng hồ và lời chào',
    toggle('newtab.showClock', 'Đồng hồ'),
    toggle('newtab.clock24h', 'Định dạng 24 giờ'),
    toggle('newtab.showSeconds', 'Hiện giây'),
    toggle('newtab.showDate', 'Ngày tháng', 'Dưới đồng hồ'),
    toggle('newtab.showGreeting', 'Lời chào'),
    text('newtab.greetingText', 'Lời chào tự viết', 'Để trống: chào theo giờ trong ngày'),
    toggle('newtab.heroGlass', 'Nền kính sau đồng hồ', 'Cũng bật / tắt được bằng cách bấm vào đồng hồ'),
    toggle('newtab.heroGlassMid', 'Cả khi không ẩn thanh tìm kiếm', 'Nền kính cả khi đồng hồ ở giữa trang')
  ),
  group(
    'Tìm kiếm và lối tắt',
    toggle('newtab.showSearch', 'Ô tìm kiếm'),
    toggle('newtab.showSpeedDial', 'Lối tắt'),
    range('newtab.speedDialColumns', 'Số cột lối tắt', 3, 10, 1),
    toggle('newtab.hideTools', 'Ẩn thanh tìm kiếm và lối tắt', 'Nút con mắt ở góc trang: thu gọn, đồng hồ lướt lên góc trái'),
    opt('Vị trí các khối', 'Nút Sắp xếp ở góc trang Tab mới: kéo đồng hồ, thanh tìm kiếm, lối tắt tới chỗ bạn muốn (lúc hiện và lúc ẩn công cụ nhớ riêng)', h('button', { class: 'btn', text: t('Về mặc định'), onclick: () => setSettings({ newtab: { positions: { shown: null, hidden: null } } }) }))
  ),
  group(
    'Anime hôm nay',
    toggle('newtab.showAnime', 'Gợi ý một anime 2000–2010 mỗi ngày', 'Từ AniList, ở góc trang Tab mới'),
    select('newtab.animeGenre', 'Thể loại', [['Slice of Life', 'Slice of Life'], ['Romance', 'Romance'], ['Comedy', 'Comedy'], ['Drama', 'Drama'], ['Action', 'Action'], ['Mecha', 'Mecha'], ['Sci-Fi', 'Sci-Fi'], ['Fantasy', 'Fantasy'], ['Mystery', 'Mystery'], ['Music', 'Music'], ['all', 'Tất cả']])
  ),
];

// ---------- what sites may use (perms.rs) ----------
const PERM_NAMES = { camera: 'Camera', microphone: 'Micro', geolocation: 'Vị trí', notifications: 'Thông báo', sensors: 'Cảm biến chuyển động', 'clipboard-read': 'Đọc khay nhớ tạm', downloads: 'Tải nhiều tệp', files: 'Sửa tệp trên máy', 'local-fonts': 'Phông chữ trên máy', midi: 'Thiết bị MIDI', 'window-management': 'Quản lý cửa sổ' };
function permRows() {
  const all = Object.entries(P.settings.sitePermissions || {}).filter(([, v]) => v && Object.keys(v).length);
  if (!all.length) return [opt(t('Chưa có trang nào'), t('Khi một trang xin dùng camera, micro, vị trí… bạn chọn và đánh dấu "Nhớ lựa chọn", trang đó hiện ở đây'), h('span'))];
  return all.map(([origin, perms]) => {
    const chips = h('div', { class: 'perm-chips' });
    for (const [k, v] of Object.entries(perms)) {
      chips.append(h('span', { class: `chip ${v === 'allow' ? 'on' : 'deny'}`, title: t('Bấm để quên lựa chọn này'), html: `${esc(t(PERM_NAMES[k] || k))}: ${esc(v === 'allow' ? t('Cho phép') : t('Chặn'))} ${icon('x', 11)}`, onclick: () => invoke('perm_set', { origin, kind: k, value: '' }) }));
    }
    return opt(origin.replace(/^https?:\/\//, ''), null, chips, 'perm-row');
  });
}

// ---------- Dọn rác (cleaner.rs) ----------
function cleanerRows() {
  const box = h('div', { class: 'cleaner' }, h('small', { class: 'muted', text: t('Đang đo…') }));
  const PARTS = [
    ['cache', 'Bộ nhớ đệm trang web', 'Tệp tạm của các trang (sẽ tải lại khi cần). Đăng nhập, lịch sử không bị ảnh hưởng'],
    ['crash', 'Báo cáo lỗi', 'Tệp ghi lại khi trang bị treo'],
    ['leftovers', 'Tệp tải dở', 'Phần còn lại của các lượt tải bị dừng giữa chừng'],
    ['temp', 'Thư mục Temp của Windows', 'Tệp tạm của mọi ứng dụng, không đổi trong 7 ngày (tệp đang dùng được giữ lại)'],
  ];
  const draw = async () => {
    const r = await invoke('cleaner_scan');
    box.replaceChildren();
    const checks = {};
    for (const [id, label, desc] of PARTS) {
      const part = r?.[id] || { bytes: 0, files: 0 };
      const cb = h('input', { type: 'checkbox', checked: id !== 'temp' && part.bytes > 0 });
      checks[id] = cb;
      box.append(h('label', { class: 'cl-row' }, cb, h('span', { class: 'cl-text' }, h('b', { text: t(label) }), h('small', { text: t(desc) + (id === 'temp' && r?.temp?.path ? ` · ${r.temp.path}` : '') })), h('span', { class: 'cl-size', text: part.bytes ? fmtBytes(part.bytes) : '0 B' })));
    }
    const btn = h('button', { class: 'btn primary', text: t('Dọn các mục đã chọn') });
    const msg = h('small', { class: 'muted' });
    btn.onclick = async () => {
      const parts = Object.entries(checks).filter(([, c]) => c.checked).map(([k]) => k);
      if (!parts.length) return;
      btn.disabled = true;
      msg.textContent = t('Đang dọn…');
      const res = await invoke('cleaner_run', { parts });
      msg.textContent = t('Đã dọn {0}', fmtBytes(res?.freed || 0)) + (parts.includes('cache') ? ' · ' + t('bộ nhớ đệm đang được WebView2 xoá') : '');
      setTimeout(draw, 2500);
    };
    box.append(h('div', { class: 'row cl-foot' }, msg, h('span', { style: { flex: '1' } }), btn));
  };
  draw();
  return [h('div', { class: 'opt col' }, box)];
}

// ---------- Ẩn danh: InPrivate windows' history (PrivHistory.sys.mjs): off until switched on, kept
// encrypted, looked at in Lịch sử → Ẩn danh. Its PIN (4 or 6 digits) is asked for there only; made
// here, and changed or removed only with the one set. Forgotten: the history goes with it.
function pinInput(len, onFull) {
  const el = h('input', { type: 'password', class: 'pin-input', inputmode: 'numeric', autocomplete: 'off', maxlength: len, placeholder: '•'.repeat(len), 'aria-label': t('Mật khẩu') });
  el.addEventListener('input', () => {
    const n = Number(el.maxLength) || len;
    el.value = el.value.replace(/\D/g, '').slice(0, n);
    if (el.value.length === n) onFull?.(el.value);
  });
  return el;
}
const pinWait = (r) => (r.wait > 0 ? t('Sai quá nhiều lần. Thử lại sau {0} giây', Math.ceil(r.wait / 1000)) : r.left ? t('Sai mật khẩu, còn {0} lần thử', r.left) : t('Sai mật khẩu'));

R.incognito = async () => {
  const st = await invoke('privhist_status').catch(() => null);
  const form = h('div', { class: 'pin-form', hidden: true });
  const close = () => {
    form.hidden = true;
    form.replaceChildren();
  };
  // (done: the section drawn again, with what was done under it)
  const done = (msg) => {
    close();
    render().then(() => {
      const n = $('.pin-done');
      if (n) n.textContent = msg;
    });
  };
  // one step of the form: what it asks, its fields, a message line, its buttons
  const step = (title, fields, buttons = []) => {
    const err = h('span', { class: 'pin-err' });
    form.replaceChildren(h('b', { text: title }), h('div', { class: 'pin-fields' }, ...fields), err, h('div', { class: 'pin-actions' }, ...buttons, h('button', { class: 'btn', text: t('Hủy'), onclick: close })));
    form.hidden = false;
    form.querySelector('input')?.focus();
    return err;
  };
  // the new PIN: 4 or 6 digits, typed twice
  const askNew = (current) => {
    let len = st?.pin || 4;
    let err;
    const a = pinInput(len, () => b.focus());
    const b = pinInput(len);
    const lens = h('div', { class: 'seg' });
    for (const n of [4, 6]) {
      lens.append(
        h('button', {
          text: t('{0} chữ số', n),
          class: n === len ? 'on' : '',
          onclick: (e) => {
            len = n;
            for (const x of [a, b]) Object.assign(x, { maxLength: n, placeholder: '•'.repeat(n), value: '' });
            lens.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === e.currentTarget));
            a.focus();
          },
        })
      );
    }
    const save = h('button', { class: 'btn primary', text: t('Lưu mật khẩu') });
    save.onclick = async () => {
      if (a.value.length !== len) return (err.textContent = t('Mật khẩu cần đủ {0} chữ số', len));
      if (a.value !== b.value) return (err.textContent = t('Hai lần nhập không khớp'));
      save.disabled = true;
      const r = await invoke('privhist_set_pin', { current, pin: a.value }).catch(() => ({ ok: false }));
      save.disabled = false;
      if (!r.ok) return (err.textContent = r.wait || r.left !== undefined ? pinWait(r) : t('Không lưu được mật khẩu'));
      done(current ? t('Đã đổi mật khẩu ✿') : t('Đã đặt mật khẩu ✿'));
    };
    b.addEventListener('keydown', (e) => e.key === 'Enter' && save.click());
    err = step(current ? t('Mật khẩu mới') : t('Tạo mật khẩu'), [lens, h('label', { class: 'pin-field' }, h('span', { text: t('Mật khẩu') }), a), h('label', { class: 'pin-field' }, h('span', { text: t('Nhập lại') }), b)], [save]);
  };
  // the PIN set, before it is changed or removed
  const askCurrent = (then) => {
    let err;
    const input = pinInput(st.pin, async (pin) => {
      input.disabled = true;
      const r = await invoke('privhist_check', { pin }).catch(() => ({ ok: false }));
      input.disabled = false;
      input.value = '';
      if (!r.ok) {
        err.textContent = pinWait(r);
        return input.focus();
      }
      then(pin);
    });
    err = step(t('Nhập mật khẩu hiện tại'), [input]);
  };
  let pinDesc = '';
  const pinCtl = h('div', { class: 'pin-ctl' });
  if (st?.broken) pinDesc = t('Tệp lịch sử ẩn danh không mở được trên máy tính hoặc tài khoản Windows này');
  else if (st) {
    pinDesc = st.pin ? t('Mã {0} số, hỏi khi xem Lịch sử → Ẩn danh', st.pin) : t('Chưa đặt: ai mở Lịch sử → Ẩn danh cũng xem được');
    if (!st.pin) pinCtl.append(h('button', { class: 'btn', html: `${icon('lock', 14)} ${esc(t('Tạo mật khẩu'))}`, onclick: () => askNew(null) }));
    else
      pinCtl.append(
        h('button', { class: 'btn', text: t('Đổi mật khẩu'), onclick: () => askCurrent((pin) => askNew(pin)) }),
        h('button', {
          class: 'btn',
          text: t('Bỏ mật khẩu'),
          onclick: () =>
            askCurrent(async (pin) => {
              const r = await invoke('privhist_set_pin', { current: pin, pin: null }).catch(() => ({ ok: false }));
              done(r.ok ? t('Đã bỏ mật khẩu') : t('Không bỏ được mật khẩu'));
            }),
        })
      );
  }
  const reset = h('button', { class: 'btn danger', text: t('Xóa') });
  reset.onclick = async () => {
    if (!reset.dataset.armed) {
      reset.dataset.armed = '1';
      reset.textContent = t('Bấm lần nữa để xác nhận');
      setTimeout(() => {
        delete reset.dataset.armed;
        reset.textContent = t('Xóa');
      }, 3000);
      return;
    }
    await invoke('privhist_reset');
    done(t('Đã xóa lịch sử ẩn danh'));
  };
  return [
    group(
      'Lịch sử ẩn danh',
      toggle('privacy.privateHistory', 'Lưu lịch sử cửa sổ InPrivate', 'Các trang mở trong cửa sổ InPrivate được ghi vào một tệp mã hóa riêng, chỉ xem được trong Lịch sử → Ẩn danh.'),
      opt(t('Mật khẩu xem lịch sử ẩn danh'), pinDesc, pinCtl),
      form,
      opt('Xem lịch sử ẩn danh', null, h('button', { class: 'btn', text: t('Mở'), onclick: () => invoke('open_tab', { url: 'unk://history/#private' }) })),
      opt('Xóa lịch sử ẩn danh và mật khẩu', 'Dùng khi quên mật khẩu: lịch sử ẩn danh mất hẳn, không lấy lại được.', reset)
    ),
    h('span', { class: 'pin-done' }),
    h('p', { class: 'muted pin-note', text: 'Tệp lịch sử ẩn danh được mã hóa bằng khóa của Windows cho tài khoản này và bằng mật khẩu của bạn: chép sang máy khác hay mở bằng chương trình khác đều không đọc được. Nhập sai 5 lần thì phải đợi rồi mới thử lại được.' }),
  ];
};

R.privacy = async () => {
  const status = await invoke('adblock_status');
  const off = P.settings.privacy.adblockOff || [];
  const sites = h('div', { class: 'site-list' }, ...(off.length ? off.map((d) => h('span', { class: 'chip', html: `${esc(d)} <button class="icon-btn" style="width:20px;height:20px" title="Bật lại">${icon('x', 12)}</button>`, onclick: () => set('privacy.adblockOff', off.filter((x) => x !== d)) })) : [h('span', { class: 'muted', text: 'Chưa có trang nào.' })]));
  const update = h('button', { class: 'btn', text: 'Cập nhật bộ lọc ngay' });
  update.onclick = async () => {
    update.disabled = true;
    update.textContent = 'Đang tải bộ lọc…';
    await invoke('adblock_update');
    update.textContent = 'Đã cập nhật';
  };
  const clearSel = h('select', { html: '<option value="3600000">1 giờ qua</option><option value="86400000">24 giờ qua</option><option value="604800000">7 ngày qua</option><option value="0" selected>Toàn bộ</option>' });
  const kinds = h('select', { html: '<option value="all">Tất cả (cookie, bộ nhớ đệm, dữ liệu trang)</option><option value="cache">Bộ nhớ đệm</option><option value="cookies">Cookie</option><option value="storage">Dữ liệu trang (localStorage…)</option><option value="history">Chỉ lịch sử duyệt web</option>' });
  const clearBtn = h('button', { class: 'btn danger', text: 'Xóa dữ liệu' });
  clearBtn.onclick = async () => {
    const span = +clearSel.value;
    const since = span ? Date.now() - span : 0;
    if (kinds.value === 'history' || kinds.value === 'all') await invoke('history_delete_range', { from: since, to: Date.now() });
    if (kinds.value !== 'history') await invoke('clear_data', { kinds: kinds.value, since });
    clearBtn.textContent = 'Đã xóa';
    setTimeout(() => (clearBtn.textContent = 'Xóa dữ liệu'), 2000);
  };
  return [
    h('div', { class: 'shields-hero', html: `<span class="ic">${icon('shieldCheck', 26)}</span><span><b>${esc(t('Shields'))}</b><small>${esc(t('Các lớp bảo vệ giống Brave. Tắt cho riêng một trang bằng biểu tượng khiên trên thanh địa chỉ.'))}</small></span>` }),
    group(
      'Chặn quảng cáo và trình theo dõi',
      toggle('privacy.adblock', 'Chặn quảng cáo và trình theo dõi', `${t('Bộ máy của Brave với EasyList, EasyPrivacy, uBlock filters, ABPVN và scriptlet chặn quảng cáo YouTube')} · ${status.ready ? t('đang hoạt động') : t('đang tải bộ lọc…')}`),
      toggle('privacy.cookieNotices', 'Ẩn bảng hỏi cookie', 'Danh sách EasyList Cookie: bỏ các bảng "Chấp nhận cookie" che trang'),
      opt('Bộ lọc', 'Tự cập nhật mỗi tuần', update)
    ),
    group(
      'Chống theo dõi',
      toggle('privacy.fingerprint', 'Chống lấy dấu vân tay', 'Canvas, WebGL, âm thanh và số nhân CPU trả về hơi khác nhau theo từng trang và mỗi lần mở trình duyệt, nên trang web không nhận ra bạn qua chúng'),
      toggle('privacy.blockThirdPartyCookies', 'Chặn cookie bên thứ ba', 'Trang nhúng (quảng cáo, nút mạng xã hội) không đọc được cookie của chúng khi bạn ở trang khác · có hiệu lực ở lần mở trình duyệt sau'),
      toggle('privacy.stripParams', 'Bỏ tham số theo dõi trong link', 'fbclid, gclid, msclkid… (mã gắn vào link để theo dõi bạn) được bỏ khỏi địa chỉ khi bạn mở trang từ trang khác, theo danh sách của Brave'),
      toggle('privacy.debounce', 'Bỏ qua trang chuyển hướng theo dõi', 'Link đi qua một trang đếm lượt bấm thì đi thẳng tới đích'),
      toggle('privacy.doNotTrack', 'Gửi tín hiệu "Không theo dõi"', 'Kèm DNT và Global Privacy Control trong mọi yêu cầu')
    ),
    group('Kết nối', toggle('privacy.httpsUpgrade', 'HTTPS mặc định', 'Địa chỉ http:// được thử qua https:// trước; trang không hỗ trợ thì tự quay lại http://')),
    group('Cloudflare WARP', ...warpRows()),
    group('Các trang đã tắt Shields', opt('', 'Bật lại bằng cách bấm vào tên trang', h('span')), sites),
    group('Quyền đã cấp cho trang web', ...permRows()),
    group('Xóa dữ liệu duyệt web', opt('Khoảng thời gian', null, clearSel), opt('Loại dữ liệu', null, kinds), opt('', null, clearBtn)),
    group('Dọn rác', ...cleanerRows()),
  ];
};

// Cloudflare WARP (from TyranWeb; warp.rs): the switch, WARP's state and where the pages come from
// now, and the one thing to press for: getting WARP, its proxy mode, or a new connection
function warpRows() {
  const status = h('small', { class: 'muted', text: '…' });
  const actions = h('div', { style: { display: 'flex', gap: '6px' } });
  const press = (what) => async (e) => {
    e.currentTarget.disabled = true;
    status.textContent = '…';
    try {
      await invoke('warp_action', { what });
    } catch (err) {
      status.textContent = String(err);
    }
    draw();
  };
  async function draw() {
    const s = await invoke('warp_state').catch(() => null);
    actions.replaceChildren();
    if (!s) return (status.textContent = '');
    if (!s.installed) {
      status.textContent = t('Chưa cài WARP');
      return actions.append(h('button', { class: 'btn', text: t('Tải WARP'), onclick: () => invoke('open_tab', { url: 'https://one.one.one.one/' }) }));
    }
    const w = s.where;
    status.textContent = [s.proxy ? (s.connected ? (s.routed ? t('Đang đi qua WARP') : t('Đã kết nối')) : t('Chưa kết nối')) : t('WARP đang ở chế độ VPN'), w?.ip ? `IP ${w.ip}${w.loc ? ` (${w.loc})` : ''}` : '', w?.warp ? `warp=${w.warp}` : ''].filter(Boolean).join(' · ');
    if (!s.proxy) actions.append(h('button', { class: 'btn', text: t('Chuyển WARP sang chế độ proxy'), onclick: press('proxy') }));
    else actions.append(h('button', { class: 'btn', html: `${icon('reload', 14)} ${esc(t('Đổi IP'))}`, onclick: press('renew') }));
  }
  draw();
  const row = toggle('privacy.warp', 'Đi qua Cloudflare WARP', 'Trang web đi qua mạng của Cloudflare (IP khác); các chương trình khác trên máy không bị ảnh hưởng. Cần ứng dụng WARP ở chế độ proxy');
  row.querySelector('input').addEventListener('change', () => setTimeout(draw, 3000));
  return [row, opt('Trạng thái', null, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, status, actions))];
}

R.performance = () => [
  group(
    'Tiết kiệm RAM',
    range('general.tabFreezeMinutes', 'Đóng băng tab nền sau', 0, 60, 1, (v) => (v ? `${v} phút` : 'Tắt'), 'Trang bị tạm dừng và trả bớt bộ nhớ; bấm vào là chạy tiếp ngay'),
    range('general.tabSleepMinutes', 'Cho tab ngủ sau', 0, 240, 5, (v) => (v ? `${v} phút` : 'Tắt'), 'Đóng hẳn trang để giải phóng RAM; bấm vào sẽ tải lại. Tab ghim và tab đang phát âm thanh không bị ngủ')
  ),
  group(
    'Ổ đĩa',
    range('privacy.diskCacheMB', 'Giới hạn bộ nhớ đệm', 50, 2048, 50, (v) => `${v} MB`, 'Có hiệu lực ở lần mở trình duyệt sau'),
    toggle('general.smoothScrolling', 'Cuộn mượt', 'Có hiệu lực ở lần mở trình duyệt sau')
  ),
  group('Theo dõi', opt('Trình quản lý tác vụ', 'RAM và CPU của từng tab (Shift+Esc)', h('button', { class: 'btn', text: 'Mở', onclick: () => invoke('taskmgr_open') }))),
];

R.shortcuts = () => {
  const custom = P.settings.shortcuts || {};
  const rows = Object.entries(SHORTCUTS).map(([id, c]) => {
    const keys = Array.isArray(custom[id]) ? custom[id] : c.keys;
    const box = h('div', { class: 'keys' });
    const save = (list) => setSettings({ shortcuts: { ...P.settings.shortcuts, [id]: list } });
    for (const k of keys) box.append(h('span', { class: 'kbd', html: `${esc(k)}<button title="Bỏ">${icon('x', 11)}</button>`, onclick: () => save(keys.filter((x) => x !== k)) }));
    const rec = h('button', { class: 'kbd', html: `${icon('plus', 12)} Thêm` });
    rec.onclick = () => {
      rec.classList.add('rec');
      rec.textContent = 'Bấm tổ hợp phím…';
      const onKey = (e) => {
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
        e.preventDefault();
        document.removeEventListener('keydown', onKey, true);
        const combo = comboOf(e);
        if (combo && !keys.includes(combo)) save([...keys, combo]);
        else render('shortcuts');
      };
      document.addEventListener('keydown', onKey, true);
    };
    box.append(rec);
    return opt(c.label, null, box, 'keys-row');
  });
  return [group('Phím tắt', opt('Khôi phục mặc định', 'Mọi phím tắt về như ban đầu', h('button', { class: 'btn', text: 'Khôi phục', onclick: () => invoke('settings_reset', { section: 'shortcuts' }) })), ...rows)];
};

const CODE_NAMES = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Escape: 'Esc', Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', NumpadAdd: 'Plus', NumpadSubtract: 'NumMinus' };
function comboOf(e) {
  let k = e.code;
  if (/^Key[A-Z]$/.test(k)) k = k.slice(3);
  else if (/^Digit\d$/.test(k)) k = k.slice(5);
  else if (CODE_NAMES[k]) k = CODE_NAMES[k];
  else if (!/^(F\d{1,2}|Tab|PageUp|PageDown|Home|End|Delete|Enter|Space)$/.test(k)) return '';
  return `${e.ctrlKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${k}`;
}

R.about = async () => {
  const info = await invoke('app_info');
  return [
    group(
      null,
      h('div', { class: 'about', html: `<img src="../../shared/logo.svg" alt=""><div><h3>${esc(info.name)}</h3><div class="muted">${esc(info.engine ? t('Phiên bản {0} · chạy trên lõi {1}', info.version, info.engine) : t('Phiên bản {0} · chạy trên WebView2 có sẵn của Windows', info.version))}</div></div>` }),
      h('div', { class: 'kv', html: `<span>${esc(info.engine ? t('Lõi trình duyệt') : 'Phiên bản WebView2')}</span><code>${esc(info.engine || info.webview2)}</code><span>Hồ sơ</span><code>${esc(info.profile)}</code><span>Thư mục tải xuống</span><code>${esc(info.downloads)}</code>` })
    ),
    group('Cập nhật', toggle('general.checkUpdates', 'Kiểm tra cập nhật', 'Tự kiểm tra phiên bản mới khi mở trình duyệt'), text('general.updateRepo', 'Kho phát hành trên GitHub', 'Dạng chủ/kho, ví dụ ten-ban/wings'), opt('', null, updateButton())),
    ...[await dataFolderGroup()].filter(Boolean),
    group('Sao lưu và khôi phục', opt('Sao lưu', 'Lưu cài đặt, dấu trang, lịch sử và ghi chú vào một tệp', backupButtons())),
    group('Đặt lại', opt('Đặt lại toàn bộ cài đặt', 'Dấu trang, lịch sử và hình nền của bạn được giữ nguyên', h('button', { class: 'btn danger', text: 'Đặt lại', onclick: () => confirm('Đặt lại toàn bộ cài đặt về mặc định?') && invoke('settings_reset', {}) }))),
  ];
};

// ---------- where the data lives: this browser's own folder, or TyranWeb's (the same files) ----------
async function dataFolderGroup() {
  const [f, ty] = await Promise.all([invoke('data_folder_get').catch(() => null), invoke('tyran_sync_status', { claim: false }).catch(() => null)]);
  if (!f) return null;
  const same = (a, b) => (a || '').replace(/[\\/]+$/, '').toLowerCase().replace(/\//g, '\\') === (b || '').replace(/[\\/]+$/, '').toLowerCase().replace(/\//g, '\\');
  const out = h('span', { class: 'muted', style: { marginRight: '12px' } });
  const restart = h('button', { class: 'btn primary', text: t('Khởi động lại ngay'), hidden: true, onclick: () => invoke('app_restart') });
  const act = (mode, dir, msg) => async () => {
    try {
      await invoke('data_folder_set', { mode, dir: dir || '' });
      out.textContent = msg;
      restart.hidden = false;
      setTimeout(() => render(), 400);
    } catch (e) {
      out.textContent = String(e);
    }
  };
  const pickThen = (mode, msg) => async () => {
    const dir = await invoke('data_folder_pick');
    if (dir) await act(mode, dir, msg)();
  };
  const usingTyran = f.tyran && same(f.dir, f.tyran);
  const pending = (f.next && !same(f.next, f.dir)) || f.import || (!f.next && !same(f.dir, f.own));
  const kv = [
    ['Đang dùng', f.dir],
    ...(f.tyran ? [['Dữ liệu TyranWeb', f.tyran]] : []),
    ...(f.import ? [['Chép vào lần mở tới', f.import]] : []),
    ...(f.next && !same(f.next, f.dir) ? [['Dùng từ lần mở tới', f.next]] : []),
    ...(!f.next && !same(f.dir, f.own) ? [['Dùng từ lần mở tới', f.own]] : []),
  ];
  const btn = (text, onclick, cls = 'btn') => h('button', { class: cls, text: t(text), onclick });
  return group(
    'Thư mục dữ liệu',
    h('div', { class: 'kv', html: kv.map(([k, v]) => `<span>${esc(t(k))}</span><code>${esc(v)}</code>`).join('') }),
    ...(ty?.data ? [tyranSyncRow(ty, out, restart)] : []),
    opt(
      'Cùng định dạng với TyranWeb',
      'settings.json, history.json, bookmarks.json, downloads.json, session.json, window-history.json, window-state.json, scan-history.json, notes.json — y hệt TyranWeb (có bản .bak). Dùng chung một thư mục thì đừng mở cả hai trình duyệt cùng lúc.',
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
        btn('Chọn thư mục…', pickThen('use', t('Từ lần mở tới sẽ dùng thư mục đã chọn'))),
        btn('Chép từ thư mục…', pickThen('import', t('Lần mở tới sẽ chép dữ liệu từ thư mục đã chọn'))),
        ...(!same(f.dir, f.own) || f.next ? [btn('Về thư mục riêng', act('default', '', t('Từ lần mở tới sẽ dùng thư mục riêng của Wings')))] : []),
        ...(pending ? [btn('Hủy thay đổi', act('cancel', '', t('Đã hủy')))] : [])
      )
    ),
    opt('', null, h('div', {}, out, restart))
  );
}

// ---------- Đồng bộ data từ TyranWeb: its data copied, its wallpaper folder shared ----------
// (offered once at a start for TyranWeb 1.8.0+; here at any time). The data files are copied at the
// restart that follows; the pictures and videos stay in TyranWeb's folder, used by both browsers.
function tyranSyncRow(ty, out, restart) {
  const LABEL = 'Đồng bộ data từ TyranWeb';
  const ver = ty.version ? `TyranWeb ${String(ty.version).replace(/^(\d+\.\d+\.\d+)\.0$/, '$1')}` : t('TyranWeb (không rõ phiên bản)');
  const notes = [ver];
  if (ty.synced) notes.push(t('đồng bộ lần cuối {0}', new Date(ty.synced).toLocaleString(LANG === 'vi' ? 'vi-VN' : 'en-US')));
  else if (ty.asked && ty.answer === 'no') notes.push(t('lần trước bạn đã chọn Không'));
  if (ty.using) {
    // (TyranWeb's folder chosen as the data folder itself: a copy needs this browser's own)
    return opt(LABEL, `${notes.join(' · ')} — ${t('Wings đang dùng thẳng thư mục data của TyranWeb; về thư mục riêng để đồng bộ bằng bản chép')}`, h('span'));
  }
  if (ty.pending) {
    return opt(LABEL, `${notes.join(' · ')} — ${t('data của TyranWeb được chép khi khởi động lại')}`, h('button', { class: 'btn primary', text: t('Khởi động lại ngay'), onclick: () => invoke('app_restart') }));
  }
  const go = h('button', {
    class: 'btn critical',
    html: `${icon('cycle', 15)}<span>${esc(t(LABEL))}</span>`,
    onclick: async () => {
      const ok = await confirmBox({
        title: t('Đồng bộ data từ TyranWeb?'),
        lines: [
          [t('Dữ liệu hiện tại của bạn trong Wings sẽ bị mất.'), 'strong'],
          [t('Cài đặt, lịch sử, dấu trang, tải xuống, ghi chú và các tab đang mở của {0} ({1}) sẽ được chép sang, thay cho dữ liệu hiện tại. Trình duyệt sẽ khởi động lại ngay.', ver, ty.data)],
          [ty.walls ? t('Riêng ảnh nền và video nền dùng chung thư mục với TyranWeb ({0}): ảnh / video thêm hay xoá ở bên này cũng thay đổi bên kia.', ty.walls) : t('Riêng ảnh nền và video nền dùng chung thư mục với TyranWeb.'), 'small'],
          [t('Bản cũ của Wings được cất trong thư mục before-import-… cạnh thư mục dữ liệu; file data của TyranWeb giữ nguyên.'), 'small'],
        ],
        cancel: t('Hủy'),
        ok: t('Tiếp tục'),
      });
      if (!ok) return;
      try {
        await invoke('tyran_sync_start');
        out.textContent = t('Đang khởi động lại để đồng bộ…');
        restart.hidden = true;
        setTimeout(() => invoke('app_restart'), 800);
      } catch (e) {
        out.textContent = t('Không đồng bộ được: {0}', String(e));
      }
    },
  });
  return opt(LABEL, `${notes.join(' · ')} — ${t('chép data của TyranWeb sang (riêng ảnh nền, video nền dùng chung thư mục)')}`, go);
}

/** A warning that waits for its answer: Hủy (the default) or the red button. */
function confirmBox({ title, lines, cancel, ok }) {
  return new Promise((resolve) => {
    const no = h('button', { class: 'btn', text: cancel });
    const yes = h('button', { class: 'btn critical', text: ok });
    const box = h(
      'div',
      { class: 'confirm', role: 'alertdialog', 'aria-modal': 'true' },
      h('h3', { html: `<span class="warn">${icon('warn', 20)}</span><span>${esc(title)}</span>` }),
      ...lines.map(([text, cls]) => h('p', { class: cls || '', text })),
      h('div', { class: 'actions' }, no, yes)
    );
    const scrim = h('div', { class: 'confirm-scrim' }, box);
    const done = (v) => {
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        done(false);
      }
    };
    no.onclick = () => done(false);
    yes.onclick = () => done(true);
    document.addEventListener('keydown', onKey, true);
    document.body.append(scrim);
    no.focus();
  });
}

function updateButton() {
  const b = h('button', { class: 'btn', text: t('Kiểm tra cập nhật') });
  const out = h('span', { class: 'muted', style: { marginRight: '12px' } });
  b.onclick = async () => {
    out.textContent = '…';
    try {
      const u = await invoke('update_check');
      if (!u.repo) out.textContent = t('Chưa đặt kho phát hành');
      else if (u.newer) {
        out.textContent = t('Có phiên bản mới {0}', u.latest);
        invoke('open_tab', { url: u.url });
      } else out.textContent = t('Đang dùng bản mới nhất');
    } catch (e) {
      out.textContent = String(e);
    }
  };
  return h('div', {}, out, b);
}

function backupButtons() {
  const file = h('input', { type: 'file', accept: '.json', hidden: true });
  const out = h('span', { class: 'muted', style: { marginRight: '12px' } });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      await invoke('backup_import', { data: JSON.parse(await f.text()) });
      out.textContent = t('Đã khôi phục');
    } catch (e) {
      out.textContent = String(e);
    }
  });
  const make = h('button', { class: 'btn primary', text: t('Tạo bản sao lưu'), onclick: async () => {
    const data = await invoke('backup_export');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `wings-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  } });
  return h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, out, make, h('button', { class: 'btn', text: t('Khôi phục từ tệp…'), onclick: () => file.click() }), file);
}

// ---------- page ----------
let current = '';
let renderSeq = 0;
async function render(id = current) {
  const switched = id !== current;
  current = id;
  const seq = ++renderSeq;
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.id === id));
  moveNavInk();
  const sec = SECTIONS.find((s) => s.id === id) || SECTIONS[0];
  const parts = await R[sec.id]();
  if (seq !== renderSeq) return; // (a newer render started meanwhile)
  const main = $('#main');
  const scroll = main.scrollTop;
  main.replaceChildren(h('div', { class: `sec${switched ? ' enter' : ''}` }, h('h1', { text: sec.title }), ...parts));
  main.scrollTop = switched ? 0 : scroll;
}

/** The highlight behind the chosen section slides to it. */
function moveNavInk() {
  const on = $('#nav a.on');
  const ink = $('#nav .ink');
  if (!on || !ink) return;
  ink.style.transform = `translateY(${on.offsetTop}px)`;
  ink.style.height = `${on.offsetHeight}px`;
  ink.style.opacity = '1';
}

async function main() {
  await initPage();
  $('#nav').append(
    h('div', { class: 'title', html: `<img src="../../shared/logo-small.svg" alt="">Cài đặt` }),
    h('div', { class: 'links' }, h('i', { class: 'ink' }), ...SECTIONS.map((s) => h('a', { href: `#${s.id}`, dataset: { id: s.id }, html: `${icon(s.icon, 18)}<span>${esc(s.title)}</span>` })))
  );
  const fromHash = () => render((location.hash.slice(1) || 'general').split('/')[0]);
  window.addEventListener('hashchange', fromHash);
  await fromHash();
  // sections drawn from lists redraw; the rest only take the new values
  onSettings(() => {
    if (['appearance', 'wallpaper', 'layout', 'privacy', 'shortcuts', 'extensions'].includes(current) && !document.activeElement?.matches('input[type=range], input[type=text], input[type=url], textarea')) render();
    else syncControls();
  });
  listen('wallpapers-changed', () => current === 'wallpaper' && !document.activeElement?.matches('input[type=url]') && render());
}
main();
