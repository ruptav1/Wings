// Lịch sử: the pages visited, the windows closed (each with its tabs: reopened whole, or a tab of it),
// the files Kiểm tra tệp tải về scanned (from TyranWeb: Đã quét), and the pages InPrivate windows
// visited (Ẩn danh: kept encrypted when switched on in Settings → Ẩn danh, PrivHistory.sys.mjs; asks
// for the PIN when one is set).
// Trang đã xem and Ẩn danh: the words typed (with or without marks, "site:" a site), a time span, by
// time or per site, each with its order, one site picked; the matching ones deleted together (the
// core's store.rs find_in / domains_in; HistQuery.sys.mjs for Ẩn danh).
import { invoke, listen, esc, favicon, hostOf, debounce } from '../../shared/api.js';
import { icon } from '../../shared/icons.js';
import { P, initPage, openTab, onSettings } from '../../shared/page.js';
import { t, LOCALE } from '../../shared/i18n.js';

const $ = (s) => document.querySelector(s);
const MODES = ['pages', 'groups', 'scans', 'private'];
const PLACEHOLDER = { pages: 'Tìm trong lịch sử', groups: 'Tìm trong cửa sổ đã đóng', scans: 'Tìm trong tệp đã quét', private: 'Tìm trong lịch sử ẩn danh' };
let mode = MODES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'pages';
const isPages = () => mode === 'pages' || mode === 'private';
let text = '';
let offset = 0;
let done = false;
let loading = false;
let gen = 0; // (each new listing: answers for an older one are dropped)
let total = 0;
let site = '';
let quietUntil = 0; // (a row deleted here: the list is not made again for it)

const SRC = {
  pages: { find: (f) => invoke('history_find', f), domains: (f) => invoke('history_domains', f), removeWhere: (f) => invoke('history_remove_where', f), remove: (ids) => invoke('history_remove_ids', { ids }) },
  private: { find: (f) => invoke('privhist_find', f), domains: (f) => invoke('privhist_domains', f), removeWhere: (f) => invoke('privhist_remove_where', f), remove: (ids) => invoke('privhist_remove', { ids }) },
};
const src = () => SRC[mode];
const SORTS = {
  time: [['new', 'Mới nhất trước'], ['old', 'Cũ nhất trước'], ['most', 'Mở nhiều nhất'], ['az', 'Tên A → Z'], ['za', 'Tên Z → A']],
  sites: [['most', 'Truy cập nhiều nhất'], ['least', 'Truy cập ít nhất'], ['recent', 'Mở gần đây nhất'], ['az', 'Tên miền A → Z'], ['za', 'Tên miền Z → A']],
};
const tools = { span: 'all', view: 'time', sort: { time: 'new', sites: 'most' }, from: '', to: '' };
try {
  const saved = JSON.parse(localStorage.getItem('history.tools') || 'null');
  if (saved && typeof saved === 'object') Object.assign(tools, saved, { sort: { ...tools.sort, ...saved.sort } });
} catch {}
const keepTools = () => {
  try {
    localStorage.setItem('history.tools', JSON.stringify(tools));
  } catch {}
};

function range() {
  const now = new Date();
  const day = (d) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + d).getTime();
  const date = (s, d = 0) => {
    const [y, m, dd] = String(s).split('-').map(Number);
    return y ? new Date(y, m - 1, dd + d).getTime() : 0;
  };
  switch (tools.span) {
    case 'hour':
      return { since: Date.now() - 3600000 };
    case 'today':
      return { since: day(0) };
    case 'yesterday':
      return { since: day(-1), until: day(0) };
    case 'week':
      return { since: Date.now() - 7 * 86400000 };
    case 'month':
      return { since: Date.now() - 30 * 86400000 };
    case 'thismonth':
      return { since: new Date(now.getFullYear(), now.getMonth(), 1).getTime() };
    case 'custom':
      return { since: date(tools.from), until: date(tools.to, 1) };
    default:
      return {};
  }
}
const filter = (extra = {}) => ({ text, host: site, ...range(), ...extra });
const narrowed = () => !!(text || site || (tools.span !== 'all' && (tools.span !== 'custom' || tools.from || tools.to)));

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return t('Hôm nay');
  if (d.toDateString() === y.toDateString()) return t('Hôm qua');
  return d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
const time = (ts) => new Date(ts).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
const shortDate = (ts) => new Date(ts).toLocaleDateString(LOCALE, { day: 'numeric', month: 'numeric', year: '2-digit' });
const whenText = (ts) => (new Date(ts).toDateString() === new Date().toDateString() ? t('{0} hôm nay', time(ts)) : shortDate(ts));
const fav = (url, given) => `<img class="fav" src="${esc(favicon(url, given))}" alt="" onerror="this.style.visibility='hidden'">`;
const num = (n) => Number(n || 0).toLocaleString(LOCALE);

// Two presses to delete: the first turns the button red for 3 seconds.
function twice(btn, run, label) {
  if (btn.dataset.armed) {
    delete btn.dataset.armed;
    clearTimeout(btn._armed);
    btn.classList.remove('armed');
    btn.title = btn._title;
    return run();
  }
  btn.dataset.armed = '1';
  btn._title = btn.title;
  btn.title = label || t('Bấm lần nữa để xóa');
  btn.classList.add('armed');
  btn._armed = setTimeout(() => {
    delete btn.dataset.armed;
    btn.classList.remove('armed');
    btn.title = btn._title;
  }, 3000);
}

// A page visited: its time (its date when not listed by day), icon, title (a link to it), how many
// times (the pages opened most), site; open it in a new tab, keep to its site, delete it (every visit
// of it, when counted together).
function visitRow(v, { dated = false, inSite = false } = {}) {
  const row = document.createElement('div');
  row.className = 'list-row';
  row.title = v.url;
  row.innerHTML = `<span class="time${dated ? ' dated' : ''}">${dated ? shortDate(v.time) : time(v.time)}</span>${fav(v.url, v.favicon)}<div class="col"><span class="t"><a href="${esc(v.url)}">${esc(v.title || v.url)}</a>${v.visits > 1 ? `<span class="visits">${esc(t('{0} lần', num(v.visits)))}</span>` : ''}</span><span class="sub">${esc(hostOf(v.url))}</span></div><div class="acts">${site || inSite ? '' : `<button class="icon-btn" data-a="site" title="${esc(t('Chỉ xem trang web này'))}">${icon('target', 15)}</button>`}<button class="icon-btn" data-a="new" title="${esc(t('Mở trong tab mới'))}">${icon('external', 15)}</button><button class="icon-btn" data-a="del" title="${esc(t('Xóa khỏi lịch sử'))}">${icon('trash', 15)}</button></div>`;
  row.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'del') {
      e.preventDefault();
      quietUntil = Date.now() + 1500;
      const n = v.visits > 1 ? await src().removeWhere(filter({ url: v.url })) : await src().remove([v.id]);
      row.remove();
      total = Math.max(0, total - (Number(n) || 1));
      showCount();
    } else if (a === 'site') pickSite(hostOf(v.url));
    else if (a === 'new') openTab(v.url, true);
    else if (!e.target.closest('a')) row.querySelector('a')?.click();
  });
  return row;
}

function empty(words) {
  $('#list').innerHTML = `<div class="empty">${esc(words)}</div>`;
}
const emptyText = () => (narrowed() ? t('Không tìm thấy gì') : mode === 'private' ? t('Chưa có lịch sử ẩn danh') : t('Không có gì trong lịch sử'));

async function loadPages(reset) {
  if (reset) {
    gen++;
    loading = false;
  }
  if (loading || (done && !reset)) return;
  const my = gen;
  if (mode === 'private' && reset && !(await privateOpen(my))) return;
  if (tools.view === 'sites') return reset && loadSites(my);
  loading = true;
  if (reset) {
    offset = 0;
    done = false;
  }
  const sort = tools.sort.time;
  const res = await src()
    .find(filter({ sort, limit: 150, offset }))
    .catch(() => null);
  if (my !== gen) return;
  loading = false;
  if (!res) return mode === 'private' && loadPages(true); // (locked meanwhile)
  const list = $('#list');
  if (reset) list.innerHTML = '';
  offset += res.rows.length;
  done = offset >= res.count;
  total = res.total;
  showCount();
  const byDay = sort === 'new' || sort === 'old';
  let card = list.lastElementChild?.classList.contains('card') ? list.lastElementChild : null;
  let day = card?.dataset.day || '';
  for (const v of res.rows) {
    const label = byDay ? dayLabel(v.time) : '';
    if (!card || label !== day) {
      if (byDay) list.append(Object.assign(document.createElement('div'), { className: 'day', textContent: label }));
      card = document.createElement('div');
      card.className = 'card';
      card.dataset.day = label;
      list.append(card);
      day = label;
    }
    card.append(visitRow(v, { dated: !byDay }));
  }
  if (!list.children.length) empty(emptyText());
  $('#more').textContent = done ? '' : t('Cuộn xuống để xem thêm');
}

// ---- Theo trang web: each site of the pages matching, with how many visits and the latest; pressed,
// its pages show, with a search of its own; kept to (the list by time, that site only); deleted
async function loadSites(my) {
  const res = await src()
    .domains(filter({ sort: tools.sort.sites, limit: 1500 }))
    .catch(() => null);
  if (my !== gen) return;
  if (!res) return mode === 'private' && loadPages(true);
  total = res.total;
  showCount(res.count);
  const list = $('#list');
  list.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'card';
  for (const d of res.rows) card.append(...siteRow(d));
  if (res.rows.length) list.append(card);
  else empty(emptyText());
  $('#more').textContent = res.count > res.rows.length ? t('Còn {0} trang web nữa: tìm hoặc chọn khoảng thời gian để thu hẹp', num(res.count - res.rows.length)) : '';
}

function siteRow(d) {
  const row = document.createElement('div');
  row.className = 'list-row site-row';
  row.title = d.host;
  row.innerHTML = `<span class="chev">${icon('chevronRight', 14)}</span>${fav('https://' + d.host + '/', d.favicon)}<div class="col"><span class="t">${esc(d.host)}</span><span class="sub">${esc(t('gần nhất {0}', whenText(d.last)))}</span></div><span class="site-count" title="${esc(t('{0} lần truy cập', num(d.visits)))}">${num(d.visits)}</span><div class="acts"><button class="icon-btn" data-a="site" title="${esc(t('Chỉ xem trang web này'))}">${icon('target', 15)}</button><button class="icon-btn" data-a="del" title="${esc(t('Xóa {0} mục của {1}', num(d.visits), d.host))}">${icon('trash', 15)}</button></div>`;
  const inside = document.createElement('div');
  inside.className = 'site-inside';
  inside.hidden = true;
  row.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-a]');
    if (btn?.dataset.a === 'site') return pickSite(d.host);
    if (btn?.dataset.a === 'del') {
      return twice(btn, async () => {
        await src().removeWhere(filter({ host: d.host, exact: true }));
        loadPages(true);
      });
    }
    if (inside.hidden && !inside.children.length) fillSite(inside, d);
    inside.hidden = !inside.hidden;
    row.classList.toggle('open', !inside.hidden);
    if (!inside.hidden) inside.querySelector('input')?.focus();
  });
  return [row, inside];
}

function fillSite(inside, d) {
  const q = Object.assign(document.createElement('input'), { type: 'search', className: 'site-q', placeholder: t('Tìm trong {0}…', d.host) });
  const rows = document.createElement('div');
  const more = Object.assign(document.createElement('button'), { className: 'btn', textContent: t('Xem thêm'), hidden: true });
  let off = 0;
  let mine = 0;
  const go = async (reset) => {
    const my = reset ? ++mine : mine;
    if (reset) off = 0;
    const words = [text, q.value.trim()].filter(Boolean).join(' ');
    const r = await src()
      .find(filter({ host: d.host, exact: true, text: words, sort: 'new', limit: 50, offset: off }))
      .catch(() => null);
    if (my !== mine || !r) return;
    if (reset) rows.innerHTML = '';
    off += r.rows.length;
    for (const v of r.rows) rows.append(visitRow(v, { dated: true, inSite: true }));
    if (!rows.children.length) rows.innerHTML = `<div class="empty">${esc(t('Không tìm thấy gì'))}</div>`;
    more.hidden = off >= r.count;
  };
  q.addEventListener('input', debounce(() => go(true), 150));
  q.addEventListener('click', (e) => e.stopPropagation());
  more.addEventListener('click', () => go(false));
  inside.append(q, rows, more);
  go(true);
}

function pickSite(host) {
  site = host || '';
  if (site && tools.view === 'sites') tools.view = 'time';
  showTools();
  loadPages(true);
}

// How many there are, and what the delete button deletes: every visit, or those matching.
function showCount(sites) {
  $('#count').textContent = tools.view === 'sites' && sites !== undefined ? t('{0} trang web · {1} mục', num(sites), num(total)) : t('{0} mục', num(total));
  const btn = $('#del');
  if (!isPages() || btn.dataset.armed) return;
  btn.textContent = !narrowed() ? t('Xóa lịch sử') : text ? t('Xóa {0} mục có “{1}”', num(total), text) : t('Xóa {0} mục đã lọc', num(total));
  btn.disabled = narrowed() && !total;
}

function showTools() {
  const pages = isPages();
  $('#tools').hidden = !pages;
  $('#del').hidden = !pages;
  $('#clear').hidden = mode !== 'pages';
  $('#clear-list').hidden = pages;
  $('#span').value = tools.span;
  $('#custom').hidden = tools.span !== 'custom';
  $('#from').value = tools.from;
  $('#to').value = tools.to;
  document.querySelectorAll('#view button').forEach((b) => b.classList.toggle('on', b.dataset.view === tools.view));
  const sel = $('#sort');
  sel.innerHTML = SORTS[tools.view].map(([v, label]) => `<option value="${v}">${esc(t(label))}</option>`).join('');
  sel.value = tools.sort[tools.view];
  const chip = $('#site-chip');
  chip.hidden = !site;
  chip.innerHTML = site ? `${icon('globe', 13)}<span>${esc(site)}</span><button class="icon-btn" title="${esc(t('Bỏ lọc trang web'))}">${icon('x', 13)}</button>` : '';
}

// ---- Ẩn danh: opened with the PIN (or at once without one); locked again by the Khóa button, when
// the page is hidden, or by itself after a while
let priv = null;
async function privateOpen(my) {
  priv = await invoke('privhist_status').catch(() => null);
  if (my !== gen) return false;
  document.body.classList.remove('locked');
  $('#lock').hidden = !(priv?.open && priv.pin);
  if (!priv) return false;
  if (priv.broken) return lockScreen('broken'), false;
  if (!priv.recording && !priv.kept) return lockScreen('off'), false;
  if (priv.open) return true;
  if (!priv.pin) {
    const r = await invoke('privhist_unlock', { pin: null }).catch(() => null);
    if (my !== gen) return false;
    if (r?.ok) return true;
  }
  lockScreen('pin');
  return false;
}

function lockScreen(kind) {
  document.body.classList.add('locked');
  $('#more').textContent = '';
  $('#lock').hidden = true;
  const list = $('#list');
  if (kind !== 'pin') {
    list.innerHTML = `<div class="lock-box"><div class="lock-ico">${icon(kind === 'broken' ? 'warn' : 'incognito', 26)}</div><b>${esc(kind === 'broken' ? t('Không mở được lịch sử ẩn danh') : t('Lịch sử ẩn danh đang tắt'))}</b><small>${esc(kind === 'broken' ? t('Tệp được tạo trên máy tính hoặc tài khoản Windows khác. Có thể xóa nó trong Cài đặt → Ẩn danh.') : t('Bật trong Cài đặt → Ẩn danh để lưu các trang mở trong cửa sổ InPrivate.'))}</small><button class="btn" data-a="settings">${esc(t('Mở cài đặt'))}</button></div>`;
    list.querySelector('[data-a="settings"]').onclick = () => openTab('unk://settings/#incognito');
    return;
  }
  const n = priv.pin;
  list.innerHTML = `<div class="lock-box"><div class="lock-ico">${icon('lock', 26)}</div><b>${esc(t('Lịch sử ẩn danh đã khóa'))}</b><small>${esc(t('Nhập mật khẩu {0} số để xem', n))}</small><input class="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="${n}" aria-label="${esc(t('Mật khẩu'))}"><span class="lock-err"></span></div>`;
  const box = list.querySelector('.lock-box');
  const input = box.querySelector('.pin');
  const err = box.querySelector('.lock-err');
  let tick = null;
  const waitFor = (ms) => {
    clearInterval(tick);
    input.disabled = true;
    const end = Date.now() + ms;
    const show = () => {
      const s = Math.ceil((end - Date.now()) / 1000);
      if (s <= 0) {
        clearInterval(tick);
        input.disabled = false;
        err.textContent = '';
        return input.focus();
      }
      err.textContent = t('Sai quá nhiều lần. Thử lại sau {0} giây', s);
    };
    show();
    tick = setInterval(show, 500);
  };
  input.addEventListener('input', async () => {
    input.value = input.value.replace(/\D/g, '').slice(0, n);
    if (input.value.length < n) return;
    const pin = input.value;
    input.disabled = true;
    const r = await invoke('privhist_unlock', { pin }).catch(() => ({ ok: false }));
    input.value = '';
    if (r.ok) {
      clearInterval(tick);
      document.body.classList.remove('locked');
      showTools();
      return loadPages(true);
    }
    input.disabled = false;
    box.classList.remove('shake');
    void box.offsetWidth;
    box.classList.add('shake');
    if (r.wait > 0) return waitFor(r.wait);
    err.textContent = r.left ? t('Sai mật khẩu, còn {0} lần thử', r.left) : t('Sai mật khẩu');
    input.focus();
  });
  if (priv.wait > 0) waitFor(priv.wait);
  else setTimeout(() => input.focus(), 0);
}

function lockPrivate() {
  if (mode !== 'private' || !priv?.pin) return;
  invoke('privhist_lock').catch(() => {});
  priv.open = false;
}

// ---------- windows closed while others stayed open: their tabs ----------
let groups = [];
async function loadGroups() {
  groups = await invoke('winhistory_list').catch(() => []);
  const q = text.toLowerCase();
  let html = '';
  let day = '';
  groups.forEach((g, gi) => {
    const tabs = q ? g.tabs.filter((x) => `${x.title} ${x.url}`.toLowerCase().includes(q)) : g.tabs;
    if (!tabs.length) return;
    const label = dayLabel(g.closedAt);
    if (label !== day) {
      if (day) html += '</div>';
      html += `<div class="day">${esc(label)}</div><div class="card">`;
      day = label;
    }
    const hosts = [...new Set(g.tabs.map((x) => hostOf(x.url)).filter(Boolean))].slice(0, 4).join(' · ');
    const main = g.tabs[g.active] || g.tabs[0];
    html += `<div class="list-row group-row" data-g="${gi}" title="${esc(g.tabs.map((x) => x.title || x.url).join('\n'))}"><span class="time">${time(g.closedAt)}</span><span class="group-icons">${g.tabs.slice(0, 8).map((x) => fav(x.url, x.favicon)).join('')}</span><div class="col"><span class="t">${esc(t('{0} tab', g.tabs.length))} · ${esc(main.title || main.url)}</span><span class="sub">${esc(hosts)}</span></div><div class="acts"><button class="btn" data-a="reopen">${icon('window', 14)} ${esc(t('Mở lại cửa sổ'))}</button></div></div><div class="group-tabs" data-gt="${gi}" hidden>${tabs.map((x) => `<div class="list-row" data-url="${esc(x.url)}">${fav(x.url, x.favicon)}<div class="col"><span class="t">${esc(x.title || x.url)}</span><span class="sub">${esc(hostOf(x.url))}</span></div></div>`).join('')}</div>`;
  });
  if (day) html += '</div>';
  $('#list').innerHTML = html || `<div class="empty">${esc(q ? t('Không tìm thấy gì') : t('Chưa có cửa sổ nào được đóng'))}</div>`;
  $('#more').textContent = '';
}

// ---------- Đã quét: every file scanned, newest first ----------
const judgedOf = (st) => ['malicious', 'suspicious', 'undetected', 'harmless'].reduce((n, k) => n + (st[k] || 0), 0);
function verdict(x) {
  const s = x.scan || {};
  const st = s.vt?.state === 'done' ? s.vt.stats || {} : {};
  const mal = st.malicious || 0;
  const sus = st.suspicious || 0;
  const judged = judgedOf(st);
  if (s.state === 'threat') return ['bad', t('Có mã độc: {0}', s.threat || '?')];
  if (s.state === 'removed') return ['bad', t('Đã chặn: {0}', s.threat || '?')];
  if (mal >= 3) return ['bad', t('{0}/{1} hãng bảo mật đánh dấu tệp này là độc hại', mal, judged)];
  if (mal) return ['warn', t('{0}/{1} hãng bảo mật đánh dấu tệp này là độc hại', mal, judged)];
  if (sus) return ['warn', t('{0} hãng bảo mật cho rằng tệp này đáng ngờ', sus)];
  if (['queued', 'scanning'].includes(s.state)) return ['', t('Đang kiểm tra…')];
  if (s.state === 'clean') return ['', [t('Không phát hiện mối nguy'), judged ? `VirusTotal 0/${judged}` : ''].filter(Boolean).join(' · ')];
  return ['', t('Không kiểm tra được')];
}

async function loadScans() {
  const list = await invoke('scanhistory_list', { text }).catch(() => []);
  let html = '';
  let day = '';
  for (const x of list) {
    const label = dayLabel(x.at);
    if (label !== day) {
      if (day) html += '</div>';
      html += `<div class="day">${esc(label)}</div><div class="card">`;
      day = label;
    }
    const [lv, words] = verdict(x);
    const inside = x.scan?.inside?.length ? t('Trong file nén: {0}', x.scan.inside.slice(0, 3).map((n) => n.split('/').pop()).join(', ') + (x.scan.insideCount > 3 ? ' …' : '')) : '';
    const ico = /\.(exe|bat|cmd|com|scr|msi)$/i.test(x.path || '') ? `<img class="fav" src="moz-icon:file:///${esc(encodeURI(String(x.path).replace(/\\/g, '/')))}?size=16" alt="">` : icon(lv ? 'warn' : 'shieldCheck', 18);
    html += `<div class="list-row scan-row${lv ? ' lv-' + lv : ''}" data-scan="${esc(String(x.id))}" title="${esc(x.path || x.file || '')}"><span class="time">${time(x.at)}</span><span class="scan-ico">${ico}</span><div class="col"><span class="t">${esc(x.file || '')}</span><span class="sub">${esc([words, inside, hostOf(x.url || '')].filter(Boolean).join(' · '))}</span></div><div class="acts"><button class="icon-btn" data-a="scan-del" title="${esc(t('Xóa khỏi lịch sử'))}">${icon('trash', 15)}</button></div></div>`;
  }
  if (day) html += '</div>';
  $('#list').innerHTML = html || `<div class="empty">${esc(text ? t('Không tìm thấy gì') : t('Chưa quét tệp nào'))}</div>`;
  $('#more').textContent = '';
}

function load(reset) {
  if (mode === 'groups') return loadGroups();
  if (mode === 'scans') return loadScans();
  return loadPages(reset);
}

function showMode() {
  document.querySelectorAll('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('#q').placeholder = t(PLACEHOLDER[mode]);
  document.body.classList.remove('locked');
  $('#lock').hidden = true;
  $('#more').textContent = '';
  showTools();
}

// (the Ẩn danh button: when its history is switched on, or kept from before)
async function showPrivateButton() {
  const st = await invoke('privhist_status').catch(() => null);
  $('#mode [data-mode="private"]').hidden = !(P.settings?.privacy?.privateHistory || st?.kept || st?.broken || mode === 'private');
}

async function main() {
  await initPage();
  showMode();
  showPrivateButton();
  onSettings(showPrivateButton);
  document.querySelectorAll('#mode button').forEach((b) =>
    b.addEventListener('click', () => {
      if (mode === b.dataset.mode) return;
      lockPrivate();
      mode = b.dataset.mode;
      history.replaceState(null, '', mode === 'pages' ? '#' : '#' + mode);
      showMode();
      load(true);
    })
  );
  $('#q').addEventListener('input', debounce(() => {
    text = $('#q').value.trim();
    load(true);
  }, 200));
  $('#span').addEventListener('change', () => {
    tools.span = $('#span').value;
    keepTools();
    showTools();
    loadPages(true);
  });
  for (const id of ['from', 'to']) {
    $('#' + id).addEventListener('change', () => {
      tools[id] = $('#' + id).value;
      keepTools();
      loadPages(true);
    });
  }
  document.querySelectorAll('#view button').forEach((b) =>
    b.addEventListener('click', () => {
      if (tools.view === b.dataset.view) return;
      tools.view = b.dataset.view;
      keepTools();
      showTools();
      loadPages(true);
    })
  );
  $('#sort').addEventListener('change', () => {
    tools.sort[tools.view] = $('#sort').value;
    keepTools();
    loadPages(true);
  });
  $('#site-chip').addEventListener('click', (e) => e.target.closest('button') && pickSite(''));
  $('#lock').addEventListener('click', () => {
    lockPrivate();
    loadPages(true);
  });
  $('#clear').addEventListener('click', () => openTab('unk://settings/#privacy'));
  $('#clear-list').addEventListener('click', async () => {
    await invoke(mode === 'groups' ? 'winhistory_clear' : 'scanhistory_clear');
    load(true);
  });
  // (deletes what is listed: every visit, or those matching the words, the site, the time span)
  $('#del').addEventListener('click', async () => {
    const btn = $('#del');
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn._label = btn.textContent;
      btn.textContent = t('Bấm lần nữa để xóa');
      btn._armed = setTimeout(() => {
        delete btn.dataset.armed;
        btn.textContent = btn._label;
      }, 3000);
      return;
    }
    clearTimeout(btn._armed);
    delete btn.dataset.armed;
    btn.textContent = btn._label;
    await src().removeWhere(filter());
    loadPages(true);
  });
  $('#list').addEventListener('click', async (e) => {
    if (isPages()) return; // (their rows handle their own presses)
    const a = e.target.closest('[data-a]')?.dataset.a;
    const scan = e.target.closest('[data-scan]');
    if (scan) {
      if (a === 'scan-del') {
        await invoke('scanhistory_remove', { id: scan.dataset.scan });
        return loadScans();
      }
      return openTab(`unk://scan/?id=${encodeURIComponent(scan.dataset.scan)}`);
    }
    const g = e.target.closest('[data-g]');
    if (g) {
      if (a === 'reopen') {
        await invoke('winhistory_open', { index: +g.dataset.g });
        return setTimeout(loadGroups, 300);
      }
      const inside = document.querySelector(`[data-gt="${g.dataset.g}"]`);
      if (inside) inside.hidden = !inside.hidden;
      return;
    }
    const row = e.target.closest('.list-row[data-url]');
    if (row) openTab(row.dataset.url, e.ctrlKey);
  });
  window.addEventListener('scroll', () => {
    if (!isPages() || tools.view === 'sites') return;
    if (window.innerHeight + window.scrollY > document.body.scrollHeight - 400) loadPages(false);
  });
  // (Ẩn danh locks when the page is hidden: back, it asks for the PIN again)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) lockPrivate();
    else if (mode === 'private' && priv?.pin && !priv.open) loadPages(true);
  });
  window.addEventListener('unk-privhist-locked', () => mode === 'private' && loadPages(true));
  listen('privhist-changed', debounce(() => mode === 'private' && !document.body.classList.contains('locked') && Date.now() > quietUntil && loadPages(true), 400));
  listen('history-changed', () => mode === 'pages' && Date.now() > quietUntil && loadPages(true));
  listen('history-cleared', () => mode === 'pages' && loadPages(true));
  listen('scanhistory-changed', debounce(() => mode === 'scans' && loadScans(), 300));
  load(true);
}
main();
