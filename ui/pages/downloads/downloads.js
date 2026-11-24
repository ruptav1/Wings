import { invoke, listen, esc, fmtBytes, hostOf, timeAgo } from '../../shared/api.js';
import { icon } from '../../shared/icons.js';
import { initPage, openTab } from '../../shared/page.js';
import { scanBadge, scanUrl } from '../../shared/scan.js';
import { t } from '../../shared/i18n.js';

// (a comic chapter's row - Tải truyện tranh - counts pictures, not bytes)
function pagesStatus(d) {
  const failed = d.failed ? ` · ${t('{0} lỗi', d.failed)}` : '';
  if (d.state === 'completed') return t('{0} ảnh', d.received) + failed;
  if (d.state === 'cancelled') return t('Đã hủy · {0}/{1} ảnh', d.received, d.total);
  if (d.state === 'interrupted') return t('Không tải được ảnh nào');
  return t('{0} / {1} ảnh', d.received, d.total || '?') + failed;
}

const $ = (s) => document.querySelector(s);
const D = new Map();

function draw() {
  const q = $('#q').value.toLowerCase();
  const list = [...D.values()].filter((d) => !q || d.file.toLowerCase().includes(q) || d.url.toLowerCase().includes(q)).sort((a, b) => b.started - a.started);
  $('#list').innerHTML =
    list
      .map((d) => {
        const pct = d.total > 0 ? Math.min(100, (d.received / d.total) * 100) : 0;
        const going = d.state === 'progressing' || d.state === 'paused';
        const status = d.unit === 'pages' ? `${pagesStatus(d)}${d.state === 'completed' ? ` · ${timeAgo(d.ended || d.started)}` : ''}` : d.state === 'completed' ? `${fmtBytes(d.total > 0 ? d.total : d.received)} · ${timeAgo(d.ended || d.started)}` : d.state === 'paused' ? 'Tạm dừng' : d.state === 'cancelled' ? 'Đã hủy' : d.state === 'interrupted' ? 'Lỗi tải xuống' : `${fmtBytes(d.received)} / ${d.total > 0 ? fmtBytes(d.total) : '?'}`;
        const acts =
          d.unit === 'pages' && d.state === 'progressing' ? `<button class="icon-btn" data-a="cancel" title="Hủy">${icon('x', 16)}</button>`
          : d.unit === 'pages' && d.received > 0 ? `<button class="btn" data-a="show">Mở thư mục</button><button class="btn" data-a="retry">Mở trang</button>`
          : d.state === 'completed' ? `<button class="btn" data-a="open">Mở</button><button class="icon-btn" data-a="show" title="Hiện trong thư mục">${icon('folder', 16)}</button>`
          : d.state === 'progressing' ? `<button class="icon-btn" data-a="pause" title="Tạm dừng">${icon('pause', 16)}</button><button class="icon-btn" data-a="cancel" title="Hủy">${icon('x', 16)}</button>`
          : d.state === 'paused' ? `<button class="icon-btn" data-a="resume" title="Tiếp tục">${icon('play', 16)}</button><button class="icon-btn" data-a="cancel" title="Hủy">${icon('x', 16)}</button>`
          : `<button class="btn" data-a="retry">Tải lại</button>`;
        return `<div class="list-row" data-id="${esc(String(d.id))}">${icon(d.state === 'completed' ? 'check' : 'download', 20)}<div class="col"><span class="t">${esc(d.file)}</span><span class="sub">${esc(hostOf(d.url))} · ${status}</span>${scanBadge(d)}${going ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div><div class="acts">${acts}<button class="icon-btn" data-a="remove" title="Xóa khỏi danh sách">${icon('trash', 16)}</button></div></div>`;
      })
      .join('') || '<div class="empty">Chưa có tệp nào được tải xuống</div>';
}

async function main() {
  await initPage();
  for (const d of await invoke('downloads_list')) D.set(String(d.id), d);
  listen('download', (d) => {
    if (d.private) return;
    D.set(String(d.id), d);
    draw();
  });
  draw();
  $('#q').addEventListener('input', draw);
  $('#clear').addEventListener('click', async () => {
    await invoke('downloads_clear', {});
    for (const [k, d] of D) if (d.state !== 'progressing' && d.state !== 'paused') D.delete(k);
    draw();
  });
  $('#list').addEventListener('click', async (e) => {
    const sc = e.target.closest('[data-scan]');
    if (sc) return openTab(scanUrl(sc.dataset.scan));
    const row = e.target.closest('.list-row');
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!row || !a) return;
    const d = D.get(row.dataset.id);
    if (a === 'open') invoke('file_open', { path: d.path });
    else if (a === 'show') invoke('file_show', { path: d.path });
    else if (a === 'retry' && d.unit === 'pages') openTab(d.url, true);
    else if (a === 'retry') d.own ? invoke('media_download', { tab: '', url: d.url, kind: /\.m3u8/i.test(d.url) ? 'hls' : /\.(mp3|m4a|ogg|opus|wav|flac)/i.test(d.url) ? 'audio' : 'video', title: d.file.replace(/\.[^.]+$/, '') }) : openTab(d.url, true);
    else if (a === 'remove') {
      await invoke('downloads_clear', { id: d.id });
      D.delete(row.dataset.id);
      draw();
    } else invoke('download_action', { id: d.id, action: a });
  });
}
main();
