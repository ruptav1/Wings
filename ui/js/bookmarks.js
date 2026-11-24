// Bookmarks: the bar, the star in the address bar, and edits shared with every window and unk:// page.
import { invoke, listen, h, esc, isNewTab, hostOf, favicon } from '../shared/api.js';
import { icon } from '../shared/icons.js';
import { S, $, emit, on } from './state.js';
import { active, createTab, navigate } from './tabs.js';
import { menu, popover } from './menus.js';

export function saveBookmarks() {
  invoke('bookmarks_set', { value: S.bookmarks });
  renderBar();
  emit('bookmarks-changed');
}

const uid = () => 'b-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function favImg(url) {
  const letter = esc((hostOf(url)[0] || '?').toUpperCase());
  return `<img class="fav" src="${esc(favicon(url))}" alt="" onerror="this.outerHTML='<span class=&quot;fav letter&quot;>${letter}</span>'">`;
}

function openBm(url, e) {
  if (e?.ctrlKey || e?.button === 1) createTab({ url, background: true });
  else navigate(active(), url);
}

export function renderBar() {
  const bar = $('#bookmarks-bar');
  const mode = S.settings.layout.bookmarksBar;
  const show = mode === 'always' || (mode === 'newtab' && isNewTab(active()?.url));
  if (document.body.classList.contains('show-bar') !== show) {
    document.body.classList.toggle('show-bar', show);
    emit('layout');
  }
  if (!show) return;
  const folders = S.bookmarks.folders.filter((f) => f.parent === 'bar');
  const items = S.bookmarks.items.filter((b) => b.folder === 'bar');
  bar.innerHTML =
    folders.map((f) => `<button class="bm folder" data-folder="${esc(f.id)}">${icon('folder', 15)}<span>${esc(f.name)}</span></button>`).join('') +
    items.map((b) => `<button class="bm" data-id="${esc(b.id)}" title="${esc(b.title)}\n${esc(b.url)}">${favImg(b.url)}<span>${esc(b.title)}</span></button>`).join('') +
    `<button class="bm bm-more" data-folder="other">${icon('folder', 15)}<span>Dấu trang khác</span></button>`;
  if (!items.length && !folders.length) bar.insertAdjacentHTML('afterbegin', '<span class="muted" style="padding:0 6px">Thêm dấu trang bằng ngôi sao trên thanh địa chỉ (Ctrl+D)</span>');
}

function folderMenu(folderId, anchor) {
  const sub = S.bookmarks.folders.filter((f) => f.parent === folderId);
  const items = S.bookmarks.items.filter((b) => b.folder === folderId);
  menu(
    [
      ...sub.map((f) => ({ label: f.name, icon: 'folder', run: () => folderMenu(f.id, anchor) })),
      ...items.map((b) => ({ label: b.title || b.url, icon: 'globe', run: () => openBm(b.url) })),
      ...(items.length ? ['sep', { label: 'Mở tất cả trong tab mới', icon: 'tabs', run: () => items.forEach((b) => createTab({ url: b.url, background: true })) }] : [{ label: 'Trống', disabled: true }]),
    ],
    { anchor }
  );
}

function itemMenu(b, x, y) {
  menu(
    [
      { label: 'Mở trong tab mới', icon: 'plus', run: () => createTab({ url: b.url, background: true }) },
      { label: 'Mở trong cửa sổ mới', icon: 'window', run: () => invoke('win_new', { private: false, url: b.url }) },
      { label: 'Mở trong cửa sổ InPrivate', icon: 'incognito', run: () => invoke('win_new', { private: true, url: b.url }) },
      'sep',
      { label: 'Sửa…', icon: 'edit', run: () => editPopover(b, $(`#bookmarks-bar [data-id="${b.id}"]`) || $('#omnibox .star')) },
      { label: 'Sao chép địa chỉ', icon: 'copy', run: () => navigator.clipboard.writeText(b.url) },
      { label: 'Xóa', icon: 'trash', run: () => ((S.bookmarks.items = S.bookmarks.items.filter((x) => x !== b)), saveBookmarks()) },
    ],
    { x, y }
  );
}

function folderOptions(selected) {
  const out = [];
  const walk = (parent, depth) => {
    for (const f of S.bookmarks.folders.filter((f) => (f.parent || null) === parent)) {
      out.push(`<option value="${esc(f.id)}" ${f.id === selected ? 'selected' : ''}>${'  '.repeat(depth)}${esc(f.name)}</option>`);
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out.join('');
}

function editPopover(b, anchor, isNew = false) {
  const name = h('input', { type: 'text', value: b.title });
  const url = h('input', { type: 'text', value: b.url });
  const folder = h('select', { html: folderOptions(b.folder) });
  const el = h(
    'div',
    {},
    h('h3', { text: isNew ? 'Đã thêm dấu trang' : 'Sửa dấu trang' }),
    h('div', { class: 'field' }, h('label', { text: 'Tên' }), name),
    h('div', { class: 'field' }, h('label', { text: 'Địa chỉ' }), url),
    h('div', { class: 'field' }, h('label', { text: 'Thư mục' }), folder)
  );
  const remove = h('button', { class: 'btn danger', text: 'Xóa' });
  const done = h('button', { class: 'btn primary', text: 'Xong' });
  el.append(h('div', { class: 'actions' }, remove, done));
  const commit = () => {
    b.title = name.value.trim() || b.url;
    b.url = url.value.trim() || b.url;
    b.folder = folder.value;
    saveBookmarks();
  };
  const close = popover(el, anchor, { onClose: () => !removed && commit() });
  let removed = false;
  remove.onclick = () => {
    removed = true;
    S.bookmarks.items = S.bookmarks.items.filter((x) => x !== b);
    saveBookmarks();
    close();
  };
  done.onclick = () => close();
  name.addEventListener('keydown', (e) => e.key === 'Enter' && close());
  setTimeout(() => (name.focus(), name.select()), 30);
}

export function bookmarkPopover(anchor) {
  const t = active();
  if (!t || isNewTab(t.url)) return;
  let b = S.bookmarks.items.find((x) => x.url === t.url);
  const isNew = !b;
  if (!b) {
    b = { id: uid(), url: t.url, title: t.title, folder: 'bar', created: Date.now() };
    S.bookmarks.items.push(b);
    saveBookmarks();
  }
  editPopover(b, anchor || $('#omnibox .star'), isNew);
}

export function initBookmarks() {
  const bar = $('#bookmarks-bar');
  bar.addEventListener('click', (e) => {
    const f = e.target.closest('[data-folder]');
    if (f) return folderMenu(f.dataset.folder, f);
    const el = e.target.closest('[data-id]');
    const b = el && S.bookmarks.items.find((x) => x.id === el.dataset.id);
    if (b) openBm(b.url, e);
  });
  bar.addEventListener('auxclick', (e) => {
    const el = e.target.closest('[data-id]');
    const b = el && S.bookmarks.items.find((x) => x.id === el.dataset.id);
    if (b && e.button === 1) createTab({ url: b.url, background: true });
  });
  bar.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const el = e.target.closest('[data-id]');
    const b = el && S.bookmarks.items.find((x) => x.id === el.dataset.id);
    if (b) itemMenu(b, e.clientX, e.clientY);
  });
  listen('bookmarks', (v) => {
    S.bookmarks = v;
    renderBar();
    emit('bookmarks-changed');
  });
  on('active', renderBar);
  on('tab-changed', renderBar);
  on('settings', renderBar);
  on('bookmark-popover', bookmarkPopover);
  renderBar();
}
