// The music's spectrum along the foot of the wallpaper (from TyranWeb; Settings → Trang Tab mới,
// newtab.visualizer): bars drawn from the wallpaper's own music files as they play, over the
// wallpaper and under the pages, seen wherever the wallpaper is (the new tab page, Lobby mode).
import { S, on } from './state.js';
import { spectrum, musicPlaying } from './music.js';

let canvas = null;
let raf = 0;
let data = null;
const BARS = 64;
const levels = new Float32Array(BARS);

function draw() {
  raf = 0;
  if (!canvas || canvas.hidden) return;
  const an = spectrum();
  const w = (canvas.width = Math.round(canvas.clientWidth * devicePixelRatio));
  const h = (canvas.height = Math.round(canvas.clientHeight * devicePixelRatio));
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, w, h);
  if (an) {
    data ||= new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(data);
  }
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3d7bea';
  const gap = 3 * devicePixelRatio;
  const bw = (w - gap * (BARS - 1)) / BARS;
  for (let i = 0; i < BARS; i++) {
    // (low notes spread over more bars than high ones, as the ear hears them)
    const from = Math.floor(Math.pow(i / BARS, 1.7) * (data ? data.length * 0.75 : 0));
    const to = Math.max(from + 1, Math.floor(Math.pow((i + 1) / BARS, 1.7) * (data ? data.length * 0.75 : 0)));
    let v = 0;
    if (data && musicPlaying()) for (let k = from; k < to; k++) v = Math.max(v, data[k] / 255);
    levels[i] = Math.max(v, levels[i] * 0.9);
    const bh = Math.max(2 * devicePixelRatio, levels[i] * h);
    g.globalAlpha = 0.35 + levels[i] * 0.55;
    g.fillStyle = accent;
    const x = i * (bw + gap);
    g.beginPath();
    g.roundRect(x, h - bh, bw, bh, Math.min(bw / 2, 4 * devicePixelRatio));
    g.fill();
  }
  raf = requestAnimationFrame(draw);
}

function apply() {
  const want = !!S.settings.newtab?.visualizer && (document.body.classList.contains('newtab-active') || S.lobby);
  canvas.hidden = !want;
  if (want && !raf) raf = requestAnimationFrame(draw);
}

export function initVisualizer() {
  canvas = document.createElement('canvas');
  canvas.id = 'visualizer';
  canvas.hidden = true;
  document.getElementById('wallpaper').append(canvas);
  on('settings', apply);
  on('music', apply);
  new MutationObserver(apply).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  apply();
}
