// Where tab WebView2s sit. They are native windows over #viewport: the shell tells each visible one its
// rectangle and hides the rest. While a menu or popup overlaps the page, the page is swapped for a
// picture of itself ("cover"), since HTML cannot be drawn above a native window.
import { invoke, isNewTab } from '../shared/api.js';
import { S, $, on, emit } from './state.js';
import { T, byId } from './tabs.js';
import { showNtp } from './ntp.js';
import { updateMotion } from './layout.js';

const vp = () => $('#viewport');
const GECKO = !!window.__TAURI__?.gecko;
const shown = new Map(); // id -> "x,y,w,h" last sent
let covered = 0;
let coverToken = 0;

const SPLIT_GAP = 8;

function rectOf(el) {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
}

export function viewportRect() {
  return rectOf(vp());
}

/** The tabs on screen now and their rectangles. */
export function visibleRects() {
  const full = viewportRect();
  const out = new Map();
  const active = byId(T.activeId);
  if (!active) return out;
  const sp = S.split;
  if (sp && byId(sp.a) && byId(sp.b) && (active.id === sp.a || active.id === sp.b)) {
    const wa = Math.round((full.w - SPLIT_GAP) * sp.ratio);
    out.set(sp.a, { x: full.x, y: full.y, w: wa, h: full.h });
    out.set(sp.b, { x: full.x + wa + SPLIT_GAP, y: full.y, w: full.w - wa - SPLIT_GAP, h: full.h });
  } else {
    out.set(active.id, full);
  }
  // the sidebar's web panel is a tab too
  const panel = T.panel && byId(T.panel);
  const host = $('#sidebar-web');
  if (panel && host && document.body.classList.contains('sidebar-open')) out.set(panel.id, rectOf(host));
  return out;
}

export function rectFor(id) {
  return visibleRects().get(id) || viewportRect();
}

/** Puts every live tab where it belongs (call after anything that moves the viewport). */
export function layout(focusActive = false) {
  if (covered > 0) return;
  // lobby mode: no page at all, the wallpaper alone
  const rects = S.lobby ? new Map() : visibleRects();
  for (const t of T.list.concat(T.panel ? [byId(T.panel)].filter(Boolean) : [])) {
    if (!t.live) continue;
    const r = rects.get(t.id);
    if (r) {
      const key = `${r.x},${r.y},${r.w},${r.h}`;
      const was = shown.get(t.id);
      if (was === undefined || (focusActive && t.id === T.activeId)) {
        invoke('tab_show', { id: t.id, bounds: r, focus: focusActive && t.id === T.activeId });
        t.frozen = false;
      } else if (was !== key) invoke('tab_bounds', { id: t.id, bounds: r });
      shown.set(t.id, key);
    } else if (shown.has(t.id)) {
      shown.delete(t.id);
      t.hiddenSince = Date.now();
      invoke('tab_hide', { id: t.id });
    }
  }
  placeSplitHandle(rects);
  // the new tab page the shell draws: the active tab has gone nowhere yet (and is not in split view)
  const act = byId(T.activeId);
  const inSplit = S.split && act && (S.split.a === act.id || S.split.b === act.id);
  const ntp = !!act && !act.live && isNewTab(act.url) && !inSplit && !S.lobby;
  const was = document.body.classList.contains('newtab-active');
  document.body.classList.toggle('newtab-active', isNewTab(act?.url || ''));
  document.body.classList.toggle('ntp-on', ntp);
  showNtp(ntp);
  if (was !== document.body.classList.contains('newtab-active')) updateMotion();
}

export function forget(id) {
  shown.delete(id);
}
export const isShown = (id) => shown.has(id);

function placeSplitHandle(rects) {
  const hnd = $('#split-handle');
  const sp = S.split;
  const a = sp && rects.get(sp.a);
  if (!a || !rects.get(sp.b)) return (hnd.hidden = true);
  const c = $('#content').getBoundingClientRect();
  hnd.hidden = false;
  Object.assign(hnd.style, { left: `${a.x + a.w - c.left}px`, top: `${a.y - c.top}px`, height: `${a.h}px` });
}

/** Swap the visible pages for pictures of themselves (menus, popups, dialogs over the page). */
export async function cover() {
  // (on the Gecko core the pages are part of the interface: menus are drawn over them as they are)
  if (GECKO) return;
  covered++;
  if (covered > 1) return;
  const token = ++coverToken;
  const rects = visibleRects();
  const layer = $('#freeze');
  const c = $('#content').getBoundingClientRect();
  const shots = await Promise.all(
    [...rects].filter(([id]) => shown.has(id)).map(async ([id, r]) => {
      try {
        return { id, r, src: await invoke('tab_capture', { id }) };
      } catch {
        return { id, r, src: '' };
      }
    })
  );
  if (token !== coverToken || covered === 0) return;
  layer.replaceChildren(
    ...shots.map(({ r, src }) => {
      const img = new Image();
      if (src) img.src = src;
      Object.assign(img.style, { left: `${r.x - c.left}px`, top: `${r.y - c.top}px`, width: `${r.w}px`, height: `${r.h}px`, background: 'var(--surface-solid)' });
      return img;
    })
  );
  layer.hidden = false;
  for (const { id } of shots) {
    invoke('tab_hide', { id });
    shown.delete(id);
  }
}

export function uncover() {
  if (GECKO || covered === 0) return;
  covered--;
  if (covered > 0) return;
  coverToken++;
  layout();
  // the picture goes once the page is back in place
  setTimeout(() => {
    if (covered === 0) {
      $('#freeze').hidden = true;
      $('#freeze').replaceChildren();
    }
  }, 60);
}

export const isCovered = () => covered > 0;

export function initView() {
  new ResizeObserver(() => layout()).observe(vp());
  window.addEventListener('resize', () => layout());
  on('layout', () => requestAnimationFrame(() => layout()));

  // the bar between two tabs side by side
  const hnd = $('#split-handle');
  hnd.addEventListener('pointerdown', (e) => {
    if (!S.split) return;
    hnd.setPointerCapture(e.pointerId);
    const full = viewportRect();
    const move = (ev) => {
      S.split.ratio = Math.min(0.85, Math.max(0.15, (ev.clientX - full.x) / full.w));
      layout();
    };
    const up = () => {
      hnd.removeEventListener('pointermove', move);
      hnd.removeEventListener('pointerup', up);
      emit('session');
    };
    hnd.addEventListener('pointermove', move);
    hnd.addEventListener('pointerup', up);
  });
}
