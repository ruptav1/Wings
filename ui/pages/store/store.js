// Kho hình nền: video wallpapers from several sites in one search (sources.js: their pages are read
// here, fetched by the browser), pictures from Wallhaven, and the wallpapers already downloaded.
// Everything picked is downloaded into the profile's wallpapers (walls.rs) with what is known of it.
import { invoke, listen, h, esc, fmtBytes } from '../../shared/api.js';
import { icon } from '../../shared/icons.js';
import { t, LOCALE } from '../../shared/i18n.js';
import { P, initPage, onSettings, setSettings, openTab } from '../../shared/page.js';
import { SOURCES, sourceOf, readList, readItem, isAi } from './sources.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = { q: '', page: 0, items: [], seen: new Set(), hiddenAi: 0, busy: false, ended: new Set(), failed: new Set(), sites: new Set(SOURCES.map((s) => s.id)), minRes: 0 };
const pics = { q: '', page: 0, last: 1, items: [], busy: false, started: false, total: 0 };
const mine = { list: [], byPage: new Map(), kind: 'all' };
const jobs = new Map(); // a download's id → { got, total }
let tab = 'videos';

// ---------------------------------------------------------------- formats
const resName = (w, hgt) => {
  const m = Math.min(w, hgt) || hgt;
  return m >= 4320 ? '8K' : m >= 2160 ? '4K' : m >= 1440 ? '2K' : m >= 1080 ? '1080p' : m >= 720 ? '720p' : '';
};
const fmtRes = (w, hgt) => (w && hgt ? `${resName(w, hgt)} · ${w}×${hgt}`.replace(/^ · /, '') : '');
const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
const fmtDate = (d) => {
  const x = new Date(d);
  return d && !isNaN(x) ? x.toLocaleDateString(LOCALE) : '';
};
const size = (n) => (n ? fmtBytes(n) : '');
const best = (it) => (it.files || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0];
const siteName = (id) => sourceOf(id)?.name || id;
const passes = (it) => !state.minRes || !it.height || Math.min(it.width || it.height, it.height) >= state.minRes;
const errText = (e) => String(e?.message || e || '');

/** A picture that fades in once loaded (the card's shimmer shows until then). */
function img(src) {
  const i = h('img', { loading: 'lazy', alt: '', referrerpolicy: 'no-referrer' });
  i.addEventListener('load', () => i.classList.add('ok'));
  i.addEventListener('error', () => i.classList.add('ok'));
  i.src = src || '';
  return i;
}

// ---------------------------------------------------------------- tabs
function showTab(id, { search = true } = {}) {
  tab = id;
  if ($('#detail').open) $('#detail').close();
  for (const b of $$('.store-tabs .tab')) b.classList.toggle('on', b.dataset.tab === id);
  for (const el of $$('[data-for]')) el.hidden = !el.dataset.for.split(' ').includes(id);
  moveInk();
  $('#q').placeholder = id === 'images' ? t('Tìm ảnh nền (tiếng Anh: tên anime, nhân vật, phong cảnh…)') : t('Tìm video nền…');
  if (history.replaceState) history.replaceState(null, '', `#${id}`);
  if (id === 'images' && !pics.started && search) searchPics($('#q').value);
  if (id === 'mine') renderMine();
}
function moveInk() {
  const on = $('.store-tabs .tab.on');
  const ink = $('.store-tabs .tab-ink');
  if (!on || !ink) return;
  ink.style.width = `${on.offsetWidth}px`;
  ink.style.transform = `translateX(${on.offsetLeft}px)`;
}

// ---------------------------------------------------------------- video: the search
function renderSites() {
  const box = $('#sites');
  box.innerHTML = '';
  for (const s of SOURCES) {
    const b = h('button', { type: 'button', class: `chip${state.sites.has(s.id) ? ' on' : ''}${state.failed.has(s.id) ? ' bad' : ''}`, html: `${state.sites.has(s.id) ? icon('check', 13) : ''}<span>${esc(s.name)}</span>` });
    b.addEventListener('click', () => {
      if (state.sites.has(s.id) && state.sites.size > 1) state.sites.delete(s.id);
      else state.sites.add(s.id);
      try {
        localStorage.setItem('store.sites', JSON.stringify([...state.sites]));
      } catch {
        /* (kept for this visit only) */
      }
      renderSites();
      search(state.q);
    });
    box.append(b);
  }
}

function renderStatus() {
  if (tab === 'images') return renderPicStatus();
  const shown = state.items.filter(passes).length;
  const parts = [];
  if (state.busy) parts.push(t('Đang tìm…'));
  else if (state.page) parts.push(t('{0} nền', shown));
  if (state.hiddenAi) parts.push(t('đã ẩn {0} nền gắn nhãn AI', state.hiddenAi));
  const failed = SOURCES.filter((s) => state.failed.has(s.id) && state.sites.has(s.id)).map((s) => s.name);
  if (failed.length) parts.push(t('không đọc được {0}', failed.join(', ')));
  $('#status').textContent = parts.join(' · ');
  $('#more').hidden = state.busy || !state.page || SOURCES.every((s) => !state.sites.has(s.id) || state.ended.has(s.id));
  if (!state.busy && state.page && !shown && !$('#grid .store-empty')) $('#grid').append(h('div', { class: 'store-empty', text: t('Không tìm thấy nền nào') }));
}

async function search(q) {
  Object.assign(state, { q: (q || '').trim(), page: 0, items: [], hiddenAi: 0 });
  state.seen.clear();
  state.ended.clear();
  state.failed.clear();
  reading.length = 0;
  $('#grid').innerHTML = '';
  renderSites();
  await more();
}

async function more() {
  if (state.busy) return;
  state.busy = true;
  renderStatus();
  const p = ++state.page;
  const q = state.q;
  const srcs = SOURCES.filter((s) => state.sites.has(s.id) && !state.ended.has(s.id));
  const lists = await Promise.all(
    srcs.map(async (s) => {
      try {
        const { html, url } = await invoke('store_page', { url: s.list(q, p) });
        const items = readList(s, html, url).filter((i) => !state.seen.has(i.id));
        if (!items.length) state.ended.add(s.id);
        return items;
      } catch {
        state.failed.add(s.id);
        state.ended.add(s.id);
        return [];
      }
    })
  );
  if (q !== state.q) return; // (another search started meanwhile)
  // the sites' results taken in turns, so each shows near the top
  let n = 0;
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const it = l[i];
      if (!it || state.seen.has(it.id)) continue;
      state.seen.add(it.id);
      if (isAi(it)) {
        state.hiddenAi++;
        continue;
      }
      state.items.push(it);
      const el = card(it, n++);
      $('#grid').append(el);
      seen.observe(el);
    }
  }
  state.busy = false;
  renderSites();
  renderStatus();
}

// ---------------------------------------------------------------- video: a card
const byId = (id) => state.items.find((i) => i.id === id);
const jobOf = (it) => [...jobs.entries()].find(([k]) => k.startsWith(it.id + '|'))?.[1];

function card(it, i = 0) {
  const el = h('article', { class: 'wcard', dataset: { id: it.id }, style: { '--i': String(i % 12) } });
  el.innerHTML = `<div class="thumb"></div><div class="meta"><span class="title" title="${esc(it.title)}">${esc(it.title)}</span><span class="facts"></span></div>`;
  el.querySelector('.thumb').append(img(it.thumb));
  fill(el, it);
  let vid = null;
  el.addEventListener('mouseenter', () => {
    if (!it.preview || vid) return;
    vid = h('video', { muted: true, loop: true, autoplay: true, playsinline: true });
    vid.muted = true;
    vid.src = it.preview;
    vid.addEventListener('error', () => vid?.remove());
    el.querySelector('.thumb').append(vid);
  });
  el.addEventListener('mouseleave', () => {
    vid?.remove();
    vid = null;
  });
  el.addEventListener('click', () => openDetail(it));
  return el;
}

function fill(el, it) {
  const f = best(it);
  const facts = [];
  if (it.width) facts.push(`<span class="res">${esc(fmtRes(it.width, it.height))}</span>`);
  if (f?.bytes) facts.push(`<span>${esc(size(f.bytes))}</span>`);
  if (it.date) facts.push(`<span>${esc(fmtDate(it.date))}</span>`);
  facts.push(`<span class="site">${esc(siteName(it.site))}</span>`);
  el.querySelector('.facts').innerHTML = facts.join('');
  el.hidden = !passes(it);
  el.querySelector('.badge')?.remove();
  el.querySelector('.bar')?.remove();
  const job = jobOf(it);
  const have = mine.byPage.get(it.page);
  const thumb = el.querySelector('.thumb');
  if (job) thumb.append(h('span', { class: 'bar', html: `<i style="width:${job.total ? Math.round((job.got / job.total) * 100) : 4}%"></i>` }));
  else if (have) thumb.append(h('span', { class: `badge${using(have) ? ' using' : ''}`, html: `${icon('check', 12)}<span>${esc(using(have) ? t('Đang dùng') : t('Đã tải'))}</span>` }));
}
const refreshCard = (it) => {
  const el = $(`#grid .wcard[data-id="${CSS.escape(it.id)}"]`);
  if (el) fill(el, it);
};

// a card's own page is read once it comes into sight (a few at a time): its size, date, tags...
const reading = [];
let readers = 0;
const seen = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      const it = byId(e.target.dataset.id);
      if (it && !it.read) reading.push(it);
    }
    pump();
  },
  { rootMargin: '400px' }
);
function pump() {
  while (readers < 3 && reading.length) {
    const it = reading.shift();
    readers++;
    readOne(it).finally(() => {
      readers--;
      pump();
    });
  }
}
async function readOne(it) {
  if (it.read) return it;
  it.reading ||= invoke('store_page', { url: it.page })
    .then(({ html, url }) => Object.assign(it, readItem(it, html, url)))
    .catch(() => Object.assign(it, { read: true, failed: true }));
  await it.reading;
  it.reading = null;
  // (its own page says it was made with AI: out of the store)
  if (isAi(it) && state.items.includes(it)) {
    state.items = state.items.filter((x) => x !== it);
    state.hiddenAi++;
    $(`#grid .wcard[data-id="${CSS.escape(it.id)}"]`)?.remove();
    renderStatus();
  } else refreshCard(it);
  return it;
}

// ---------------------------------------------------------------- video: its own view
let open = null;
async function openDetail(it) {
  open = it;
  const d = $('#detail');
  renderDetail(it);
  if (!d.open) d.showModal();
  if (!it.read) {
    await readOne(it);
    if (open === it) renderDetail(it);
  }
}

function renderDetail(it) {
  const d = $('#detail');
  const keepTime = d.querySelector('video')?.currentTime || 0;
  const facts = [`<span class="site">${esc(siteName(it.site))}</span>`];
  if (it.date) facts.push(`<span>${esc(fmtDate(it.date))}</span>`);
  if (it.origin) facts.push(`<span>${esc(t('nguồn: {0}', it.origin))}</span>`);
  const files = it.read ? it.files || [] : null;
  const have = mine.byPage.get(it.page);
  const rows =
    files === null
      ? `<div class="file"><span class="what"><span>${esc(t('Đang đọc trang…'))}</span></span></div>`
      : files.length
        ? files.map((f, i) => fileRow(it, f, i, have)).join('')
        : `<div class="file"><span class="what"><span>${esc(t('Không lấy được file của nền này'))}</span></span></div>`;
  d.innerHTML = `<div class="view">${it.preview ? `<video src="${esc(it.preview)}" poster="${esc(it.thumb)}" autoplay muted loop playsinline></video>` : `<img src="${esc(it.thumb)}" alt="">`}
      <button class="icon-btn close" title="${esc(t('Đóng'))}">${icon('x', 16)}</button></div>
    <div class="body">
      <h2>${esc(it.title)}</h2>
      <div class="facts">${facts.join('')}</div>
      <div class="files">${rows}</div>
      ${it.tags?.length ? `<div class="tags">${it.tags.slice(0, 24).map((x) => `<span>${esc(String(x).replace(/-z$/, '').replace(/-/g, ' '))}</span>`).join('')}</div>` : ''}
      <div class="row-actions"><button class="btn" data-act="page">${icon('external', 15)}<span>${esc(t('Mở trang gốc'))}</span></button></div>
    </div>`;
  const v = d.querySelector('video');
  if (v && keepTime) v.currentTime = keepTime;
  v?.addEventListener('error', () => v.replaceWith(h('img', { src: it.thumb, alt: '' })));
}

function fileRow(it, f, i, have) {
  const job = jobs.get(`${it.id}|${i}`);
  const what = `<b>${esc(f.label || resName(f.width, f.height) || t('Video'))}</b>${f.width ? `<span>${f.width}×${f.height}</span>` : ''}${f.bytes ? `<span>${esc(size(f.bytes))}</span>` : ''}`;
  let act;
  if (job) act = `<span>${esc(job.total ? `${Math.round((job.got / job.total) * 100)}%` : size(job.got))}</span><button class="btn small" data-act="cancel" data-i="${i}">${esc(t('Hủy'))}</button>`;
  else if (have && (!have.width || !f.width || have.width === f.width)) act = using(have) ? `<span class="muted">${icon('check', 14)}</span><span>${esc(t('Đang dùng'))}</span>` : `<button class="btn primary small" data-act="use" data-i="${i}">${icon('check', 14)}<span>${esc(t('Đặt làm hình nền'))}</span></button>`;
  else act = `<button class="btn primary small" data-act="get" data-i="${i}">${icon('download', 14)}<span>${esc(t('Tải về và dùng'))}</span></button>`;
  const bar = job ? `<span class="bar"><i style="width:${job.total ? Math.round((job.got / job.total) * 100) : 4}%"></i></span>` : '';
  return `<div class="file" data-i="${i}"><span class="what">${what}</span>${act}${bar}</div>`;
}

$('#detail').addEventListener('click', (e) => {
  const d = $('#detail');
  if (e.target === d || e.target.closest('.close')) return d.close();
  const b = e.target.closest('[data-act]');
  if (!b || !open) return;
  if (open.kind === 'picture') return picAction(b.dataset.act, open);
  const it = open;
  const f = it.files?.[Number(b.dataset.i)];
  if (b.dataset.act === 'page') openTab(it.page);
  if (b.dataset.act === 'get' && f) download(it, f, Number(b.dataset.i));
  if (b.dataset.act === 'cancel') invoke('store_cancel', { id: `${it.id}|${b.dataset.i}` });
  if (b.dataset.act === 'use') useWall(mine.byPage.get(it.page));
});
$('#detail').addEventListener('close', () => {
  open = null;
  $('#detail').innerHTML = '';
});

async function download(it, f, i) {
  const id = `${it.id}|${i}`;
  jobs.set(id, { got: 0, total: f.bytes || 0 });
  redraw(it);
  try {
    const v = await invoke('store_download', { item: { id, site: it.site, page: it.page, file: f.file, title: it.title, thumb: it.thumb, width: f.width || it.width, height: f.height || it.height, date: it.date, tags: it.tags, origin: it.origin } });
    jobs.delete(id);
    await loadMine();
    useWall(v);
    $('#status').textContent = t('Đã đặt "{0}" làm hình nền', it.title);
  } catch (err) {
    jobs.delete(id);
    const msg = errText(err);
    if (/gone/.test(msg)) $('#status').textContent = t('{0} không còn file của nền này', siteName(it.site));
    else if (!/abort/i.test(msg)) $('#status').textContent = t('Không tải được: {0}', it.title) + ` (${msg})`;
  }
  redraw(it);
}
const redraw = (it) => {
  refreshCard(it);
  if (open === it) renderDetail(it);
};

listen('store-progress', ({ id, got, total }) => {
  if (!jobs.has(id)) return;
  jobs.set(id, { got, total });
  const it = byId(id.slice(0, id.lastIndexOf('|')));
  if (!it) return;
  refreshCard(it);
  if (open === it) {
    const row = $(`#detail .file[data-i="${id.slice(id.lastIndexOf('|') + 1)}"]`);
    const pct = total ? Math.round((got / total) * 100) : 4;
    const bar = row?.querySelector('.bar i');
    if (bar) bar.style.width = pct + '%';
    const lbl = row?.querySelector('[data-act="cancel"]')?.previousElementSibling;
    if (lbl) lbl.textContent = total ? `${pct}%` : size(got);
  }
});

// ---------------------------------------------------------------- pictures: Wallhaven
const CHIPS = ['landscape', 'city night', 'mountains', 'ocean', 'space', 'minimalism', 'cyberpunk', 'Makoto Shinkai', 'Frieren', 'Genshin Impact', 'Blue Archive', 'Lycoris Recoil', 'Violet Evergarden', 'Your Name'];

function renderChips() {
  const box = $('#w-chips');
  box.innerHTML = '';
  for (const c of CHIPS) {
    const b = h('button', { type: 'button', class: `chip${pics.q === c ? ' on' : ''}`, text: c });
    b.addEventListener('click', () => {
      $('#q').value = c;
      searchPics(c);
    });
    box.append(b);
  }
}

function renderPicStatus() {
  const parts = [];
  if (pics.busy) parts.push(t('Đang tìm…'));
  else if (pics.started) parts.push(pics.total ? t('{0} ảnh trên Wallhaven', pics.total.toLocaleString(LOCALE)) : t('Không có kết quả'));
  if ($('#w-preai').checked) parts.push(t('chỉ ảnh tải lên trước 08/2022'));
  $('#status').textContent = parts.join(' · ');
  $('#w-more').hidden = pics.busy || !pics.started || pics.page >= pics.last;
}

async function searchPics(q) {
  Object.assign(pics, { q: (q || '').trim(), page: 0, last: 1, items: [], started: true, total: 0 });
  $('#w-grid').innerHTML = '';
  renderChips();
  await morePics();
}

async function morePics() {
  if (pics.busy) return;
  pics.busy = true;
  renderPicStatus();
  const q = pics.q;
  try {
    const r = await invoke('wall_search', { query: q, page: pics.page + 1, resolution: $('#w-res').value, sorting: $('#w-sort').value, category: $('#w-cat').value, preAi: $('#w-preai').checked });
    if (q !== pics.q) return;
    pics.page = r.page;
    pics.last = r.lastPage;
    pics.total = r.total;
    let n = 0;
    for (const it of r.items) {
      if (pics.items.some((x) => x.id === it.id)) continue;
      it.kind = 'picture';
      pics.items.push(it);
      $('#w-grid').append(picCard(it, n++));
    }
    if (!pics.items.length) $('#w-grid').append(h('div', { class: 'store-empty', text: t('Không có kết quả — thử từ khóa khác (tiếng Anh) hoặc bỏ bớt bộ lọc.') }));
  } catch (e) {
    if (!$('#w-grid .wcard')) $('#w-grid').replaceChildren(h('div', { class: 'store-empty', text: t('Không kết nối được Wallhaven: {0}', errText(e)) }));
  } finally {
    pics.busy = false;
    renderPicStatus();
  }
}

const picHave = (it) => mine.list.find((v) => v.name.startsWith(`wallhaven-${it.id}.`));

function picCard(it, i = 0) {
  const el = h('article', { class: 'wcard', dataset: { pic: it.id }, style: { '--i': String(i % 12) } });
  el.innerHTML = `<div class="thumb"></div><div class="meta"><span class="facts"></span></div>`;
  el.querySelector('.thumb').append(img(it.thumb));
  picFill(el, it);
  el.addEventListener('click', () => openPic(it));
  return el;
}

function picFill(el, it) {
  const facts = [`<span class="res">${esc(fmtRes(it.width, it.height) || it.resolution)}</span>`];
  if (it.size) facts.push(`<span>${esc(size(it.size))}</span>`);
  if (it.favorites) facts.push(`<span>${icon('heart', 11)} ${it.favorites.toLocaleString(LOCALE)}</span>`);
  if (it.uploaded) facts.push(`<span class="site">${esc(it.uploaded.slice(0, 4))}</span>`);
  el.querySelector('.facts').innerHTML = facts.join('');
  el.querySelector('.badge')?.remove();
  const have = picHave(it);
  if (have) el.querySelector('.thumb').append(h('span', { class: `badge${using(have) ? ' using' : ''}`, html: `${icon('check', 12)}<span>${esc(using(have) ? t('Đang dùng') : t('Đã tải'))}</span>` }));
}
const refreshPics = () => {
  for (const el of $$('#w-grid .wcard')) {
    const it = pics.items.find((x) => x.id === el.dataset.pic);
    if (it) picFill(el, it);
  }
};

function openPic(it) {
  open = it;
  const d = $('#detail');
  const have = picHave(it);
  const facts = [`<span class="res">${esc(fmtRes(it.width, it.height))}</span>`];
  if (it.size) facts.push(`<span>${esc(size(it.size))}</span>`);
  if (it.uploaded) facts.push(`<span>${esc(t('tải lên {0}', fmtDate(it.uploaded)))}</span>`);
  if (it.source) facts.push(`<span>${esc(t('nguồn: {0}', hostName(it.source)))}</span>`);
  d.innerHTML = `<div class="view"><img src="${esc(it.large || it.thumb)}" alt=""><button class="icon-btn close" title="${esc(t('Đóng'))}">${icon('x', 16)}</button></div>
    <div class="body">
      <h2>Wallhaven ${esc(it.id)}</h2>
      <div class="facts">${facts.join('')}</div>
      ${it.colors?.length ? `<div class="colors">${it.colors.map((c) => `<i style="background:${esc(c)}" title="${esc(c)}"></i>`).join('')}</div>` : ''}
      <div class="row-actions">
        ${have && using(have) ? `<button class="btn" disabled>${icon('check', 15)}<span>${esc(t('Đang dùng'))}</span></button>` : `<button class="btn primary" data-act="use">${icon('image', 15)}<span>${esc(t(have ? 'Đặt làm hình nền' : 'Tải về và đặt làm hình nền'))}</span></button>`}
        ${have ? '' : `<button class="btn" data-act="get">${icon('download', 15)}<span>${esc(t('Chỉ tải về'))}</span></button>`}
        <button class="btn" data-act="page">${icon('external', 15)}<span>${esc(t('Mở trang Wallhaven'))}</span></button>
      </div>
    </div>`;
  if (!d.open) d.showModal();
}
const hostName = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

async function picAction(act, it) {
  if (act === 'page') return openTab(it.page);
  if (act !== 'use' && act !== 'get') return;
  const have = picHave(it);
  if (have && act === 'use') {
    useWall(have);
    return $('#detail').close();
  }
  const el = $(`#w-grid .wcard[data-pic="${CSS.escape(it.id)}"]`);
  el?.classList.add('busy');
  $('#detail').close();
  $('#status').textContent = t('Đang tải ảnh…');
  try {
    await invoke('wall_get', { id: it.id, apply: act === 'use' });
    await loadMine();
    $('#status').textContent = act === 'use' ? t('Đã đặt làm hình nền') : t('Đã tải về');
  } catch (e) {
    $('#status').textContent = t('Không tải được ảnh này: {0}', errText(e));
  } finally {
    el?.classList.remove('busy');
  }
}

// ---------------------------------------------------------------- downloaded
async function loadMine() {
  mine.list = await invoke('wallpaper_list').catch(() => []);
  mine.byPage = new Map(mine.list.filter((v) => v.page && v.kind === 'video').map((v) => [v.page, v]));
  $('#mine-count').textContent = mine.list.length ? String(mine.list.length) : '';
  if (tab === 'mine') renderMine();
  for (const it of state.items) refreshCard(it);
  refreshPics();
}

const using = (v) => {
  const w = P.settings?.wallpaper;
  const bare = (u) => String(u || '').split('?')[0];
  return !!w && (v.kind === 'video' ? w.type === 'video' && bare(w.video) === v.url : w.type === 'image' && bare(w.image) === v.url);
};
function useWall(v) {
  if (v) setSettings({ wallpaper: v.kind === 'video' ? { type: 'video', video: v.url } : { type: 'image', image: v.url } });
}

function renderMine() {
  const grid = $('#mine-grid');
  grid.innerHTML = '';
  const list = mine.list.filter((v) => mine.kind === 'all' || v.kind === mine.kind);
  if (!list.length) return grid.append(h('div', { class: 'store-empty', text: t('Chưa có hình nền nào') }));
  list.forEach((v, i) => {
    const el = h('article', { class: 'wcard', dataset: { file: v.name }, style: { '--i': String(i % 12) } });
    el.innerHTML = `<div class="thumb"></div>
      <div class="meta"><span class="title" title="${esc(v.title || v.name)}">${esc(v.title || v.name)}</span><span class="facts"></span>
      <span class="row-actions"><button class="btn primary small" data-act="use"></button><button class="btn small ghost" data-act="del" title="${esc(t('Xóa'))}">${icon('trash', 14)}</button></span></div>`;
    const th = el.querySelector('.thumb');
    if (v.thumb) th.append(img(v.thumb));
    else if (v.kind === 'video') th.append(h('video', { src: `${v.url}#t=1`, muted: true, preload: 'metadata' }));
    else th.append(img(v.url));
    if (v.kind === 'video') {
      let hover = null;
      el.addEventListener('mouseenter', () => {
        hover = h('video', { muted: true, loop: true, autoplay: true, playsinline: true });
        hover.muted = true;
        hover.src = v.url;
        th.append(hover);
      });
      el.addEventListener('mouseleave', () => {
        hover?.remove();
        hover = null;
      });
    }
    mineFacts(el, v);
    el.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'del') {
        if (using(v)) await setSettings({ wallpaper: v.kind === 'video' ? { type: 'gradient', video: '' } : { type: 'gradient', image: '' } });
        el.style.transition = 'opacity .2s, transform .2s';
        el.style.opacity = '0';
        el.style.transform = 'scale(.94)';
        await invoke('wallpaper_delete', { name: v.name });
        return loadMine();
      }
      if (act === 'use') useWall(v);
    });
    grid.append(el);
    if (v.kind === 'video' && (!v.width || !v.duration)) probe(v, el);
  });
}

function mineFacts(el, v) {
  const facts = [];
  if (v.width) facts.push(`<span class="res">${esc(fmtRes(v.width, v.height))}</span>`);
  if (v.size) facts.push(`<span>${esc(size(v.size))}</span>`);
  if (v.duration) facts.push(`<span>${esc(fmtDur(v.duration))}</span>`);
  facts.push(`<span class="site">${esc(v.source || (v.kind === 'video' ? t('Video') : t('Ảnh')))}</span>`);
  el.querySelector('.facts').innerHTML = facts.join('');
  const use = el.querySelector('[data-act="use"]');
  use.innerHTML = using(v) ? `${icon('check', 14)}<span>${esc(t('Đang dùng'))}</span>` : `<span>${esc(t('Đặt làm hình nền'))}</span>`;
  use.disabled = using(v);
}

// a video's resolution and length, read from the file itself once (kept with it)
function probe(v, el) {
  const p = document.createElement('video');
  p.preload = 'metadata';
  p.muted = true;
  p.addEventListener('loadedmetadata', async () => {
    const patch = { width: p.videoWidth, height: p.videoHeight, duration: p.duration };
    p.removeAttribute('src');
    p.load();
    Object.assign(v, (await invoke('wallpaper_meta', { name: v.name, patch }).catch(() => null)) || patch);
    mineFacts(el, v);
  });
  p.src = v.url;
}

// ---------------------------------------------------------------- the page
for (const b of $$('.store-tabs .tab')) b.addEventListener('click', () => showTab(b.dataset.tab));
$('#search').addEventListener('submit', (e) => {
  e.preventDefault();
  if (tab === 'images') searchPics($('#q').value);
  else search($('#q').value);
});
$('#more').addEventListener('click', more);
$('#w-more').addEventListener('click', morePics);
$('#res').addEventListener('change', () => {
  state.minRes = Number($('#res').value) || 0;
  for (const it of state.items) refreshCard(it);
  $('#grid .store-empty')?.remove();
  renderStatus();
});
for (const id of ['#w-cat', '#w-res', '#w-sort', '#w-preai']) $(id).addEventListener('change', () => searchPics(pics.q));
for (const b of $$('#mine-kinds .chip'))
  b.addEventListener('click', () => {
    mine.kind = b.dataset.kind;
    $$('#mine-kinds .chip').forEach((x) => x.classList.toggle('on', x === b));
    renderMine();
  });
$('#open-folder').addEventListener('click', async () => {
  const info = await invoke('app_info');
  invoke('file_open', { path: `${info.profile}\\wallpapers` });
});
// (more as the end of the list comes near)
new IntersectionObserver((e) => e[0].isIntersecting && !$('#more').hidden && tab === 'videos' && more(), { rootMargin: '600px' }).observe($('#more'));
new IntersectionObserver((e) => e[0].isIntersecting && !$('#w-more').hidden && tab === 'images' && morePics(), { rootMargin: '600px' }).observe($('#w-more'));
window.addEventListener('resize', moveInk);

(async () => {
  try {
    const kept = JSON.parse(localStorage.getItem('store.sites') || 'null');
    if (Array.isArray(kept) && kept.length) state.sites = new Set(kept.filter((k) => sourceOf(k)));
  } catch {
    /* (all of them) */
  }
  if (!state.sites.size) state.sites = new Set(SOURCES.map((s) => s.id));
  await initPage();
  onSettings(() => {
    if (open && $('#detail').open) open.kind === 'picture' ? openPic(open) : renderDetail(open);
    for (const it of state.items) refreshCard(it);
    refreshPics();
    if (tab === 'mine') for (const el of $$('#mine-grid .wcard')) {
      const v = mine.list.find((x) => x.name === el.dataset.file);
      if (v) mineFacts(el, v);
    }
  });
  listen('wallpapers-changed', loadMine);
  const q = new URLSearchParams(location.search).get('q') || '';
  $('#q').value = q;
  renderChips();
  await loadMine();
  const start = ['images', 'mine'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'videos';
  showTab(start, { search: false });
  requestAnimationFrame(moveInk);
  if (start === 'images') searchPics(q);
  search(q);
})();
