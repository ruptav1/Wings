// Đang phát: what the tabs play (a song, a video), with play / pause, ±10 s, mute and a way to its tab.
// The toolbar shows its button while a tab plays or has played in the last minutes; what plays is read
// from the page itself (its Media Session title and picture, its <video> / <audio>).
import { invoke, h, esc } from '../shared/api.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { $, on } from './state.js';
import { T, activate, toggleMute } from './tabs.js';
import { popover } from './menus.js';

const RECENT = 10 * 60000; // (a paused song stays listed this long)
const heard = new Map(); // tab id → last time it made sound

// the page's player: the one playing, else the one played last
const FIND = `const els = [...document.querySelectorAll('video, audio')]; const el = els.find((e) => !e.paused) || els.find((e) => e.currentTime > 0) || els[0];`;
const READ = `(() => { ${FIND} const m = navigator.mediaSession && navigator.mediaSession.metadata; if (!el && !m) return null;
  const art = m && m.artwork && m.artwork.length ? m.artwork[m.artwork.length - 1].src : '';
  return { title: (m && m.title) || document.title, artist: (m && m.artist) || '', art, paused: el ? el.paused : true, time: el ? el.currentTime : 0, duration: el && isFinite(el.duration) ? el.duration : 0, video: !!el && el.tagName === 'VIDEO' }; })()`;
const ACT = {
  toggle: `(() => { ${FIND} if (!el) return null; el.paused ? el.play() : el.pause(); return !el.paused; })()`,
  back: `(() => { ${FIND} if (el) el.currentTime = Math.max(0, el.currentTime - 10); })()`,
  ahead: `(() => { ${FIND} if (el) el.currentTime = Math.min(el.duration || 1e9, el.currentTime + 10); })()`,
};

const listed = () => T.list.filter((x) => x.live && (x.audible || Date.now() - (heard.get(x.id) || 0) < RECENT));

function sync() {
  const b = $('#playing-btn');
  if (!b) return;
  const tabs = listed();
  b.hidden = !tabs.length;
  b.classList.toggle('on', tabs.some((x) => x.audible));
}

const fmt = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '');

async function card(tab) {
  const info = await invoke('tab_eval', { id: tab.id, js: READ }).catch(() => null);
  const el = h('div', { class: 'np-item' });
  const draw = (i) => {
    el.innerHTML = `<div class="np-art">${i?.art ? `<img src="${esc(i.art)}" alt="" referrerpolicy="no-referrer">` : icon(i?.video ? 'video' : 'music', 22)}</div>
      <div class="np-text"><b title="${esc(i?.title || tab.title)}">${esc(i?.title || tab.title)}</b><small>${esc(i?.artist || tab.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}${i?.duration ? ` · ${fmt(i.time)} / ${fmt(i.duration)}` : ''}</small>
      <div class="np-ctl"><button class="icon-btn" data-a="back" title="${esc(t('Lùi 10 giây'))}">${icon('chevronLeft', 16)}</button><button class="icon-btn np-play" data-a="toggle" title="${esc(t('Phát / tạm dừng'))}">${icon(i && !i.paused ? 'pause' : 'play', 18)}</button><button class="icon-btn" data-a="ahead" title="${esc(t('Tới 10 giây'))}">${icon('chevronRight', 16)}</button>
      <span class="grow"></span><button class="icon-btn" data-a="mute" title="${esc(tab.muted ? t('Bật tiếng') : t('Tắt tiếng'))}">${icon(tab.muted ? 'muted' : 'volume', 15)}</button><button class="icon-btn" data-a="go" title="${esc(t('Tới tab này'))}">${icon('external', 15)}</button></div></div>`;
  };
  draw(info);
  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'go') return activate(tab.id), closeIt?.();
    if (a === 'mute') {
      toggleMute(tab);
    } else await invoke('tab_eval', { id: tab.id, js: ACT[a] }).catch(() => null);
    setTimeout(async () => draw(await invoke('tab_eval', { id: tab.id, js: READ }).catch(() => null)), 150);
  });
  return el;
}

let closeIt = null;
async function open(anchor) {
  if (closeIt) return closeIt();
  const tabs = listed();
  const list = h('div', { class: 'np-list' });
  for (const tab of tabs) list.append(await card(tab));
  if (!tabs.length) list.append(h('div', { class: 'empty', text: t('Không có gì đang phát') }));
  closeIt = popover(h('div', {}, h('div', { class: 'np-head', text: t('Đang phát') }), list), anchor, { class: 'np-pop', onClose: () => (closeIt = null) });
}

export function initPlaying() {
  const b = h('button', { id: 'playing-btn', class: 'icon-btn', title: t('Đang phát'), hidden: true, html: icon('music', 18) });
  b.addEventListener('click', () => open(b));
  const place = () => {
    // (beside the address bar's end, whatever the toolbar holds)
    const omni = $('#omnibox');
    if (omni && b.previousElementSibling !== omni) omni.after(b);
  };
  place();
  on('settings', () => requestAnimationFrame(place));
  on('tab-changed', (tab) => {
    if (tab?.audible) heard.set(tab.id, Date.now());
    sync();
  });
  on('strip-rendered', () => {
    for (const x of T.list) if (x.audible) heard.set(x.id, Date.now());
    sync();
  });
  setInterval(sync, 30000);
}
