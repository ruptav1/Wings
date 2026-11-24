// What a site asks to use (camera, microphone, location…), asked under the address bar's site icon
// (perms.rs keeps the answers). Requests of one site that come together (camera and microphone) are
// one question; the others wait their turn.
import { invoke, listen, h, esc } from '../shared/api.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { S, $ } from './state.js';
import { T, activate } from './tabs.js';
import { popover } from './menus.js';

export const PERMS = {
  camera: ['video', 'Dùng camera'],
  microphone: ['mic', 'Dùng micro'],
  geolocation: ['mapPin', 'Biết vị trí của bạn'],
  notifications: ['bell', 'Hiển thị thông báo'],
  sensors: ['target', 'Dùng cảm biến chuyển động'],
  'clipboard-read': ['copy', 'Đọc khay nhớ tạm'],
  downloads: ['download', 'Tải nhiều tệp cùng lúc'],
  files: ['folder', 'Sửa tệp trên máy'],
  'local-fonts': ['edit', 'Dùng phông chữ trên máy'],
  midi: ['keyboard', 'Điều khiển thiết bị MIDI'],
  'window-management': ['window', 'Quản lý cửa sổ trên các màn hình'],
};
export const permLabel = (k) => t(PERMS[k]?.[1] || k);
export const permIcon = (k) => PERMS[k]?.[0] || 'info';

const queue = []; // [{ tab, origin, private, reqs: [{ id, kind }] }]
let showing = null;

function enqueue(p) {
  // (with one already waiting from the same site and tab: one question)
  const same = [showing, ...queue].find((g) => g && g.tab === p.tab && g.origin === p.origin);
  if (same && same !== showing) return same.reqs.push({ id: p.id, kind: p.kind });
  queue.push({ tab: p.tab, origin: p.origin, private: p.private, reqs: [{ id: p.id, kind: p.kind }] });
  if (!showing) setTimeout(next, 150); // (its pair, the microphone after the camera, comes a moment later)
}

function answer(g, allow, remember) {
  for (const r of g.reqs) invoke('perm_respond', { id: r.id, allow, remember });
}

function next() {
  if (showing) return;
  const g = queue.shift();
  if (!g) return;
  // (the prompt is about the tab that asked: it is shown first)
  if (T.list.some((x) => x.id === g.tab) && T.activeId !== g.tab) activate(g.tab);
  showing = g;
  const site = g.origin.replace(/^https?:\/\//, '');
  const remember = h('input', { type: 'checkbox', checked: !g.private });
  let answered = false;
  const reply = (allow) => {
    answered = true;
    answer(g, allow, remember.checked);
    close();
  };
  const kinds = [...new Set(g.reqs.map((r) => r.kind))];
  const el = h(
    'div',
    { class: 'perm' },
    h('div', { class: 'perm-head' }, h('span', { class: 'perm-ic', html: icon(permIcon(kinds[0]), 20) }), h('span', {}, h('b', { text: site }), h('small', { text: t('muốn') }))),
    h('ul', { class: 'perm-list' }, ...kinds.map((k) => h('li', { html: `${icon(permIcon(k), 15)}<span>${esc(permLabel(k))}</span>` }))),
    g.private ? h('small', { class: 'muted', text: t('Cửa sổ InPrivate: lựa chọn chỉ dùng cho lần này') }) : h('label', { class: 'check' }, remember, h('span', { text: t('Nhớ lựa chọn cho trang này') })),
    h('div', { class: 'actions' }, h('button', { class: 'btn', text: t('Chặn'), onclick: () => reply(false) }), h('button', { class: 'btn primary', text: t('Cho phép'), onclick: () => reply(true) }))
  );
  const anchor = $('#omnibox .site') || $('#omnibox');
  const close = popover(el, anchor, {
    align: 'start',
    class: 'perm-pop',
    // (closed without an answer: refused, this once)
    onClose: () => {
      if (!answered) answer(g, false, false);
      showing = null;
      setTimeout(next, 120);
    },
  });
}

export function initPrompts() {
  listen('perm', (p) => {
    if (!T.list.some((x) => x.id === p.tab) && T.panelTab?.id !== p.tab) return; // (another window's tab)
    enqueue(p);
  });
  void S;
}
