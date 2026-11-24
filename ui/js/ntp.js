// The new tab page, drawn by the shell itself over its own wallpaper. A new tab has no WebView2 until
// it goes somewhere: it opens at once, costs no memory, and its wallpaper is the window's (one video
// playing, not two out of step). The page version (pages/newtab) is used only in split view.
import { invoke, h, esc, toUrl, favicon, hostOf } from '../shared/api.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { S, $, on } from './state.js';
import { T, active, createTab, navigate } from './tabs.js';
import { menu, float, closeFloating } from './menus.js';
import { ownMusic, toggleMusic, musicPlaying } from './music.js';

let root = null;
let shown = false;
let clockTimer = 0;
let enterTimer = 0;

const n = () => S.settings.newtab;
const setNewtab = (patch) => invoke('settings_set', { patch: { newtab: patch } });

function build() {
  const glassBtn = (cls, title, ic) => h('button', { type: 'button', class: `glass-btn ${cls}`, title, html: icon(ic, 16) });
  root = h(
    'div',
    { id: 'ntp', hidden: true },
    h('section', { class: 'hero' }, h('div', { class: 'clock-wrap' }, h('div', { class: 'clock' }), h('div', { class: 'date' })), h('div', { class: 'greeting' })),
    h('form', { class: 'search', autocomplete: 'off' }, h('span', { class: 'eng', html: icon('search', 18) }), h('input', { type: 'text', spellcheck: 'false', placeholder: t('Tìm kiếm hoặc nhập địa chỉ') })),
    h('section', { class: 'dial' }),
    h('aside', { id: 'anime', hidden: true }),
    // (from TyranWeb: the buttons in the corner, on glass)
    h(
      'div',
      { class: 'ntp-actions' },
      h(
        'div',
        { class: 'foot-row' },
        glassBtn('tools-btn', '', 'eyeOff'),
        glassBtn('arrange-btn', t('Sắp xếp: kéo đồng hồ, thanh tìm kiếm, lối tắt tới chỗ bạn muốn'), 'layout'),
        glassBtn('lobby-btn', t('Chế độ Lobby — chỉ ngắm hình nền (Ctrl+Shift+L)'), 'tv'),
        glassBtn('spectrum-btn', '', 'spectrum'),
        h('button', { type: 'button', class: 'glass-btn music-btn', title: t('Nhạc nền'), html: icon('music', 16), hidden: true }),
        glassBtn('store-btn', t('Kho nền video'), 'video'),
        h('button', { type: 'button', class: 'glass-btn wide customize', title: t('Tùy chỉnh trang Tab mới'), html: `${icon('sparkles', 15)}<span>${esc(t('Tùy biến'))}</span>` })
      )
    ),
    h(
      'div',
      { class: 'arrange-bar', hidden: true },
      h('span', { text: t('Kéo các khối tới chỗ bạn muốn · bấm nút con mắt để sắp cho lúc ẩn / hiện công cụ') }),
      h('button', { type: 'button', class: 'glass-btn wide', text: t('Về mặc định'), onclick: () => setNewtab({ positions: { [stateKey()]: null } }) }),
      h('button', { type: 'button', class: 'glass-btn wide primary', text: t('Xong'), onclick: () => setArranging(false) })
    )
  );
  root.querySelector('.music-btn').addEventListener('click', toggleMusic);
  on('music', musicButton);
  root.querySelector('.tools-btn').addEventListener('click', () => setNewtab({ hideTools: !n().hideTools }));
  root.querySelector('.arrange-btn').addEventListener('click', () => setArranging(!arranging));
  root.querySelector('.lobby-btn').addEventListener('click', () => import('./extras.js').then((m) => m.setLobby(true)));
  root.querySelector('.spectrum-btn').addEventListener('click', () => setNewtab({ visualizer: !n().visualizer }));
  root.querySelector('.store-btn').addEventListener('click', (e) => go('unk://store/#videos', e.ctrlKey || e.metaKey));
  // clicking the clock shows or hides the glass pane behind it (remembered): in the corner, or in the
  // middle with the search bar and shortcuts shown
  root.querySelector('.hero').addEventListener('click', () => {
    if (arranging) return;
    const s = n();
    if (s.hideTools) setNewtab({ heroGlass: s.heroGlass === false });
    else setNewtab(s.heroGlass !== false && s.heroGlassMid ? { heroGlassMid: false } : { heroGlass: true, heroGlassMid: true });
  });
  arrangeEvents();
  new ResizeObserver(() => !drag && placeBlocks()).observe(root);
  for (const sel of Object.values(BLOCKS)) new ResizeObserver(() => !drag && placeBlocks()).observe(root.querySelector(sel));
  $('#content').insertBefore(root, $('#viewport').nextSibling);
  root.querySelector('.search').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = root.querySelector('.search input');
    const url = toUrl(input.value, S.settings, S.engines);
    input.value = '';
    if (url) go(url);
  });
  const dial = root.querySelector('.dial');
  dial.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    e.preventDefault();
    if (tile.dataset.add) return editTile(-1, tile);
    const d = n().speedDial[+tile.dataset.i];
    if (d) go(d.url, e.ctrlKey || e.metaKey);
  });
  dial.addEventListener('auxclick', (e) => {
    const tile = e.target.closest('.tile:not(.add)');
    if (e.button === 1 && tile) createTab({ url: n().speedDial[+tile.dataset.i].url, background: true });
  });
  dial.addEventListener('contextmenu', (e) => {
    const tile = e.target.closest('.tile:not(.add)');
    if (!tile) return;
    e.preventDefault();
    const i = +tile.dataset.i;
    const d = n().speedDial[i];
    menu(
      [
        { label: t('Mở trong tab mới'), icon: 'plus', run: () => createTab({ url: d.url, background: true }) },
        { label: t('Mở trong cửa sổ InPrivate'), icon: 'incognito', run: () => invoke('win_new', { private: true, url: d.url }) },
        'sep',
        { label: t('Sửa lối tắt'), icon: 'edit', run: () => editTile(i, tile) },
        { label: t('Gỡ lối tắt'), icon: 'trash', run: () => removeTile(i, tile) },
      ],
      { x: e.clientX, y: e.clientY }
    );
  });
  dragToReorder(dial);
  root.querySelector('.customize').addEventListener('click', (e) => customize(e.currentTarget));
}

/** Where a tile or the search box leads: this tab, or a new one (Ctrl+click). */
function go(url, newTab = false) {
  if (newTab) return createTab({ url, background: true });
  const tab = active();
  if (tab) navigate(tab, url);
}

const DAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
function clock() {
  if (!root) return;
  const d = new Date();
  let hh = d.getHours();
  let suffix = '';
  if (!n().clock24h) {
    suffix = hh >= 12 ? ' PM' : ' AM';
    hh = hh % 12 || 12;
  }
  const html = `${String(hh).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}${n().showSeconds ? `<span class="sec">${String(d.getSeconds()).padStart(2, '0')}</span>` : ''}${suffix ? `<span class="sec">${suffix}</span>` : ''}`;
  const el = root.querySelector('.clock');
  if (el.innerHTML !== html) el.innerHTML = html;
  const date = t('{0}, {1} tháng {2}, {3}', t(DAYS[d.getDay()]), d.getDate(), d.getMonth() + 1, d.getFullYear());
  const de = root.querySelector('.date');
  if (de.textContent !== date) de.textContent = date;
}

function greeting() {
  const name = S.settings.general.userName;
  const hr = new Date().getHours();
  const by = hr < 5 ? 'Khuya rồi, nghỉ ngơi nhé' : hr < 11 ? 'Chào buổi sáng' : hr < 13 ? 'Chào buổi trưa' : hr < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  root.querySelector('.greeting').textContent = n().greetingText || (name ? `${t(by)}, ${name}` : t(by));
}

function dial() {
  const box = root.querySelector('.dial');
  const list = n().speedDial || [];
  box.style.setProperty('--cols', String(Math.max(1, Math.min(n().speedDialColumns || 6, list.length + 1))));
  box.innerHTML =
    list
      .map((d, i) => {
        const letter = esc((hostOf(d.url)[0] || '?').toUpperCase());
        return `<a class="tile" href="${esc(d.url)}" data-i="${i}" title="${esc(d.title)}\n${esc(d.url)}" draggable="false" style="--i:${i}"><div class="ic"><img src="${esc(favicon(d.url))}" alt="" draggable="false" onerror="this.outerHTML='<span class=&quot;letter&quot;>${letter}</span>'"></div><span>${esc(d.title)}</span></a>`;
      })
      .join('') + `<a class="tile add" href="#" data-add="1" title="${esc(t('Thêm lối tắt'))}" style="--i:${list.length}"><div class="ic">${icon('plus', 20)}</div><span>${esc(t('Thêm lối tắt'))}</span></a>`;
}

function apply() {
  if (!root) return;
  const s = n();
  const hero = root.querySelector('.hero');
  hero.hidden = !s.showClock && !s.showGreeting;
  root.querySelector('.clock').hidden = !s.showClock;
  root.querySelector('.greeting').hidden = !s.showGreeting;
  root.querySelector('.search').hidden = !s.showSearch;
  root.querySelector('.dial').hidden = !s.showSpeedDial;
  const g = S.settings.general;
  root.querySelector('.search input').placeholder = t('Tìm với {0} hoặc nhập địa chỉ', g.searchEngine === 'custom' ? t('công cụ tùy chỉnh') : S.engines?.[g.searchEngine]?.name || 'Google');
  root.classList.toggle('on-picture', ['image', 'video', 'web'].includes(S.settings.wallpaper.type));
  // (from TyranWeb) the search bar and shortcuts hidden: the clock glides to the corner, smaller
  const hide = !!s.hideTools;
  if (hide !== root.classList.contains('tools-hidden')) {
    const flip = () => {
      root.classList.toggle('tools-hidden', hide);
      placeBlocks(); // (each state has its own places)
    };
    if (shown && !root.hidden && applied) glideHero(flip);
    else flip();
  }
  const tools = root.querySelector('.tools-btn');
  tools.innerHTML = icon(hide ? 'eye' : 'eyeOff', 16);
  tools.title = hide ? t('Hiện thanh tìm kiếm và lối tắt') : t('Ẩn thanh tìm kiếm và lối tắt');
  // the glass pane behind the clock: in the corner (heroGlass), and in the middle too (heroGlassMid)
  root.classList.toggle('hero-plain', s.heroGlass === false);
  const mid = !hide && s.heroGlass !== false && !!s.heroGlassMid;
  root.classList.toggle('hero-mid', mid);
  root.classList.toggle('hero-frost', S.settings.appearance?.clearClock === false);
  const glass = hide ? s.heroGlass !== false : mid;
  root.classList.toggle('hero-glass', glass);
  hero.title = glass ? t('Bấm để ẩn nền kính sau đồng hồ') : t('Bấm để hiện nền kính sau đồng hồ');
  root.querySelector('.date').hidden = !s.showClock || s.showDate === false;
  const spec = root.querySelector('.spectrum-btn');
  spec.classList.toggle('on', !!s.visualizer);
  spec.title = s.visualizer ? t('Ẩn thanh nhạc') : t('Hiện thanh nhạc');
  clock();
  greeting();
  dial();
  anime();
  musicButton();
  placeBlocks(); // (once the clock and the shortcuts are drawn, at their real size)
  applied = true;
}

// ---------- "Sắp xếp" (from TyranWeb) ----------
// The clock, the search bar and the shortcuts can be dragged anywhere. Each state (tools shown /
// hidden) keeps its own places, saved as the block's centre in fractions of the page so they hold
// when the window is resized; blocks never placed keep their usual spot.
const BLOCKS = { hero: '.hero', search: '.search', dial: '.dial' };
const stateKey = () => (n().hideTools ? 'hidden' : 'shown');
let arranging = false;
let drag = null;
let applied = false;

function placeBlocks() {
  if (!root || root.hidden) return;
  const pos = n().positions?.[stateKey()] || {};
  const W = root.clientWidth;
  const H = root.clientHeight;
  for (const [name, sel] of Object.entries(BLOCKS)) {
    const el = root.querySelector(sel);
    const p = pos[name];
    el.classList.toggle('placed', !!p);
    if (!p) {
      el.style.left = el.style.top = '';
      continue;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = `${Math.round(Math.min(W - w, Math.max(0, p.x * W - w / 2)))}px`;
    el.style.top = `${Math.round(Math.min(H - h, Math.max(0, p.y * H - h / 2)))}px`;
  }
}

function setArranging(v) {
  arranging = v;
  root.classList.toggle('arranging', v);
  root.querySelector('.arrange-bar').hidden = !v;
  root.querySelector('.arrange-btn').classList.toggle('on', v);
}

// dragging a block; near the page's middle lines it snaps onto them
function arrangeEvents() {
  root.addEventListener(
    'pointerdown',
    (e) => {
      if (!arranging || e.button !== 0) return;
      const entry = Object.entries(BLOCKS).find(([, sel]) => e.target.closest(`#ntp > ${sel}`));
      if (!entry) return;
      const el = root.querySelector(entry[1]);
      if (getComputedStyle(el).visibility === 'hidden' || el.hidden) return;
      e.preventDefault();
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      const box = root.getBoundingClientRect();
      if (!box.width || !box.height) return;
      drag = { name: entry[0], el, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, box };
      el.style.left = `${r.left - box.left}px`;
      el.style.top = `${r.top - box.top}px`;
      el.classList.add('placed', 'dragging');
      el.setPointerCapture(e.pointerId);
    },
    true
  );
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { box } = drag;
    let x = e.clientX - box.left - drag.dx;
    let y = e.clientY - box.top - drag.dy;
    if (Math.abs(x + drag.w / 2 - box.width / 2) < 14) x = box.width / 2 - drag.w / 2;
    if (Math.abs(y + drag.h / 2 - box.height / 2) < 14) y = box.height / 2 - drag.h / 2;
    x = Math.min(box.width - drag.w, Math.max(0, x));
    y = Math.min(box.height - drag.h, Math.max(0, y));
    drag.el.style.left = `${Math.round(x)}px`;
    drag.el.style.top = `${Math.round(y)}px`;
    drag.x = (x + drag.w / 2) / box.width;
    drag.y = (y + drag.h / 2) / box.height;
  });
  const end = () => {
    if (!drag) return;
    const { name, el, x, y } = drag;
    el.classList.remove('dragging');
    drag = null;
    if (Number.isFinite(x) && Number.isFinite(y)) setNewtab({ positions: { [stateKey()]: { [name]: { x: +x.toFixed(4), y: +y.toFixed(4) } } } });
    else placeBlocks();
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  // while arranging, clicks on the blocks only move them (no opening shortcuts, no glass toggle)
  root.addEventListener(
    'click',
    (e) => {
      if (arranging && Object.values(BLOCKS).some((sel) => e.target.closest(`#ntp > ${sel}`))) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );
  root.addEventListener('keydown', (e) => e.key === 'Escape' && arranging && setArranging(false));
}

// The clock, date and greeting glide (and shrink) between the middle and the top-left corner:
// measured before and after the layout changes, then animated from the old place to the new.
function glideHero(change) {
  const el = root.querySelector('.hero');
  const first = el.getBoundingClientRect();
  change();
  const last = el.getBoundingClientRect();
  if (!first.width || !last.width) return;
  el.animate(
    [
      { transformOrigin: 'top left', transform: `translate(${first.left - last.left}px, ${first.top - last.top}px) scale(${first.width / last.width})` },
      { transformOrigin: 'top left', transform: 'none' },
    ],
    { duration: 1000, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
  );
}

// (the wallpaper's own music: on / off)
function musicButton() {
  if (!root) return;
  const b = root.querySelector('.music-btn');
  const m = ownMusic(S.settings.wallpaper);
  b.hidden = !m;
  if (!m) return;
  const on = !!S.settings.wallpaper.musicOn;
  b.classList.toggle('on', on && musicPlaying());
  b.innerHTML = icon(on ? 'music' : 'muted', 16);
  b.title = on ? t('Tắt nhạc nền: {0}', m.kind === 'files' ? t('{0} bài', (m.files || []).length) : m.title || '') : t('Bật nhạc nền');
}

// ---------- anime of the day (from TyranWeb: AniList, one 2000–2010 anime a day) ----------
let animeKey = '';
let animeHidden = false;
async function anime() {
  const box = root.querySelector('#anime');
  const key = `${n().showAnime}|${n().animeGenre}|${new Date().toDateString()}`;
  if (key === animeKey) return;
  animeKey = key;
  if (!n().showAnime || animeHidden) return (box.hidden = true);
  try {
    const a = await invoke('anime_today', { genre: n().animeGenre || 'Slice of Life' });
    const meta = [a.year, a.studio, a.episodes ? t('{0} tập', a.episodes) : '', a.score ? `★ ${(a.score / 10).toFixed(1)}` : ''].filter(Boolean).join(' · ');
    box.innerHTML = `<img class="an-cover" src="${esc(a.cover)}" alt=""><div class="an-body"><span class="an-label">${esc(t('Anime hôm nay ·'))} ${esc(a.year || '')}</span><span class="an-title" title="${esc(a.native || '')}">${esc(a.title)}</span><span class="an-meta">${esc(meta)}</span><span class="an-genres">${(a.genres || []).slice(0, 4).map((g) => `<span>${esc(g)}</span>`).join('')}</span><span class="an-desc">${esc(a.description)}</span></div><button class="icon-btn an-close" title="${esc(t('Ẩn'))}">${icon('x', 14)}</button>`;
    const open = (e) => (e.ctrlKey ? createTab({ url: a.url, background: true }) : go(a.url));
    box.querySelector('.an-title').onclick = open;
    box.querySelector('.an-cover').onclick = open;
    box.querySelector('.an-close').onclick = () => {
      animeHidden = true;
      box.hidden = true;
    };
    box.hidden = false;
  } catch {
    box.hidden = true;
    animeKey = '';
  }
}

/** Shows or hides the page (view.js, whenever the active tab changes or moves). */
export function showNtp(v) {
  if (!root) build();
  if (v === shown) return;
  shown = v;
  root.hidden = !v;
  clearInterval(clockTimer);
  if (v) {
    apply();
    // its parts rise in, one after the other
    root.classList.remove('enter');
    void root.offsetWidth;
    root.classList.add('enter');
    // (only on opening: a change of settings redraws the shortcuts without them rising in again)
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => root.classList.remove('enter'), 1400);
    clockTimer = setInterval(() => {
      clock();
      if (new Date().getSeconds() === 0) greeting();
    }, 1000);
  } else {
    closeFloating();
    if (arranging) setArranging(false);
  }
}
export const ntpShown = () => shown;

// ---------- shortcuts: add, edit, remove, reorder ----------
function editTile(i, anchor) {
  const list = [...(n().speedDial || [])];
  const d = list[i] || { title: '', url: '' };
  const url = h('input', { type: 'text', value: d.url, placeholder: 'youtube.com' });
  const title = h('input', { type: 'text', value: d.title, placeholder: t('Tên hiển thị') });
  const form = h(
    'form',
    { class: 'popover tile-form' },
    h('h3', { text: i < 0 ? t('Thêm lối tắt') : t('Sửa lối tắt') }),
    h('div', { class: 'field' }, h('label', { text: t('Địa chỉ') }), url),
    h('div', { class: 'field' }, h('label', { text: t('Tên') }), title),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', text: t('Hủy'), onclick: () => close() }), h('button', { type: 'submit', class: 'btn primary', text: t(i < 0 ? 'Thêm' : 'Lưu') }))
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const full = toUrl(url.value, S.settings, S.engines);
    if (!full) return url.focus();
    const item = { title: title.value.trim() || hostOf(full) || full, url: full };
    if (i < 0) list.push(item);
    else list[i] = item;
    setNewtab({ speedDial: list });
    close();
  });
  const r = anchor.getBoundingClientRect();
  const close = float(form, { x: r.left + r.width / 2 - 170, y: r.bottom + 6 });
  invoke('shell_focus');
  setTimeout(() => url.focus(), 30);
}

function removeTile(i, tile) {
  tile.classList.add('leaving');
  setTimeout(() => {
    const list = [...(n().speedDial || [])];
    list.splice(i, 1);
    setNewtab({ speedDial: list });
  }, 180);
}

function dragToReorder(box) {
  box.addEventListener('pointerdown', (e) => {
    const tile = e.target.closest('.tile:not(.add)');
    if (!tile || e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    let over = null;
    const move = (ev) => {
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
      if (!dragging) {
        dragging = true;
        tile.classList.add('dragging');
        box.setPointerCapture(ev.pointerId);
      }
      tile.style.transform = `translate(${ev.clientX - start.x}px, ${ev.clientY - start.y}px) scale(1.06)`;
      const hit = [...box.querySelectorAll('.tile:not(.add)')].find((x) => {
        if (x === tile) return false;
        const r = x.getBoundingClientRect();
        return ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom;
      });
      over?.classList.remove('drop');
      over = hit || null;
      over?.classList.add('drop');
    };
    const up = () => {
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', up);
      if (!dragging) return;
      // (the click that ends a drag opens nothing)
      box.addEventListener('click', (c) => (c.stopPropagation(), c.preventDefault()), { capture: true, once: true });
      tile.classList.remove('dragging');
      tile.style.transform = '';
      if (over) {
        const list = [...n().speedDial];
        const [it] = list.splice(+tile.dataset.i, 1);
        list.splice(+over.dataset.i, 0, it);
        setNewtab({ speedDial: list });
      }
      over?.classList.remove('drop');
    };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', up);
  });
}

function customize(anchor) {
  const s = n();
  const flip = (k) => () => setNewtab({ [k]: !s[k] });
  menu(
    [
      { head: t('Trang Tab mới') },
      { label: t('Đồng hồ'), checked: s.showClock, run: flip('showClock') },
      { label: t('Ngày tháng'), checked: s.showDate !== false, run: () => setNewtab({ showDate: s.showDate === false }) },
      { label: t('Lời chào'), checked: s.showGreeting, run: flip('showGreeting') },
      { label: t('Ô tìm kiếm'), checked: s.showSearch, run: flip('showSearch') },
      { label: t('Lối tắt'), checked: s.showSpeedDial, run: flip('showSpeedDial') },
      { label: t('Anime hôm nay'), checked: !!s.showAnime, run: flip('showAnime') },
      { label: t('Phổ nhạc dưới hình nền'), checked: !!s.visualizer, run: flip('visualizer') },
      'sep',
      { label: t('Ẩn thanh tìm kiếm và lối tắt'), checked: !!s.hideTools, run: flip('hideTools') },
      { label: t('Nền kính sau đồng hồ'), checked: s.heroGlass !== false, run: () => setNewtab({ heroGlass: s.heroGlass === false }) },
      { label: t('Cả khi không ẩn thanh tìm kiếm'), checked: !!s.heroGlassMid, run: flip('heroGlassMid') },
      { label: t('Sắp xếp các khối…'), icon: 'layout', run: () => setArranging(true) },
      { label: t('Đưa các khối về chỗ cũ'), icon: 'reload', run: () => setNewtab({ positions: { shown: null, hidden: null } }) },
      'sep',
      { label: t('Tìm ảnh nền…'), icon: 'image', run: () => createTab({ url: 'unk://store/#images' }) },
      { label: t('Kho video nền…'), icon: 'video', run: () => createTab({ url: 'unk://store/#videos' }) },
      { label: t('Đổi hình nền nhanh'), icon: 'shuffle', keys: 'Ctrl+Shift+W', run: () => import('./extras.js').then((m) => m.nextWallpaper()) },
      'sep',
      { label: t('Tùy chỉnh thêm…'), icon: 'sliders', run: () => createTab({ url: 'unk://settings/#newtab' }) },
    ],
    { anchor, align: 'end' }
  );
}

export function initNtp() {
  build();
  on('settings', () => shown && apply());
  // (the page reads its tab's state only through view.js)
  void T;
}
