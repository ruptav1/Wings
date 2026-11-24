// Lịch sử: the pages visited, the windows closed (each with its tabs: reopened whole, or a tab of it),
// and the files Kiểm tra tệp tải về scanned (from TyranWeb: Đã quét).
import { invoke, listen, esc, favicon, hostOf, debounce } from '../../shared/api.js';
import { icon } from '../../shared/icons.js';
import { initPage, openTab } from '../../shared/page.js';
import { t, LOCALE } from '../../shared/i18n.js';

const $ = (s) => document.querySelector(s);
const PAGE = 300;
const MODES = ['pages', 'groups', 'scans'];
const PLACEHOLDER = { pages: 'Tìm trong lịch sử', groups: 'Tìm trong cửa sổ đã đóng', scans: 'Tìm trong tệp đã quét' };
let mode = MODES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'pages';
let items = [];
let done = false;

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return t('Hôm nay');
  if (d.toDateString() === y.toDateString()) return t('Hôm qua');
  return d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
const time = (ts) => new Date(ts).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
const fav = (url, given) => `<img class="fav" src="${esc(favicon(url, given))}" alt="" onerror="this.style.visibility='hidden'">`;

// ---------- the pages visited ----------
function drawPages() {
  let html = '';
  let day = '';
  for (const v of items) {
    const label = dayLabel(v.time ?? v.ts);
    if (label !== day) {
      if (day) html += '</div>';
      html += `<div class="day">${esc(label)}</div><div class="card">`;
      day = label;
    }
    html += `<div class="list-row" data-url="${esc(v.url)}"><span class="time">${time(v.time ?? v.ts)}</span>${fav(v.url)}<div class="col"><span class="t"><a href="${esc(v.url)}">${esc(v.title || v.url)}</a></span><span class="sub">${esc(hostOf(v.url))}</span></div><div class="acts"><button class="icon-btn" data-a="new" title="${esc(t('Mở trong tab mới'))}">${icon('external', 15)}</button><button class="icon-btn" data-a="del" title="${esc(t('Xóa khỏi lịch sử'))}">${icon('trash', 15)}</button></div></div>`;
  }
  if (day) html += '</div>';
  $('#list').innerHTML = html || `<div class="empty">${esc(t('Không có gì trong lịch sử'))}</div>`;
  $('#more').hidden = done || !items.length;
}

async function loadPages(reset) {
  const text = $('#q').value;
  const before = reset || !items.length ? undefined : items[items.length - 1].time ?? items[items.length - 1].ts;
  const got = await invoke('history_query', { text, before, limit: PAGE });
  items = reset ? got : items.concat(got);
  done = got.length < PAGE;
  drawPages();
}

// ---------- windows closed while others stayed open: their tabs ----------
let groups = [];
async function loadGroups() {
  groups = await invoke('winhistory_list').catch(() => []);
  const q = $('#q').value.trim().toLowerCase();
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
  $('#more').hidden = true;
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
  const list = await invoke('scanhistory_list', { text: $('#q').value.trim() }).catch(() => []);
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
  $('#list').innerHTML = html || `<div class="empty">${esc($('#q').value ? t('Không tìm thấy gì') : t('Chưa quét tệp nào'))}</div>`;
  $('#more').hidden = true;
}

function load(reset) {
  if (mode === 'groups') return loadGroups();
  if (mode === 'scans') return loadScans();
  return loadPages(reset);
}

function showMode() {
  document.querySelectorAll('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('#q').placeholder = t(PLACEHOLDER[mode]);
  $('#clear').hidden = mode !== 'pages';
  $('#clear-list').hidden = mode === 'pages';
}

async function main() {
  await initPage();
  showMode();
  document.querySelectorAll('#mode button').forEach((b) =>
    b.addEventListener('click', () => {
      if (mode === b.dataset.mode) return;
      mode = b.dataset.mode;
      history.replaceState(null, '', mode === 'pages' ? '#' : '#' + mode);
      showMode();
      load(true);
    })
  );
  $('#q').addEventListener('input', debounce(() => load(true), 200));
  $('#more button').addEventListener('click', () => load(false));
  $('#clear').addEventListener('click', () => openTab('unk://settings/#privacy'));
  $('#clear-list').addEventListener('click', async () => {
    await invoke(mode === 'groups' ? 'winhistory_clear' : 'scanhistory_clear');
    load(true);
  });
  $('#list').addEventListener('click', async (e) => {
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
    if (!row) return;
    if (mode !== 'pages') return openTab(row.dataset.url, e.ctrlKey);
    if (a === 'new') openTab(row.dataset.url, true);
    if (a === 'del') {
      await invoke('history_delete', { url: row.dataset.url });
      items = items.filter((v) => v.url !== row.dataset.url);
      drawPages();
    }
  });
  listen('scanhistory-changed', debounce(() => mode === 'scans' && loadScans(), 300));
  load(true);
}
main();
