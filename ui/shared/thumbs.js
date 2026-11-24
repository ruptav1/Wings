// Small pictures of the user's wallpapers, drawn once from the file itself and kept by the browser
// (wallpapers/thumbs): a grid of 4K pictures or of videos would otherwise decode every one of them.
import { invoke } from './api.js';

const W = 384;
const queue = [];
let running = 0;

function draw(src, w, h) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = Math.max(1, Math.round((W * h) / w)) || 216;
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.82));
}

function fromImage(url) {
  return new Promise((ok, fail) => {
    const i = new Image();
    i.crossOrigin = 'anonymous'; // (served by unk.localhost with CORS: the canvas stays readable)
    i.onload = () => draw(i, i.naturalWidth, i.naturalHeight).then(ok, fail);
    i.onerror = fail;
    i.src = url;
  });
}

function fromVideo(url) {
  return new Promise((ok, fail) => {
    const v = document.createElement('video');
    v.muted = true;
    v.crossOrigin = 'anonymous';
    v.preload = 'auto';
    const done = (r) => {
      v.removeAttribute('src');
      v.load();
      r();
    };
    v.onloadedmetadata = () => (v.currentTime = Math.min(1.5, (v.duration || 3) / 3));
    v.onseeked = () => draw(v, v.videoWidth, v.videoHeight).then((b) => done(() => ok({ blob: b, meta: { width: v.videoWidth, height: v.videoHeight, duration: v.duration } })), (e) => done(() => fail(e)));
    v.onerror = () => done(() => fail(new Error('video')));
    setTimeout(() => done(() => fail(new Error('timeout'))), 15000);
    v.src = url;
  });
}

async function make(w) {
  if (w.kind === 'video') {
    const { blob, meta } = await fromVideo(w.url);
    if (!w.width || !w.duration) Object.assign(w, await invoke('wallpaper_meta', { name: w.name, patch: meta }).catch(() => meta));
    return blob;
  }
  return fromImage(w.url);
}

/** The wallpaper's small picture: its address now, or once it has been drawn (`then`). */
// (one drawing per file, however often a page redraws its grid while it is made)
const made = new Map(); // name → its small picture
const waiting = new Map(); // name → who wants it
const failed = new Set();

export function thumbOf(w, then) {
  if (w.thumb) return w.thumb;
  if (made.has(w.name)) return made.get(w.name);
  if (failed.has(w.name)) return '';
  if (waiting.has(w.name)) {
    waiting.get(w.name).push(then);
    return '';
  }
  waiting.set(w.name, [then]);
  queue.push(w);
  pump();
  return '';
}

function pump() {
  while (running < 2 && queue.length) {
    const w = queue.shift();
    running++;
    make(w)
      .then(async (blob) => {
        if (!blob) throw new Error('no picture');
        const url = await invoke('wallpaper_thumb', new Uint8Array(await blob.arrayBuffer()), { headers: { 'x-name': encodeURIComponent(w.name) } });
        w.thumb = url;
        made.set(w.name, url);
        for (const cb of waiting.get(w.name) || []) cb?.(url, w);
      })
      .catch(() => failed.add(w.name))
      .finally(() => {
        waiting.delete(w.name);
        running--;
        pump();
      });
  }
}
