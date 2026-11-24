// Menus, popovers and toasts, drawn in #layer. Anything that reaches over the page covers it first
// (view.js), since the page is a native window above the shell.
import { h, esc } from '../shared/api.js';
import { icon } from '../shared/icons.js';
import { $ } from './state.js';
import { cover, uncover, viewportRect } from './view.js';

const layer = () => $('#layer');
let openClose = null; // the open menu / popover's close function

function overlapsPage(r) {
  const v = viewportRect();
  return !(r.right <= v.x || r.left >= v.x + v.w || r.bottom <= v.y || r.top >= v.y + v.h);
}

function place(el, { x, y, anchor, align = 'start' }) {
  const W = innerWidth;
  const H = innerHeight;
  el.style.visibility = 'hidden';
  layer().append(el);
  const r = el.getBoundingClientRect();
  let left;
  let top;
  let up = false;
  if (anchor) {
    const a = anchor.getBoundingClientRect();
    left = align === 'end' ? a.right - r.width : a.left;
    top = a.bottom + 4;
    if (top + r.height > H - 8) (top = Math.max(8, a.top - r.height - 4)), (up = true);
  } else {
    left = x;
    top = y;
    if (top + r.height > H - 8) (top = Math.max(8, y - r.height)), (up = true);
  }
  left = Math.min(Math.max(8, left), W - r.width - 8);
  top = Math.min(Math.max(8, top), H - r.height - 8);
  // it grows out of where it was opened from
  const ox = anchor ? (align === 'end' ? 'right' : 'left') : x - left > r.width / 2 ? 'right' : 'left';
  Object.assign(el.style, { left: `${left}px`, top: `${top}px`, visibility: '', transformOrigin: `${ox} ${up ? 'bottom' : 'top'}` });
  return el.getBoundingClientRect();
}

/** A floating element with a click-away scrim. Returns its close function. */
export function float(el, pos, { onClose, modal = false, keepOnBlur = false, sticky = false } = {}) {
  openClose?.();
  const scrim = h('div', { class: 'scrim' });
  if (modal) scrim.style.background = 'rgba(0,0,0,.25)';
  layer().append(scrim);
  const rect = place(el, pos);
  const covers = modal || overlapsPage(rect);
  if (covers) cover();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    scrim.remove();
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('keydown', onKey, true);
    if (openClose === close) openClose = null;
    onClose?.();
    // it fades out first; the page comes back from under it once it has gone
    const animated = !document.documentElement.classList.contains('no-anim');
    el.classList.add('out');
    el.style.pointerEvents = 'none';
    setTimeout(
      () => {
        el.remove();
        if (covers) uncover();
      },
      animated ? 110 : 0
    );
  };
  // (closed when the window loses the keyboard, unless it is a panel worth coming back to)
  const onBlur = () => setTimeout(() => !keepOnBlur && !sticky && !document.hasFocus() && close(), 0);
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  // (sticky: a question that waits for its answer; a press beside it does not close it)
  scrim.addEventListener('pointerdown', () => !sticky && close());
  scrim.addEventListener('contextmenu', (e) => (e.preventDefault(), close()));
  window.addEventListener('blur', onBlur);
  document.addEventListener('keydown', onKey, true);
  openClose = close;
  return close;
}

export const closeFloating = () => openClose?.();

/**
 * items: { label, icon, keys, run, disabled, checked } | 'sep' | { head } | { el } (custom row)
 */
export function menu(items, pos) {
  const el = h('div', { class: 'menu', role: 'menu', tabindex: '-1' });
  const buttons = [];
  let close;
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep') {
      el.append(h('div', { class: 'sep' }));
      continue;
    }
    if (it.head) {
      el.append(h('div', { class: 'head', text: it.head }));
      continue;
    }
    if (it.el) {
      el.append(it.el);
      continue;
    }
    const b = h('button', {
      class: 'item',
      disabled: it.disabled,
      html: `${icon(it.checked ? 'check' : it.icon || 'blank', 16)}<span class="label">${esc(it.label)}</span>${it.keys ? `<span class="keys">${esc(it.keys)}</span>` : ''}`,
      onclick: () => {
        close();
        it.run?.();
      },
    });
    if (!it.icon && !it.checked) b.querySelector('.ico').style.visibility = 'hidden';
    buttons.push(b);
    el.append(b);
  }
  let sel = -1;
  const select = (i) => {
    buttons.forEach((b) => b.classList.remove('sel'));
    sel = (i + buttons.length) % buttons.length;
    buttons[sel]?.classList.add('sel');
    buttons[sel]?.scrollIntoView({ block: 'nearest' }); // (a menu taller than the window scrolls)
  };
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') select(sel + 1);
    else if (e.key === 'ArrowUp') select(sel - 1);
    else if (e.key === 'Enter' && sel >= 0) buttons[sel].click();
    else return;
    e.preventDefault();
  });
  close = float(el, pos);
  el.focus();
  return close;
}

export function popover(content, anchor, opts = {}) {
  const el = h('div', { class: `popover ${opts.class || ''}` }, content);
  return float(el, { anchor, align: opts.align || 'end' }, opts);
}

let toastBox;
export function toast(text, { action, timeout = 4000, iconName } = {}) {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts' });
    layer().append(toastBox);
  }
  const t = h('div', { class: 'toast' }, iconName ? h('span', { html: icon(iconName, 16) }) : null, h('span', { text }));
  const leave = () => {
    if (t.classList.contains('out')) return;
    t.classList.add('out');
    setTimeout(() => t.remove(), 200);
  };
  if (action) t.append(h('button', { text: action.label, onclick: () => (action.run(), leave()) }));
  // (the same message twice in a row: the first one makes way)
  for (const old of [...toastBox.children]) if (old.textContent === t.textContent) old.remove();
  toastBox.append(t);
  // (toasts sit in the title bar, the one place the page cannot cover)
  setTimeout(leave, timeout);
}

/** A small dialog over the page: resolves with the button's value (or null). */
export function dialog({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], width = 380, sticky = false }) {
  return new Promise((resolve) => {
    let value = null;
    const el = h('div', { class: 'popover', style: { width: `${width}px` } }, h('h3', { text: title }), body ? (body instanceof Node ? body : h('p', { class: 'muted', text: body })) : null);
    const row = h('div', { class: 'actions' });
    let focus = null;
    // (danger: the button that cannot be taken back, in red)
    for (const b of buttons) {
      const btn = h('button', { class: `btn ${b.danger ? 'critical' : b.primary ? 'primary' : ''}`, text: b.label, onclick: () => ((value = b.value), close()) });
      if (b.focus) focus = btn;
      row.append(btn);
    }
    el.append(row);
    const close = float(el, { x: innerWidth / 2 - width / 2, y: innerHeight / 3 }, { modal: true, sticky, onClose: () => resolve(value) });
    if (focus) setTimeout(() => focus.focus(), 30);
  });
}
