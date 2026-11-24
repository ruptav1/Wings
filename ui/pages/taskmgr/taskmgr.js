// The browser's own task manager: memory and CPU of each WebView2 process, and which pages each shows.
import { invoke, esc, fmtBytes, hostOf } from '../../shared/api.js';
import { initPage } from '../../shared/page.js';

const $ = (s) => document.querySelector(s);
const KIND = { host: 'Trình duyệt (giao diện chính)', browser: 'Tiến trình WebView2 chính', gpu: 'GPU', utility: 'Tiện ích (mạng, âm thanh…)', plugin: 'Plugin', other: 'Khác' };
let rows = [];
let sel = null;
let sortKey = 'private';
let sortDesc = true;

function nameOf(p) {
  if (p.kind !== 'renderer') return { title: KIND[p.kind] || p.kind, kind: p.kind === 'host' ? 'App' : 'Hệ thống' };
  const pages = p.frames.map((u) => {
    if (/^http:\/\/tauri\.localhost\/index\.html/.test(u) || u === 'http://tauri.localhost/') return 'Giao diện trình duyệt';
    if (u.startsWith('unk://')) return u.replace('unk://', 'Trang ').split('/')[0];
    return hostOf(u) || u;
  });
  const uniq = [...new Set(pages)];
  return { title: uniq.length ? uniq.join(', ') : 'Trang web', kind: p.tabs.length ? `${p.tabs.length} tab` : 'Trang' };
}

function draw() {
  const list = rows.map((p) => ({ ...p, name: nameOf(p) }));
  list.sort((a, b) => {
    const x = sortKey === 'name' ? a.name.title.localeCompare(b.name.title) : a[sortKey] - b[sortKey];
    return sortDesc ? -x : x;
  });
  $('#rows').innerHTML = list
    .map((p) => `<tr data-pid="${p.pid}" class="${p.pid === sel ? 'sel' : ''}"><td><div class="name"><span>${esc(p.name.title)}</span><span class="kind">${esc(p.name.kind)}</span></div></td><td class="num">${fmtBytes(p.private)}</td><td class="num">${p.cpu.toFixed(1)}%</td><td class="num">${p.pid}</td></tr>`)
    .join('');
  const mem = rows.reduce((s, p) => s + p.private, 0);
  const cpu = rows.reduce((s, p) => s + p.cpu, 0);
  $('#total').textContent = `Tổng: ${rows.length} tiến trình · ${fmtBytes(mem)} RAM · ${cpu.toFixed(1)}% CPU`;
  const p = rows.find((r) => r.pid === sel);
  $('#kill').disabled = !p || p.kind === 'host' || p.kind === 'browser';
}

async function refresh() {
  try {
    rows = await invoke('taskmgr_snapshot');
    draw();
  } catch (e) {
    $('#total').textContent = 'Không đọc được: ' + e;
  }
}

async function main() {
  await initPage();
  $('#rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    sel = +tr.dataset.pid;
    draw();
  });
  document.querySelector('thead').addEventListener('click', (e) => {
    const k = e.target.closest('th')?.dataset.k;
    if (!k) return;
    sortDesc = sortKey === k ? !sortDesc : true;
    sortKey = k;
    draw();
  });
  $('#kill').addEventListener('click', async () => {
    if (sel && (await invoke('process_kill', { pid: sel }))) refresh();
  });
  await refresh();
  setTimeout(refresh, 600); // (CPU needs two looks)
  setInterval(refresh, 2000);
}
main();
