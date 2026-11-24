// Applies the look and layout settings to the shell: colours, chrome style, tab position, wallpaper.
import { invoke } from '../shared/api.js';
import { applyTheme, wallpaperStyle, rgbToHsl } from '../shared/theme.js';
import { S, $, emit } from './state.js';

export function applyLayout() {
  const s = S.settings;
  const l = s.layout;
  const b = document.body;
  const vertical = l.tabsPosition !== 'top';
  b.classList.toggle('vtabs', vertical);
  b.classList.toggle('vtabs-right', l.tabsPosition === 'right');
  b.classList.toggle('vtabs-collapsed', vertical && !!l.verticalTabsCollapsed);
  b.classList.toggle('toolbar-bottom', l.toolbarPosition === 'bottom');
  b.classList.toggle('shadow', !!l.contentShadow);
  b.dataset.close = l.tabCloseButton;
  document.documentElement.dataset.tabStyle = s.appearance.tabStyle;
  emit('layout');
}

export function applyCustomCSS() {
  $('#user-css').textContent = S.settings.appearance.customCSS || '';
}

let slideTimer = null;
let slideIndex = 0;
let slideKey = '';
let shownKey = '';

const animated = () => !document.documentElement.classList.contains('no-anim');

// ---------- a video wallpaper, played in a page of its own ----------
// In the Gecko build a video wallpaper plays in a page behind the interface (gecko: modules/wall/video.html):
// there the graphics card decodes it, where in the interface's own process the engine leaves it to the
// processor (a 1440p 60 fps video: some two and a half cores, and it stutters). The interface's <video>
// is kept for the other builds and for addresses a page cannot open (chrome:, file:).
const videoInPage = (w) => !!window.__TAURI__?.gecko && w?.type === 'video' && /^(resource|https?):/i.test(w.video || '');
let lastWall = null; // { cur, st }: the wallpaper shown, as applyWallpaper worked it out
let shownWall = '';

/** Whether a moving wallpaper moves now (Settings → Hình nền → Video chạy khi): only when worth the work. */
function motionPlays() {
  const m = S.settings.wallpaper.motion;
  const ntp = document.body.classList.contains('newtab-active') || S.lobby;
  return m === 'always' || (m === 'focus' && S.focused) || (m === 'newtab' && ntp && S.focused);
}

/** The page drawn behind the interface, if any: a web wallpaper, or the page that plays a video. */
function wallPageOf(cur, st) {
  if (cur.type === 'web' && cur.web?.url && window.__TAURI__?.gecko) return { url: cur.web.url, audio: !!cur.web.audio };
  if (videoInPage(cur)) {
    const p = new URLSearchParams({ src: cur.video, rate: String(cur.videoRate || 1), filter: st.filter || '', pos: cur.position || 'center', play: motionPlays() ? '1' : '0' });
    return { url: `resource://unknowweb/wall/video.html#${p}`, audio: false };
  }
  return null;
}

function setWallPage(page) {
  const key = page ? `${page.url}|${page.audio}` : '';
  if (key === shownWall) return;
  shownWall = key;
  // (the same page with another # carries on in place: the video keeps its place)
  invoke('wallweb_set', { url: page?.url || '', audio: !!page?.audio }).catch(() => {});
}

// a still of a video played in its page (its first frame, from a copy loaded a moment in the interface):
// for the automatic colours, the bars' tone, and the fade to the next wallpaper
const stills = new Map(); // url -> Promise<canvas>
const stillNow = new Map(); // url -> canvas, once there
function videoStill(url) {
  if (!stills.has(url)) {
    const p = new Promise((ok, fail) => {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.crossOrigin = 'anonymous';
      const free = () => {
        v.removeAttribute('src');
        v.load();
      };
      v.addEventListener(
        'loadeddata',
        () => {
          try {
            const k = Math.min(1, 640 / v.videoWidth);
            const c = document.createElement('canvas');
            c.width = Math.round(v.videoWidth * k);
            c.height = Math.round(v.videoHeight * k);
            c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
            stillNow.set(url, c);
            ok(c);
          } catch (e) {
            fail(e);
          }
          free();
        },
        { once: true }
      );
      v.addEventListener('error', () => (fail(new Error('no still')), free()), { once: true });
      v.src = url;
    });
    p.catch(() => stills.delete(url));
    stills.set(url, p);
    for (const k of [...stills.keys()].slice(0, -4)) stills.delete(k), stillNow.delete(k);
  }
  return stills.get(url);
}

/** The old wallpaper stays on top a moment and fades away (a picture: its own copy; a video: a still of it). */
function crossfade() {
  if (!animated()) return;
  const el = $('#wallpaper');
  const ghost = el.cloneNode(false);
  ghost.id = '';
  ghost.className = 'wall-ghost';
  ghost.removeAttribute('style');
  for (const p of ['backgroundImage', 'backgroundColor', 'backgroundSize', 'backgroundPosition', 'filter', 'transform']) ghost.style[p] = el.style[p];
  const v = $('#wall-video');
  const still = (src, w, h, pos, filter) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(src, 0, 0, w, h);
    Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', objectPosition: pos, filter });
    ghost.append(c);
  };
  try {
    if (!v.hidden && v.readyState >= 2 && v.videoWidth) still(v, v.videoWidth, v.videoHeight, v.style.objectPosition, v.style.filter);
    else if (lastWall && videoInPage(lastWall.cur) && stillNow.get(lastWall.cur.video)) {
      const s = stillNow.get(lastWall.cur.video);
      still(s, s.width, s.height, lastWall.cur.position || 'center', lastWall.st.filter || '');
    }
  } catch {
    /* (no still: the new one simply fades in) */
  }
  const dim = $('#wall-dim').cloneNode(true);
  dim.removeAttribute('id');
  dim.className = 'dim';
  ghost.append(dim);
  el.after(ghost);
  requestAnimationFrame(() => requestAnimationFrame(() => ghost.classList.add('go')));
  setTimeout(() => ghost.remove(), 700);
}

export function applyWallpaper() {
  const w = S.settings.wallpaper;
  const el = $('#wallpaper');
  const video = $('#wall-video');
  let cur = w;
  // slideshow: the pictures in turn
  const key = `${w.slideshowMinutes}|${(w.slideshow || []).join(',')}`;
  if (key !== slideKey) {
    slideKey = key;
    clearInterval(slideTimer);
    slideTimer = null;
    if (w.slideshowMinutes > 0 && w.slideshow?.length > 1) {
      slideTimer = setInterval(() => {
        slideIndex++;
        applyWallpaper();
      }, w.slideshowMinutes * 60000);
    }
  }
  if (slideTimer && w.slideshow?.length > 1) cur = { ...w, type: 'image', image: w.slideshow[slideIndex % w.slideshow.length] };
  const st = wallpaperStyle(cur, S.settings.appearance);
  const what = `${cur.type}|${cur.type === 'video' ? cur.video : cur.type === 'image' ? cur.image : cur.type === 'web' ? cur.web?.url : cur.type === 'color' ? cur.color : `${cur.gradientFrom}${cur.gradientTo}${cur.gradientAngle}`}`;
  if (shownKey && what !== shownKey) crossfade();
  const changed = what !== shownKey;
  shownKey = what;
  el.style.backgroundImage = st.backgroundImage || 'none';
  el.style.backgroundColor = st.backgroundColor || '';
  el.style.backgroundSize = st.backgroundSize || 'cover';
  el.style.backgroundPosition = st.backgroundPosition || 'center';
  // (a video takes the blur / saturation itself, once: on the frame round it too, it was filtered twice,
  // and the whole window redrawn through the filter at every frame)
  el.style.filter = cur.type === 'video' ? 'none' : st.filter;
  $('#wall-dim').style.opacity = st.dim || 0;
  // a page behind the interface: a web page as the wallpaper (from TyranWeb: a site, or a Wallpaper
  // Engine / Lively web package), or the page that plays a video wallpaper
  lastWall = { cur, st };
  const page = wallPageOf(cur, st);
  setWallPage(page);
  if (page && cur.type === 'web') el.style.backgroundColor = '#000';
  const inPage = videoInPage(cur);
  if (inPage && changed) videoStill(cur.video).catch(() => {});
  if (cur.type === 'video' && cur.video && !inPage) {
    // (CORS: a frame of it can be read for the automatic colours)
    video.crossOrigin = 'anonymous';
    if (video.getAttribute('src') !== cur.video) {
      video.classList.remove('shown');
      video.src = cur.video;
      video.addEventListener('playing', () => video.classList.add('shown'), { once: true });
      video.addEventListener('loadeddata', () => (autoColors(), updateTone()), { once: true });
    }
    video.playbackRate = cur.videoRate || 1;
    video.style.filter = st.filter;
    video.style.objectPosition = cur.position || 'center';
    video.hidden = false;
    updateMotion();
  } else {
    video.hidden = true;
    video.pause();
    if (video.getAttribute('src')) {
      video.removeAttribute('src');
      video.load();
    }
    if (changed) autoColors();
  }
  if (!(cur.type === 'video' && cur.video && !inPage) || video.readyState >= 2) updateTone();
}

/** Moving wallpapers only move when they are worth the CPU (Settings → Hình nền → Video chạy khi). */
export function updateMotion() {
  if (lastWall && videoInPage(lastWall.cur)) return setWallPage(wallPageOf(lastWall.cur, lastWall.st));
  const video = $('#wall-video');
  if (video.hidden) return;
  if (motionPlays()) video.play().catch(() => {});
  else video.pause();
}

export function applyAll() {
  applyTheme(S.settings);
  applyCustomCSS();
  applyLayout();
  applyWallpaper();
}

// ---------- the bars' tone over the wallpaper ----------
// With see-through bars ("Trong suốt"), their text and icons are light over a dark wallpaper and dark
// over a light one, whatever the theme: what decides is how bright the top of the wallpaper is.
const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const hexLum = (hex) => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(hex || '');
  return m ? lum(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)) : 0.5;
};

function topBrightness(src, w, h) {
  if (!w || !h) return null;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const g = c.getContext('2d', { willReadFrequently: true });
  // (the top fifth of what shows: object-fit cover crops the sides of a wide picture)
  g.drawImage(src, 0, 0, w, h * 0.2, 0, 0, 64, 16);
  const px = g.getImageData(0, 0, 64, 16).data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += lum(px[i], px[i + 1], px[i + 2]);
  return sum / (px.length / 4);
}

let toneSeq = 0;
export async function updateTone() {
  const seq = ++toneSeq;
  const w = S.settings.wallpaper;
  const v = $('#wall-video');
  let b = null;
  try {
    if (videoInPage(w)) {
      const c = await videoStill(w.video);
      b = topBrightness(c, c.width, c.height);
    } else if (w.type === 'video' && !v.hidden) {
      if (v.readyState < 2) await new Promise((ok) => v.addEventListener('loadeddata', ok, { once: true }));
      b = topBrightness(v, v.videoWidth, v.videoHeight);
    } else if (w.type === 'image' && w.image) {
      const img = await new Promise((ok, fail) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload = () => ok(i);
        i.onerror = fail;
        i.src = w.image;
      });
      b = topBrightness(img, img.naturalWidth, img.naturalHeight);
    } else if (w.type === 'gradient') b = (hexLum(w.gradientFrom) + hexLum(w.gradientTo)) / 2;
    else if (w.type === 'color') b = hexLum(w.color);
  } catch {
    b = null;
  }
  if (seq !== toneSeq) return;
  // (dimming darkens it too)
  if (b !== null) b *= 1 - (w.dim || 0);
  document.documentElement.dataset.tone = b === null ? '' : b < 0.5 ? 'dark' : 'light';
}

// ---------- automatic colours ----------
// With "Tự lấy màu theo hình nền" on, the interface takes its colours from the wallpaper: a small copy
// of it gives its main tone and its liveliest colour, and theme.js makes light or dark colours of them.
let autoSeq = 0;
export async function autoColors() {
  if (!S.settings.appearance.autoColor) return;
  const seq = ++autoSeq;
  const pal = await wallpaperPalette().catch(() => null);
  if (!pal || seq !== autoSeq) return;
  const cur = S.settings.appearance.auto;
  if (cur?.base === pal.base && cur?.accent === pal.accent) return;
  invoke('settings_set', { patch: { appearance: { auto: pal } } });
}

async function wallpaperPalette() {
  const w = S.settings.wallpaper;
  const v = $('#wall-video');
  if (videoInPage(w)) {
    const c = await videoStill(w.video);
    return paletteOf(c, c.width, c.height);
  }
  if (w.type === 'video' && !v.hidden) {
    if (v.readyState < 2) await new Promise((ok) => v.addEventListener('loadeddata', ok, { once: true }));
    return paletteOf(v, v.videoWidth, v.videoHeight);
  }
  if (w.type === 'image' && w.image) {
    const img = await new Promise((ok, fail) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => ok(i);
      i.onerror = fail;
      i.src = w.image;
    });
    return paletteOf(img, img.naturalWidth, img.naturalHeight);
  }
  if (w.type === 'gradient') return { base: w.gradientFrom, accent: w.gradientTo };
  if (w.type === 'color') return { base: w.color, accent: S.settings.appearance.accent };
  return null;
}

function paletteOf(src, w, h) {
  if (!w || !h) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, 48, 48);
  const px = g.getImageData(0, 0, 48, 48).data;
  // colours grouped coarsely (16 steps a channel): the biggest group that is neither near black nor
  // near white is the main tone; the liveliest, weighted by how much of it there is, the accent
  const groups = new Map();
  for (let i = 0; i < px.length; i += 4) {
    const key = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
    const e = groups.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += px[i];
    e.g += px[i + 1];
    e.b += px[i + 2];
    groups.set(key, e);
  }
  const hex = (e) => '#' + [e.r, e.g, e.b].map((v) => Math.round(v / e.n).toString(16).padStart(2, '0')).join('');
  const list = [...groups.values()].map((e) => {
    const x = hex(e);
    const [, s, l] = rgbToHsl(x);
    return { hex: x, n: e.n, s, l };
  });
  const byCount = [...list].sort((a, b) => b.n - a.n);
  const base = (byCount.find((x) => x.l > 0.12 && x.l < 0.9) || byCount[0]).hex;
  const lively = list.filter((x) => x.s > 0.3 && x.l > 0.25 && x.l < 0.8).sort((a, b) => b.n * b.s - a.n * a.s)[0];
  return { base, accent: lively ? lively.hex : base };
}
