// Ming logo concepts (logo-design skill, phase 4: built in black first, on a 256 grid, unit 8).
//   node gecko/branding/concepts/concepts.mjs      -> a-sakura.svg, b-petal-m.svg, c-beret.svg (+ -tile colour hints)
// A  Sakura aperture: five notched petals, each turned 12° about its own base like the blades of an aperture,
//    round a solid heart: the wallpaper's flower, in motion, and a window into the web.
// B  Petal m: a lowercase m whose two arches are two petals, each with the sakura notch at its top.
// C  Beret bloom: the wallpaper's beret as one flat silhouette, its flower cut through it, the ribbon below.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const f = (n) => Math.round(n * 100) / 100;
const rad = (d) => (d * Math.PI) / 180;
const rot = (p, deg, c = { x: 0, y: 0 }) => {
  const a = rad(deg), s = Math.sin(a), k = Math.cos(a);
  return { x: c.x + (p.x - c.x) * k - (p.y - c.y) * s, y: c.y + (p.x - c.x) * s + (p.y - c.y) * k };
};
// a path given as segments of absolute points ([ 'M', p ], [ 'L', p ], [ 'C', p1, p2, p ], [ 'A', r, large, sweep, p ])
const pathOf = (segs, map = (p) => p) =>
  segs
    .map((s) => {
      const P = (p) => { const q = map(p); return `${f(q.x)},${f(q.y)}`; };
      if (s[0] === 'Z') return 'Z';
      if (s[0] === 'A') return `A${f(s[1])},${f(s[1])} 0 ${s[2]},${s[3]} ${P(s[4])}`;
      return s[0] + s.slice(1).map(P).join(' ');
    })
    .join('');
const svg = (body, note) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <title>Ming logo</title>
  <!-- ${note} -->
${body}
</svg>
`;

// ---------------------------------------------------------------- the notched petal (unit: tip at y = -1)
// base at the centre's side, widening to two round lobes, the notch between them (the wallpaper flower's)
// (v2: a fan rather than a heart: narrow at the base, broad and nearly flat at the top, a shallow notch)
const PETAL = [
  ['M', { x: 0, y: -0.2 }],
  ['C', { x: 0.14, y: -0.24 }, { x: 0.38, y: -0.6 }, { x: 0.38, y: -0.86 }],
  ['C', { x: 0.38, y: -0.96 }, { x: 0.24, y: -1.0 }, { x: 0.1, y: -0.99 }],
  ['L', { x: 0, y: -0.92 }],
  ['L', { x: -0.1, y: -0.99 }],
  ['C', { x: -0.24, y: -1.0 }, { x: -0.38, y: -0.96 }, { x: -0.38, y: -0.86 }],
  ['C', { x: -0.38, y: -0.6 }, { x: -0.14, y: -0.24 }, { x: 0, y: -0.2 }],
  ['Z'],
];
const petalAt = (cx, cy, R, deg, spin = 0) =>
  pathOf(PETAL, (p) => {
    // (spun about its own base, then turned into place round the centre)
    const q = rot(p, spin, { x: 0, y: -0.2 });
    const r = rot(q, deg);
    return { x: cx + r.x * R, y: cy + r.y * R };
  });

// ---------------------------------------------------------------- A: sakura aperture
// centre (128,128); petals R = 112 (base at 22, tips at 112), turned 72° apart, each spun 12°; heart r = 16
function sakura(fill = '#000', heart = fill) {
  // (v2: spun 22°, so the turn of an aperture shows)
  const petals = [0, 1, 2, 3, 4].map((i) => petalAt(128, 130, 112, i * 72, 22)).join('');
  return `  <path fill="${fill}" d="${petals}"/>
  <circle cx="128" cy="130" r="16" fill="${heart}"/>`;
}

// ---------------------------------------------------------------- B: petal m
// stems 32 wide, counters 32, baseline 192, arch centres at y 120 (outer r 48, inner r 16): two humps
// 48–144 and 112–208 sharing the middle stem 112–144; at each hump's top a notch 12 each side, 14 deep
function hump(x0, x1) {
  const xc = (x0 + x1) / 2, R = 48, r = 16, cy = 120, n = 12;
  const ny = cy - Math.sqrt(R * R - n * n);
  return pathOf([
    ['M', { x: x0, y: 192 }],
    ['L', { x: x0, y: cy }],
    ['A', R, 0, 1, { x: xc - n, y: ny }],
    ['L', { x: xc, y: ny + 14 }],
    ['L', { x: xc + n, y: ny }],
    ['A', R, 0, 1, { x: x1, y: cy }],
    ['L', { x: x1, y: 192 }],
    ['L', { x: x1 - 32, y: 192 }],
    ['L', { x: x1 - 32, y: cy }],
    ['A', r, 0, 0, { x: x0 + 32, y: cy }],
    ['L', { x: x0 + 32, y: 192 }],
    ['Z'],
  ]);
}
function petalM(fill = '#000') {
  return `  <path fill="${fill}" d="${hump(48, 144)}${hump(112, 208)}"/>`;
}
// B v2 - m & sakura: the soft m of Ming's first logo (two round arches, round ends: stems 32, arches r 48 /
// inner r 16, x 32–192, baseline 200) with the wallpaper's flower where the moon was (top right, R 40)
function mSakura(fill = '#000', flowerFill = fill, heart = null) {
  // (an arch without a notch, its stems ending round: outer r 48, inner r 16, centre y 132, stems to y 204)
  const arch = (x0, x1) => {
    const cy = 132, base = 204;
    return pathOf([
      ['M', { x: x0, y: base }],
      ['L', { x: x0, y: cy }],
      ['A', 48, 0, 1, { x: x1, y: cy }],
      ['L', { x: x1, y: base }],
      ['A', 16, 0, 1, { x: x1 - 32, y: base }],
      ['L', { x: x1 - 32, y: cy }],
      ['A', 16, 0, 0, { x: x0 + 32, y: cy }],
      ['L', { x: x0 + 32, y: base }],
      ['A', 16, 0, 1, { x: x0, y: base }],
      ['Z'],
    ]);
  };
  const flower = [0, 1, 2, 3, 4].map((i) => petalAt(214, 66, 36, 10 + i * 72)).join('');
  // (centred: the m and its flower together, a touch above the middle)
  return `<g transform="translate(-5,2)">
  <path fill="${fill}" d="${arch(16, 112)}${arch(80, 176)}"/>
  <path fill="${flowerFill}" d="${flower}"/>${heart ? `\n  <circle cx="214" cy="67" r="6" fill="${heart}"/>` : ''}
</g>`;
}

// ---------------------------------------------------------------- C: beret bloom
// the beret and ribbon of the present icon (drawn on a 1024 tile), flattened to one silhouette, the flower a
// hole through the beret (even-odd), all fitted into the 256 square with a 16 margin
function beret(fill = '#000') {
  const B = (p) => { const q = rot(p, -12); return { x: q.x + 470, y: q.y + 455 }; };
  const dome = [['M', { x: -320, y: 40 }], ['C', { x: -340, y: -90 }, { x: -180, y: -205 }, { x: 20, y: -200 }], ['C', { x: 240, y: -195 }, { x: 370, y: -80 }, { x: 342, y: 40 }], ['C', { x: 322, y: 118 }, { x: 196, y: 146 }, { x: 0, y: 146 }], ['C', { x: -196, y: 146 }, { x: -312, y: 118 }, { x: -320, y: 40 }], ['Z']];
  // (v2: the stalk a shape of its own, so it does not cut a sliver out of the dome where they overlap)
  const nub = [['M', { x: -13, y: -186 }], ['L', { x: -13, y: -219 }], ['A', 13, 0, 1, { x: 13, y: -219 }], ['L', { x: 13, y: -186 }], ['Z']];
  const Rb = (p) => { const q = rot(p, 12); return { x: q.x + 590, y: q.y + 540 }; }; // (v2: hanging under the flower)
  const tails = [
    [['M', { x: 2, y: 0 }], ['C', { x: 34, y: 96 }, { x: 30, y: 192 }, { x: 64, y: 292 }], ['C', { x: 68, y: 306 }, { x: 80, y: 310 }, { x: 92, y: 304 }], ['L', { x: 104, y: 298 }], ['C', { x: 76, y: 196 }, { x: 86, y: 96 }, { x: 44, y: -8 }], ['Z']],
    [['M', { x: 14, y: 0 }], ['C', { x: -8, y: 108 }, { x: -54, y: 190 }, { x: -46, y: 284 }], ['C', { x: -45, y: 298 }, { x: -36, y: 305 }, { x: -24, y: 304 }], ['L', { x: -8, y: 302 }], ['C', { x: -18, y: 204 }, { x: 28, y: 110 }, { x: 54, y: 8 }], ['Z']],
  ];
  // (v2: the flower wholly inside the dome, so the even-odd cut is clean; its heart left solid)
  const fx = 560, fy = 420, fr = 118;
  const flower = [0, 1, 2, 3, 4].map((i) => petalAt(fx, fy, fr, 8 + i * 72)).join('');
  // fit: the drawing spans about x 150–800, y 245–870 on the 1024 tile
  const k = 224 / 650, ox = 16 - 150 * k + (224 - 650 * k) / 2, oy = 16 - 245 * k + (224 - 625 * k) / 2;
  const T = (p) => ({ x: ox + p.x * k, y: oy + p.y * k });
  const hc = T({ x: fx, y: fy }), hr = 22 * k;
  const heart = pathOf([['M', { x: hc.x - hr, y: hc.y }], ['A', hr, 1, 0, { x: hc.x + hr, y: hc.y }], ['A', hr, 1, 0, { x: hc.x - hr, y: hc.y }], ['Z']]);
  const domeD = pathOf(dome, (p) => T(B(p)));
  const nubD = pathOf(nub, (p) => T(B(p)));
  // (the flower's petals in the 1024 space, then fitted: one even-odd path cuts them out of the dome)
  const flowerD = flower.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (m, x, y) => { const q = T({ x: +x, y: +y }); return `${f(q.x)},${f(q.y)}`; }).replace(/A(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)/g, (m, a) => `A${f(a * k)},${f(a * k)}`);
  const tailsD = tails.map((t) => pathOf(t, (p) => T(Rb(p)))).join('');
  return `  <path fill="${fill}" fill-rule="evenodd" d="${domeD}${flowerD}"/>
  <path fill="${fill}" d="${nubD}${heart}${tailsD}"/>`;
}

const out = (name, body, note) => fs.writeFileSync(path.join(here, name), svg(body, note));
out('a-sakura.svg', sakura(), 'A - Sakura aperture: five notched petals spun like aperture blades round a heart');
out('b-petal-m.svg', mSakura(), 'B - m & sakura: the soft m of the first logo, the wallpaper flower where the moon was');
out('c-beret.svg', beret(), 'C - Beret bloom: the beret as one silhouette, its flower cut through it, the ribbon below');
console.log('written: a-sakura.svg b-petal-m.svg c-beret.svg');
