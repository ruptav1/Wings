// Downloads: progress on the toolbar button, a list of recent ones, the actions on each.
import { invoke, listen, h, esc, fmtBytes } from '../shared/api.js';
import { icon } from '../shared/icons.js';
import { S, $, on, emit } from './state.js';
import { popover, toast } from './menus.js';
import { createTab } from './tabs.js';
import { t } from '../shared/i18n.js';
import { scanBadge, scanUrl } from '../shared/scan.js';

const D = new Map(); // id -> latest state (this run)
let popClose = null;
let popList = null;

function updateButton() {
  const b = $('[data-item="downloads"]');
  if (!b) return;
  const going = [...D.values()].filter((d) => d.state === 'progressing');
  let total = 0;
  let got = 0;
  for (const d of going) {
    total += Math.max(0, d.total);
    got += d.received;
  }
  b.querySelector('.count')?.remove();
  b.querySelector('.ring')?.remove();
  if (going.length) {
    const pct = total ? Math.round((got / total) * 100) : 0;
    b.append(h('span', { class: 'ring', style: { background: `conic-gradient(var(--accent) ${pct}%, transparent 0)`, mask: 'radial-gradient(circle, transparent 58%, #000 60%)', WebkitMask: 'radial-gradient(circle, transparent 58%, #000 60%)' } }));
    if (going.length > 1) b.append(h('span', { class: 'count', text: going.length }));
  }
}

/** A comic chapter's row (Tải truyện tranh) counts pictures, not bytes. */
export function pagesStatus(d) {
  const failed = d.failed ? ` · ${t('{0} lỗi', d.failed)}` : '';
  if (d.state === 'completed') return t('{0} ảnh', d.received) + failed;
  if (d.state === 'cancelled') return t('Đã hủy · {0}/{1} ảnh', d.received, d.total);
  if (d.state === 'interrupted') return t('Không tải được ảnh nào');
  return t('{0} / {1} ảnh', d.received, d.total || '?') + failed;
}

export function row(d) {
  const pct = d.total > 0 ? Math.min(100, (d.received / d.total) * 100) : 0;
  const status =
    d.unit === 'pages' ? pagesStatus(d)
    : d.state === 'completed' ? fmtBytes(d.total > 0 ? d.total : d.received)
    : d.state === 'paused' ? t('Tạm dừng · {0} / {1}', fmtBytes(d.received), fmtBytes(d.total))
    : d.state === 'cancelled' ? 'Đã hủy'
    : d.state === 'interrupted' ? 'Lỗi tải xuống'
    : `${fmtBytes(d.received)} / ${d.total > 0 ? fmtBytes(d.total) : '?'}`;
  const acts =
    d.state === 'completed' || (d.unit === 'pages' && d.state !== 'progressing' && d.received > 0) ? `<button class="icon-btn act" data-a="show" title="Mở thư mục">${icon('folder', 15)}</button>`
    : d.state === 'progressing' && d.own ? `<button class="icon-btn" data-a="cancel" title="Hủy">${icon('x', 15)}</button>`
    : d.state === 'progressing' ? `<button class="icon-btn" data-a="pause" title="Tạm dừng">${icon('pause', 15)}</button><button class="icon-btn" data-a="cancel" title="Hủy">${icon('x', 15)}</button>`
    : d.state === 'paused' ? `<button class="icon-btn" data-a="resume" title="Tiếp tục">${icon('play', 15)}</button><button class="icon-btn" data-a="cancel" title="Hủy">${icon('x', 15)}</button>`
    : `<button class="icon-btn act" data-a="retry" title="Tải lại">${icon('reload', 15)}</button>`;
  return `<div class="row" data-id="${d.id}">${icon(d.state === 'completed' ? 'check' : 'download', 18)}<div class="col"><span class="t" title="${esc(d.path)}">${esc(d.file)}</span><span class="sub">${status}</span>${scanBadge(d)}${d.state === 'progressing' || d.state === 'paused' ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div>${acts}</div>`;
}

function drawPop() {
  if (!popList) return;
  const items = [...D.values()].sort((a, b) => b.started - a.started).slice(0, 8);
  popList.innerHTML = items.length ? items.map(row).join('') : '<div class="empty">Chưa có tải xuống nào trong lần chạy này</div>';
}

/** A click in a list of download rows (the popover, the sidebar's panel). */
export function rowClick(e) {
  const r = e.target.closest('.row');
  if (!r) return;
  const d = D.get(isNaN(+r.dataset.id) ? r.dataset.id : +r.dataset.id);
  if (!d) return;
  const sc = e.target.closest('[data-scan]');
  if (sc) return createTab({ url: scanUrl(sc.dataset.scan) });
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'show') invoke('file_show', { path: d.path });
  // (a video the browser downloaded itself: its own downloader again; anything else: the page again)
  // (a comic chapter: its page again, to download it from there)
  else if (a === 'retry' && d.unit === 'pages') createTab({ url: d.url });
  else if (a === 'retry') d.own ? invoke('media_download', { tab: '', url: d.url, kind: /\.m3u8/i.test(d.url) ? 'hls' : /\.(mp3|m4a|ogg|opus|wav|flac)/i.test(d.url) ? 'audio' : 'video', title: d.file.replace(/\.[^.]+$/, '') }) : createTab({ url: d.url, background: true });
  else if (a) invoke('download_action', { id: d.id, action: a });
  else if (d.state === 'completed') invoke('file_open', { path: d.path }).catch((err) => toast(String(err), { iconName: 'warn' }));
}

/** Every download known: this run's and the kept list, newest first. */
export async function allDownloads() {
  for (const d of await invoke('downloads_list')) if (![...D.values()].some((x) => x.path === d.path && x.started === d.started)) D.set(d.id + '-old', { ...d, id: d.id + '-old' });
  return [...D.values()].sort((a, b) => b.started - a.started);
}

export async function downloadsPopover(anchor) {
  if (popClose) return popClose();
  if (!D.size) {
    for (const d of (await invoke('downloads_list')).slice(0, 8)) D.set(d.id + '-old', { ...d, id: d.id + '-old' });
  }
  popList = h('div', { class: 'panel-list', style: { padding: 0, maxHeight: '360px' } });
  const el = h(
    'div',
    {},
    h('div', { class: 'panel-head', style: { padding: '2px 4px 8px' } }, h('span', { text: 'Tải xuống gần đây' }), h('span', { class: 'grow' }), h('button', { class: 'btn', text: 'Xem tất cả', onclick: () => (popClose?.(), createTab({ url: 'unk://downloads' })) })),
    popList
  );
  popList.addEventListener('click', rowClick);
  drawPop();
  popClose = popover(el, anchor, { class: 'dl-pop', onClose: () => ((popClose = null), (popList = null)) });
}

export function initDownloads() {
  // (Kiểm tra tệp tải về found a threat)
  listen('download-threat', (d) => {
    if (!d || (d.private && !S.private)) return;
    toast(t('Phát hiện mã độc trong {0}', d.file), { iconName: 'warn', timeout: 10000, action: { label: t('Xem'), run: () => createTab({ url: scanUrl(d.id) }) } });
  });
  listen('download', (d) => {
    if (d.private && !S.private) return; // (each window shows its own kind)
    // (a kept download's scan: the row it is shown as)
    if (!D.has(d.id) && D.has(d.id + '-old')) d = { ...d, id: d.id + '-old' };
    const first = !D.has(d.id) && !d.scan;
    const was = D.get(d.id);
    D.set(d.id, d);
    if (first && document.hasFocus()) toast(t('Đang tải xuống {0}', d.file), { iconName: 'download', action: { label: t('Xem'), run: () => downloadsPopover($('[data-item="downloads"]') || $('#omnibox')) } });
    if (d.state === 'completed' && was?.state !== 'completed' && document.hasFocus()) toast(t('Đã tải xong {0}', d.file), { iconName: 'check', action: { label: t('Mở'), run: () => invoke('file_open', { path: d.path }) } });
    updateButton();
    drawPop();
    emit('downloads-changed');
  });
  on('settings', updateButton);
}
