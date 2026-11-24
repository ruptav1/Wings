// Bookmark manager: folders, edits, drag to reorder or move, import / export (the Netscape HTML format
// Chrome, Edge and Firefox export).
import { invoke, listen, esc, favicon, hostOf, fold } from '../../shared/api.js';
import { icon } from '../../shared/icons.js';
import { initPage, openTab } from '../../shared/page.js';

const $ = (s) => document.querySelector(s);
let B = { folders: [], items: [] };
let folder = 'bar';
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const save = () => invoke('bookmarks_set', { value: B });

function drawFolders() {
  const out = [];
  const walk = (parent, depth) => {
    for (const f of B.folders.filter((f) => (f.parent || null) === parent)) {
      out.push(`<div class="f ${f.id === folder ? 'on' : ''}" data-id="${esc(f.id)}" style="padding-left:${12 + depth * 16}px">${icon('folder', 16)}<span>${esc(f.name)}</span></div>`);
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  $('#folders').innerHTML = out.join('');
}

function drawItems() {
  const q = fold($('#q').value.trim());
  const list = q ? B.items.filter((b) => fold(b.title).includes(q) || b.url.toLowerCase().includes(q)) : B.items.filter((b) => b.folder === folder);
  const sub = q ? [] : B.folders.filter((f) => f.parent === folder);
  const cur = B.folders.find((f) => f.id === folder);
  $('#items').innerHTML =
    sub.map((f) => `<div class="list-row" data-folder="${esc(f.id)}">${icon('folder', 18)}<div class="col"><span class="t">${esc(f.name)}</span></div><div class="acts"><button class="icon-btn" data-a="rename-folder" title="Đổi tên">${icon('edit', 15)}</button><button class="icon-btn" data-a="del-folder" title="Xóa thư mục">${icon('trash', 15)}</button></div></div>`).join('') +
      list.map((b) => `<div class="list-row" draggable="true" data-id="${esc(b.id)}"><img class="fav" src="${esc(favicon(b.url))}" alt=""><div class="col"><span class="t"><a href="${esc(b.url)}">${esc(b.title)}</a></span><span class="sub">${esc(b.url)}</span></div><div class="acts"><button class="icon-btn" data-a="new" title="Mở trong tab mới">${icon('external', 15)}</button><button class="icon-btn" data-a="edit" title="Sửa">${icon('edit', 15)}</button><button class="icon-btn" data-a="del" title="Xóa">${icon('trash', 15)}</button></div></div>`).join('') ||
    `<div class="empty">${q ? 'Không tìm thấy' : `Thư mục "${esc(cur?.name || '')}" trống`}</div>`;
}

const draw = () => (drawFolders(), drawItems());

// ---------- import / export ----------
function importHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let added = 0;
  const walk = (dl, parent) => {
    for (const dt of dl.children) {
      if (dt.tagName !== 'DT') continue;
      const h3 = dt.querySelector(':scope > h3');
      const a = dt.querySelector(':scope > a');
      if (h3) {
        const isBar = h3.hasAttribute('personal_toolbar_folder') || /thanh dấu trang|bookmarks bar|favorites bar|bookmarks toolbar/i.test(h3.textContent);
        let id = isBar ? 'bar' : uid('f-');
        if (!isBar) B.folders.push({ id, name: h3.textContent.trim() || 'Thư mục', parent });
        const sub = dt.querySelector(':scope > dl');
        if (sub) walk(sub, id);
      } else if (a && /^https?:/i.test(a.href)) {
        if (!B.items.some((b) => b.url === a.href && b.folder === parent)) {
          B.items.push({ id: uid('b-'), url: a.href, title: a.textContent.trim() || a.href, folder: parent, created: (+a.getAttribute('add_date') || 0) * 1000 || Date.now() });
          added++;
        }
      }
    }
  };
  const root = doc.querySelector('dl');
  if (root) walk(root, 'other');
  return added;
}

function exportHtml() {
  const lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>'];
  const walk = (fid, depth) => {
    const pad = '    '.repeat(depth);
    for (const f of B.folders.filter((f) => f.parent === fid)) {
      lines.push(`${pad}<DT><H3>${esc(f.name)}</H3>`, `${pad}<DL><p>`);
      walk(f.id, depth + 1);
      lines.push(`${pad}</DL><p>`);
    }
    for (const b of B.items.filter((b) => b.folder === fid)) lines.push(`${pad}<DT><A HREF="${esc(b.url)}" ADD_DATE="${Math.floor((b.created || Date.now()) / 1000)}">${esc(b.title)}</A>`);
  };
  for (const f of B.folders.filter((f) => !f.parent)) {
    lines.push(`    <DT><H3${f.id === 'bar' ? ' PERSONAL_TOOLBAR_FOLDER="true"' : ''}>${esc(f.name)}</H3>`, '    <DL><p>');
    walk(f.id, 2);
    lines.push('    </DL><p>');
  }
  lines.push('</DL><p>');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/html' }));
  a.download = `bookmarks-${new Date().toISOString().slice(0, 10)}.html`;
  a.click();
}

async function main() {
  await initPage();
  B = await invoke('bookmarks_get');
  listen('bookmarks', (v) => ((B = v), draw()));
  draw();
  $('#q').addEventListener('input', drawItems);
  $('#folders').addEventListener('click', (e) => {
    const f = e.target.closest('.f');
    if (f) (folder = f.dataset.id), draw();
  });
  $('#add-folder').addEventListener('click', () => {
    const name = prompt('Tên thư mục:');
    if (!name) return;
    B.folders.push({ id: uid('f-'), name, parent: folder });
    save();
  });
  $('#import').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', async () => {
    const f = $('#file').files[0];
    if (!f) return;
    const n = importHtml(await f.text());
    await save();
    alert(`Đã nhập ${n} dấu trang vào "Dấu trang khác".`);
  });
  $('#export').addEventListener('click', exportHtml);
  $('#items').addEventListener('click', (e) => {
    const row = e.target.closest('.list-row');
    if (!row) return;
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (row.dataset.folder) {
      const f = B.folders.find((x) => x.id === row.dataset.folder);
      if (a === 'rename-folder') {
        const name = prompt('Tên mới:', f.name);
        if (name) (f.name = name), save();
      } else if (a === 'del-folder') {
        if (!confirm(`Xóa thư mục "${f.name}" và mọi thứ bên trong?`)) return;
        const gone = new Set([f.id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const x of B.folders) if (x.parent && gone.has(x.parent) && !gone.has(x.id)) gone.add(x.id), (grew = true);
        }
        B.folders = B.folders.filter((x) => !gone.has(x.id));
        B.items = B.items.filter((b) => !gone.has(b.folder));
        save();
      } else (folder = f.id), draw();
      return;
    }
    const b = B.items.find((x) => x.id === row.dataset.id);
    if (a === 'new') openTab(b.url, true);
    else if (a === 'del') (B.items = B.items.filter((x) => x !== b)), save();
    else if (a === 'edit') {
      const title = prompt('Tên:', b.title);
      if (title === null) return;
      const url = prompt('Địa chỉ:', b.url);
      if (url === null) return;
      Object.assign(b, { title: title || b.url, url: url || b.url });
      save();
    }
  });
  // drag a bookmark onto another to reorder, or onto a folder to move it
  let dragId = null;
  document.addEventListener('dragstart', (e) => (dragId = e.target.closest?.('[data-id]')?.dataset.id || null));
  document.addEventListener('dragover', (e) => {
    if (dragId && e.target.closest('.list-row[data-id], .f, .list-row[data-folder]')) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    const b = B.items.find((x) => x.id === dragId);
    if (!b) return;
    const toFolder = e.target.closest('.f, .list-row[data-folder]');
    const toItem = e.target.closest('.list-row[data-id]');
    if (toFolder) b.folder = toFolder.dataset.id || toFolder.dataset.folder;
    else if (toItem && toItem.dataset.id !== b.id) {
      B.items.splice(B.items.indexOf(b), 1);
      B.items.splice(B.items.findIndex((x) => x.id === toItem.dataset.id), 0, b);
    }
    dragId = null;
    save();
  });
}
main();
