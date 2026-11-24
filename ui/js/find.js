// Find in page (WebView2's own find, without its dialog): a strip above the page.
import { invoke, listen, h } from '../shared/api.js';
import { icon } from '../shared/icons.js';
import { $, emit, on } from './state.js';
import { T, active } from './tabs.js';

let input, count, tabId = null, last = '';

function build() {
  const bar = $('#findbar');
  input = h('input', { type: 'text', placeholder: 'Tìm trong trang', spellcheck: 'false' });
  count = h('span', { class: 'count' });
  const btn = (ic, title, fn) => h('button', { class: 'icon-btn', title, html: icon(ic, 16), onclick: fn });
  bar.append(input, count, btn('chevronUp', 'Kết quả trước (Shift+Enter)', () => step(true)), btn('chevronDown', 'Kết quả sau (Enter)', () => step(false)), btn('x', 'Đóng (Esc)', closeFind));
  input.addEventListener('input', () => search(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') step(e.shiftKey);
    else if (e.key === 'Escape') closeFind();
    else return;
    e.preventDefault();
  });
  listen('find', (p) => {
    if (p.id !== tabId) return;
    count.textContent = p.count ? `${p.active + 1}/${p.count}` : input.value ? '0/0' : '';
  });
}

function search(fresh) {
  const t = active();
  if (!t?.live) return;
  tabId = t.id;
  const text = input.value;
  last = text;
  if (!text) count.textContent = '';
  invoke('tab_find', { id: t.id, text, newSearch: fresh, backwards: false, case: false });
}

function step(back) {
  if (!input.value) return;
  if (input.value !== last || tabId !== T.activeId) return search(true);
  invoke('tab_find', { id: tabId, text: input.value, newSearch: false, backwards: back, case: false });
}

export function openFind() {
  if (!input) build();
  const bar = $('#findbar');
  if (bar.hidden) {
    bar.hidden = false;
    document.body.classList.add('find-open');
    emit('layout');
  }
  input.focus();
  input.select();
  if (input.value) search(true);
}

export function closeFind() {
  const bar = $('#findbar');
  if (bar.hidden) return;
  bar.hidden = true;
  document.body.classList.remove('find-open');
  if (tabId) invoke('tab_find_stop', { id: tabId });
  tabId = null;
  emit('layout');
  const t = active();
  if (t?.live) invoke('tab_focus', { id: t.id });
}

on('active', () => {
  if (!$('#findbar').hidden && tabId && tabId !== T.activeId) {
    invoke('tab_find_stop', { id: tabId });
    tabId = null;
    count.textContent = '';
  }
});
