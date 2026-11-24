// A wallpaper's own music (from TyranWeb): its audio files (played here, measured for the spectrum
// along the foot of the wallpaper) or a YouTube / SoundCloud / Spotify link (played by an unseen
// player of the browser's). It plays while the new tab page or Lobby is in front, while it is on
// (Settings → Hình nền → Nhạc nền); a tab making sound pauses it a moment (pauseForSound: 'tabs').
import { invoke, listen } from '../shared/api.js';
import { S, on, emit } from './state.js';
import { T } from './tabs.js';

const GECKO = !!window.__TAURI__?.gecko;

/** Which wallpaper the music belongs to (one song or playlist per wallpaper). */
export function musicKey(w) {
  if (w.type === 'image') return w.image ? 'image:' + w.image : '';
  if (w.type === 'video') return w.video ? 'video:' + w.video : '';
  if (w.type === 'web') return w.web?.url ? 'web:' + w.web.url : '';
  return '';
}
export const ownMusic = (w) => w.music?.[musicKey(w)] || null;

const audio = new Audio();
audio.preload = 'auto';
let list = [];
let at = 0;
let key = '';
let linkOn = '';
const audible = new Set(); // tabs making sound now
let quietTimer = 0;
let ctx = null;
let analyser = null;

/** The spectrum's source (an AnalyserNode on the files' sound), made on first use. */
export function spectrum() {
  if (!analyser) {
    try {
      ctx = new AudioContext();
      const src = ctx.createMediaElementSource(audio);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.78;
      src.connect(analyser);
      analyser.connect(ctx.destination);
    } catch {
      analyser = null;
    }
  }
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  return analyser;
}
export const musicPlaying = () => (list.length ? !audio.paused : !!linkOn);

function shouldPlay() {
  const w = S.settings.wallpaper;
  if (!w.musicOn || !ownMusic(w)) return false;
  const front = document.body.classList.contains('newtab-active') || S.lobby;
  const others = (w.pauseForSound || 'tabs') !== 'off' && audible.size > 0;
  return front && !others && document.visibilityState !== 'hidden';
}

function load() {
  const w = S.settings.wallpaper;
  const m = ownMusic(w);
  const k = JSON.stringify([musicKey(w), m]);
  if (k === key) return;
  key = k;
  list = [];
  at = 0;
  audio.pause();
  audio.removeAttribute('src');
  if (linkOn) {
    if (GECKO) invoke('musicweb_set', { embed: '' });
    linkOn = '';
  }
  if (!m) return;
  if (m.kind === 'files') {
    list = (m.files || []).map((f) => f.url).filter(Boolean);
    if (m.shuffle) list.sort(() => Math.random() - 0.5);
    if (list.length) audio.src = list[0];
  }
}

function apply() {
  load();
  const w = S.settings.wallpaper;
  const m = ownMusic(w);
  audio.volume = Math.max(0, Math.min(1, w.musicVolume ?? 0.6));
  const go = shouldPlay();
  if (m?.kind === 'files' && list.length) {
    if (go && audio.paused) {
      spectrum();
      audio.play().catch(() => {});
    } else if (!go && !audio.paused) audio.pause();
  } else if (m && m.kind !== 'files' && GECKO) {
    // (a link: its player is started the first time, then paused and played on)
    if (go && linkOn !== m.embed) {
      linkOn = m.embed;
      invoke('musicweb_set', { embed: m.embed });
    } else if (linkOn) invoke('musicweb_pause', { paused: !go });
  }
  emit('music', { playing: musicPlaying() });
}

audio.addEventListener('ended', () => {
  if (!list.length) return;
  at = (at + 1) % list.length;
  audio.src = list[at];
  if (shouldPlay()) audio.play().catch(() => {});
});
audio.addEventListener('play', () => emit('music', { playing: true }));
audio.addEventListener('pause', () => emit('music', { playing: false }));

/** The new tab page's button: on / off. */
export function toggleMusic() {
  invoke('settings_set', { patch: { wallpaper: { musicOn: !S.settings.wallpaper.musicOn } } });
}

export function initMusic() {
  on('settings', apply);
  on('active', () => setTimeout(apply, 50));
  on('tab-changed', () => setTimeout(apply, 50));
  on('lobby', () => setTimeout(apply, 50));
  document.addEventListener('visibilitychange', apply);
  // (a page making sound: the music makes way, and comes back a moment after it is quiet)
  listen('tab', (p) => {
    if (!('audible' in p)) return;
    if (p.audible) audible.add(p.id);
    else audible.delete(p.id);
    clearTimeout(quietTimer);
    if (audible.size) apply();
    else quietTimer = setTimeout(apply, 1500);
  });
  new MutationObserver(() => apply()).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  void T;
  apply();
}
