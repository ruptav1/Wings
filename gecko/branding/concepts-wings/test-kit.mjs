// Phase 7 refinement & colour study for Wings Concept B (Soyoku Kamon).
// Tests:
//   1. Standard cut vs Small cut (16-32 px) vs Thinned Reversed cut (white on dark)
//   2. Three wallpaper-derived colourways (wings-default.jpg):
//      - C1: Crimson-Rose tile + Pure White & Ice-Pearl (#DCEAF8) twin wings; Symbol #A41154 + #D6578D
//      - C2: Crimson-Rose tile + Pure White & Sakura-Pearl (#FBDCEB) twin wings; Symbol #A41154 + #D6578D
//      - C3: Deep Crimson-Rose tile + Pure White twin wings; Symbol pure #A41154
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const f = (n) => Math.round(n * 100) / 100;

function rotate180(d, cx = 128, cy = 128) {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) || [];
  let out = '';
  let i = 0;
  let cmd = '';
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) {
      cmd = tokens[i++];
      out += cmd;
      if (cmd === 'Z' || cmd === 'z') continue;
    }
    const pair = () => {
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);
      return `${f(2 * cx - x)},${f(2 * cy - y)}`;
    };
    if (cmd === 'M' || cmd === 'L') out += pair() + ' ';
    else if (cmd === 'Q') out += pair() + ' ' + pair() + ' ';
    else if (cmd === 'C') out += pair() + ' ' + pair() + ' ' + pair() + ' ';
  }
  return out.trim();
}

// Standard cut (>= 40 px): immaculate v6 Soyoku Kamon
const WING_STD = [
  'M 68,62',
  'C 86,34 110,22 136,22',
  'C 188,22 230,62 230,114',
  'C 230,144 220,168 204,184',
  'C 208,160 207,136 203,114',
  'C 194,72 158,47 110,48',
  'C 100,48 100,63 110,63',
  'C 150,62 183,83 188,116',
  'C 190,131 187,144 180,154',
  'C 178,132 173,112 162,98',
  'C 148,80 120,74 92,80',
  'C 76,83 62,72 68,62 Z',
].join(' ');

// Small cut (16-32 px): engineered for razor-sharp pixel clarity!
// - Outer radius pushed gently to 234 (fuller silhouette)
// - Primary plume bold (~28u), inner air-channel opened wide to 22u (y=48..70!)
// - Secondary plume crisp (~20u) tucked smoothly around a clear open center sky (r≈38)
// - Diagonal breeze gap kept open & clean (~24u)
const WING_SMALL = [
  'M 68,58',
  'C 86,30 112,18 138,18',
  'C 192,18 234,58 234,114',
  'C 234,146 224,170 206,188',
  'C 210,162 208,136 204,114',
  'C 194,70 158,46 112,47',
  'C 98,47 98,69 112,69',
  'C 148,68 179,86 184,118',
  'C 186,132 183,145 175,155',
  'C 173,134 167,114 156,101',
  'C 144,86 118,82 90,86',
  'C 72,88 60,72 68,58 Z',
].join(' ');

// Reversed cut (white on dark): thinned ~3% optically to counteract irradiation
// Outer arch inset ~1.5u, air-channel widened 15u -> 17u, inner sky opened ~1.5u
const WING_REV = [
  'M 70,63',
  'C 87,36 111,24 136,24',
  'C 187,24 228,63 228,114',
  'C 228,143 218,167 203,182',
  'C 207,159 206,136 202,114',
  'C 193,73 158,48 111,48',
  'C 100,48 100,65 111,65',
  'C 150,64 182,84 187,116',
  'C 189,130 186,143 179,153',
  'C 177,131 172,112 161,98',
  'C 147,81 120,76 93,81',
  'C 77,84 64,73 70,63 Z',
].join(' ');

function tileSvg({ w1, w2, small = false, c1 = '#FFFFFF', c2 = '#FFFFFF', bg0 = '#9C1450', bg1 = '#C4467F', bg2 = '#E08AAE' }) {
  const s = small ? 3.15 : 2.95;
  const o = f((1024 - 256 * s) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0.1" y1="1" x2="0.9" y2="0"><stop offset="0" stop-color="${bg0}"/><stop offset="0.55" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="236" fill="url(#bg)"/>
  <g transform="translate(${o},${o}) scale(${s})">
    <path fill="${c1}" d="${w1}"/>
    <path fill="${c2}" d="${w2}"/>
  </g>
</svg>`;
}

function symSvg({ w1, w2, c1, c2 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <path fill="${c1}" d="${w1}"/>
  <path fill="${c2}" d="${w2}"/>
</svg>`;
}

const W1 = WING_STD, W2 = rotate180(WING_STD);
const S1 = WING_SMALL, S2 = rotate180(WING_SMALL);
const R1 = WING_REV, R2 = rotate180(WING_REV);

const outDir = path.join(here, 'color-study');
fs.mkdirSync(outDir, { recursive: true });

// Save SVGs for inspection & audit
fs.writeFileSync(path.join(outDir, 'small-black.svg'), symSvg({ w1: S1, w2: S2, c1: '#000000', c2: '#000000' }));
fs.writeFileSync(path.join(outDir, 'rev-white.svg'), symSvg({ w1: R1, w2: R2, c1: '#FFFFFF', c2: '#FFFFFF' }));

// Three colourways
const studies = [
  { id: 'c1-ice',   label: 'C1 · White + Ice-Pearl (#DCEAF8)',   t1: '#FFFFFF', t2: '#DCEAF8', s1: '#A41154', s2: '#D4528A', bg: ['#9C1450', '#C4467F', '#E08AAE'] },
  { id: 'c2-blush', label: 'C2 · White + Sakura-Pearl (#FCE0EC)', t1: '#FFFFFF', t2: '#FCE0EC', s1: '#A41154', s2: '#D4528A', bg: ['#9C1450', '#C4467F', '#E08AAE'] },
  { id: 'c3-pure',  label: 'C3 · Pure White + Flat Crimson',     t1: '#FFFFFF', t2: '#FFFFFF', s1: '#A41154', s2: '#A41154', bg: ['#96104C', '#C23C79', '#DF84AA'] },
];

for (const st of studies) {
  fs.writeFileSync(path.join(outDir, `${st.id}-tile.svg`), tileSvg({ w1: W1, w2: W2, c1: st.t1, c2: st.t2, bg0: st.bg[0], bg1: st.bg[1], bg2: st.bg[2] }));
  fs.writeFileSync(path.join(outDir, `${st.id}-tile-small.svg`), tileSvg({ w1: S1, w2: S2, small: true, c1: st.t1, c2: st.t2, bg0: st.bg[0], bg1: st.bg[1], bg2: st.bg[2] }));
  fs.writeFileSync(path.join(outDir, `${st.id}-sym.svg`), symSvg({ w1: W1, w2: W2, c1: st.s1, c2: st.s2 }));
}

// Build a compact visual comparison HTML board (at 16, 18, 24, 32, 64, 160 px + light/dark UI bar mock!)
const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><style>
body{margin:0;padding:32px;font-family:"Segoe UI",system-ui,sans-serif;background:#f5f4f2;color:#1a1a1f}
h1{margin:0 0 6px;font-size:22px} p.sub{margin:0 0 24px;color:#666;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:24px}
.card{background:#fff;border:1px solid #e5e3df;border-radius:16px;padding:20px}
.card h2{margin:0 0 14px;font-size:14px}
.row{display:flex;align-items:center;gap:14px;margin:12px 0;flex-wrap:wrap}
.dark{background:#1d1e28;padding:12px 14px;border-radius:12px;color:#fff}
.lbl{font-size:11px;color:#777;text-align:center;margin-top:4px}
.dark .lbl{color:#aaa}
.item{display:flex;flex-direction:column;align-items:center}
.pixel img{image-rendering:pixelated}
</style></head><body>
<h1>Wings (Sōyoku Kamon) — Kiểm thử bản cỡ nhỏ & 3 phương án phối màu từ hình nền</h1>
<p class="sub">So sánh 160 / 56 / 32 / 24 / 18 / 16 px trên nền sáng và nền tối (thanh tiêu đề thực tế của Wings là 18 px, Settings là 24 px & 56 px)</p>
<div class="grid">
${studies.map(st => {
  const tile = fs.readFileSync(path.join(outDir, `${st.id}-tile.svg`), 'utf8');
  const tileS = fs.readFileSync(path.join(outDir, `${st.id}-tile-small.svg`), 'utf8');
  const sym = fs.readFileSync(path.join(outDir, `${st.id}-sym.svg`), 'utf8');
  const u = (s) => 'data:image/svg+xml;utf8,' + encodeURIComponent(s);
  return `<div class="card">
    <h2>${st.label}</h2>
    <div class="row">
      <div class="item"><img src="${u(tile)}" width="128" height="128"><div class="lbl">App tile 128</div></div>
      <div class="item"><img src="${u(sym)}" width="96" height="96"><div class="lbl">Symbol 96</div></div>
    </div>
    <div class="row">
      <div class="item"><img src="${u(tile)}" width="56" height="56"><div class="lbl">56 (About)</div></div>
      <div class="item"><img src="${u(tileS)}" width="32" height="32"><div class="lbl">32 small</div></div>
      <div class="item"><img src="${u(tileS)}" width="24" height="24"><div class="lbl">24 small</div></div>
      <div class="item"><img src="${u(tileS)}" width="18" height="18"><div class="lbl">18 bar</div></div>
      <div class="item"><img src="${u(tileS)}" width="16" height="16"><div class="lbl">16 ico</div></div>
    </div>
    <div class="row dark">
      <div class="item"><img src="${u(tile)}" width="48" height="48"><div class="lbl">48 dark</div></div>
      <div class="item"><img src="${u(tileS)}" width="24" height="24"><div class="lbl">24 dark</div></div>
      <div class="item"><img src="${u(tileS)}" width="18" height="18"><div class="lbl">18 dark</div></div>
      <div class="item"><img src="${u(tileS)}" width="16" height="16"><div class="lbl">16 dark</div></div>
      <div class="item"><img src="${u(symSvg({w1:R1,w2:R2,c1:'#FFFFFF',c2:st.t2}))}" width="48" height="48"><div class="lbl">Reversed</div></div>
    </div>
  </div>`;
}).join('')}
</div>
</body></html>`;
fs.writeFileSync(path.join(outDir, 'study.html'), html);
console.log('written color study');
