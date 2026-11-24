// Wings' logo, drawn from numbers.
//   node gecko/branding/make-logo.mjs [soyoku|sakura|beret|m|blade|feather|facet] [out.svg]   (default: soyoku)
// soyoku:  "Sōyoku Kamon" (the logo in use; designed with the logo-design skill, see branding/GUIDE.md):
//          twin two-tiered graceful wings in 180° rotational harmony embracing a serene circular portal in
//          Japanese kamon spirit. White (#FFFFFF) and ice-pearl (#E4F1FD) — echoing the soaring wings of the
//          default wallpaper — on a bright sakura-rose tile (#D43B7E → #EE75AA → #FBBAD5) for the app icon
//          (branding/wings.svg; branding/wings-small.svg opens the air-channel for 16–32 px), and flat-colour
//          symbol versions in branding/kit/ (crimson/rose, black, reversed thinned ~3%, small);
// sakura:  "Sakura aperture" (the previous Ming/Wings flower mark): five notched petals spun 22° like aperture
//          blades round a pink heart;
// beret:   the default wallpaper's own things in its own colours, drawn clean and modern:
//          the black beret with its white five-petal flower and ribbon, the pale blades fanning up behind it,
//          on a ground that runs from crimson low on the left to white at the top right, as the picture does;
// m:       a soft lowercase "m" of two white hills, a warm moon rising beside them, on violet to cyan;
// the others are one tech wing in white, its parts parted by grooves cut through to the background, on
// pink-to-purple:
// blade:   straight plates stacked in layers, rising from the tile's bottom-left corner (and running off it),
//          a narrow bar along the leading edge; the groove under the first plate opens into an eye;
// feather: curved pointed feathers laid over each other into one wing;
// facet:   one sharp wing cut into angular panels, like a machined part.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const style = process.argv[2] || 'soyoku';
const out = process.argv[3] || path.join(here, 'wings.svg');
const GROOVE = 17; // (in the final 1024 units)
const f = (n) => Math.round(n * 10) / 10;
const rad = (d) => (d * Math.PI) / 180;
const pts = (list) => list.map((p) => `${f(p.x)},${f(p.y)}`).join(' ');

const DEFS = `<linearGradient id="bg" x1="0.05" y1="0" x2="0.95" y2="1">
      <stop offset="0" stop-color="#ff86b6"/>
      <stop offset="0.46" stop-color="#df3f80"/>
      <stop offset="1" stop-color="#8a3dbb"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.26" cy="0.1" r="0.85">
      <stop offset="0" stop-color="#fff" stop-opacity="0.36"/>
      <stop offset="0.55" stop-color="#fff" stop-opacity="0.05"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <filter id="lift" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#4a0a3a" flood-opacity="0.35"/>
    </filter>`;
const TILE = `<rect width="1024" height="1024" rx="236" fill="url(#bg)"/>
  <rect width="1024" height="1024" rx="236" fill="url(#glow)"/>`;
const NOTE = `<!-- Wings: one tech wing in white (${style}), its parts parted by grooves cut through to the background,
       on the pink-to-purple of the default wallpaper (made by make-logo.mjs) -->`;

// ---------------------------------------------------------------- beret: the wallpaper's own things
// Drawn clean and modern: few shapes, smooth gradients, room round them. The colours come from the
// picture: crimson #a41154, rose #d3779f, the blades' pale blue #c4d3e7, the beret's navy #363849.

// a sleek blade (the picture's pale bony blades, simplified): a clean taper along a gentle curve, from its
// root along heading a (degrees up from the horizontal), bent `bend` degrees clockwise along its length
function sleek(x, y, a, len, w, bend) {
  const N = 36;
  const sp = [];
  let p = { x, y };
  for (let i = 0; i <= N; i++) {
    const t = i / N, h = rad(a - bend * t);
    sp.push({ ...p, h, t });
    p = { x: p.x + (Math.cos(h) * len) / N, y: p.y - (Math.sin(h) * len) / N };
  }
  // (rounded at the root, a long fine point)
  const width = (t) => w * Math.sin(Math.min(1, t / 0.12) * (Math.PI / 2)) * (1 - t) ** 1.1 + w * 0.15 * (1 - t);
  const side = (s) => sp.map(({ x, y, h, t }) => ({ x: x + Math.sin(h) * width(t) * s, y: y + Math.cos(h) * width(t) * s }));
  return `<path d="M${[...side(-1), ...side(1).reverse()].map((q) => `${f(q.x)},${f(q.y)}`).join('L')}Z"/>`;
}

function beretSvg() {
  // the flower of the hat, flat: five rounded notched petals, a little shade at their bases, a pink heart
  const R = 160, rot = 8;
  const petal = 'M0,0C0.34,-0.08 0.56,-0.5 0.40,-0.86Q0.33,-1.02 0.15,-0.98L0,-0.86L-0.15,-0.98Q-0.33,-1.02 -0.40,-0.86C-0.56,-0.5 -0.34,-0.08 0,0Z';
  const each = (d) => [0, 1, 2, 3, 4].map((i) => `<path d="${d}" transform="rotate(${rot + i * 72}) scale(${R})"/>`).join('');
  // the blades: a fan rising to the top right from behind the beret, as in the picture
  const blades = [18, 32, 46, 60, 74].map((a, i) => sleek(600 - i * 10, 470 + i * 4, a, 520 - Math.abs(i - 2) * 30, 30, 10)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <!-- Wings: the default wallpaper's own things in its colours, drawn clean (beret) - the black beret with its
       white flower and ribbon, the pale blades fanning behind, on crimson turning to white (made by make-logo.mjs) -->
  <defs>
    <linearGradient id="bg" x1="0.05" y1="0.95" x2="0.95" y2="0.05"><stop offset="0" stop-color="#a8195a"/><stop offset="0.38" stop-color="#d9709f"/><stop offset="0.72" stop-color="#f6d3e2"/><stop offset="1" stop-color="#fdf6fa"/></linearGradient>
    <radialGradient id="glow" cx="0.85" cy="0.1" r="0.6"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="blade" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#f4f8fd"/><stop offset="1" stop-color="#aec2df"/></linearGradient>
    <linearGradient id="navy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4d6a"/><stop offset="1" stop-color="#25263a"/></linearGradient>
    <linearGradient id="petal" x1="0" y1="-1" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f2f5fb"/></linearGradient>
    <radialGradient id="heart"><stop offset="0" stop-color="#ff8db0"/><stop offset="1" stop-color="#e2507f"/></radialGradient>
    <clipPath id="tile"><rect width="1024" height="1024" rx="236"/></clipPath>
    <filter id="lift" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="22" stdDeviation="26" flood-color="#5a0a32" flood-opacity=".3"/></filter>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#5a0a32" flood-opacity=".18"/></filter>
  </defs>
  <g clip-path="url(#tile)">
    <rect width="1024" height="1024" fill="url(#bg)"/>
    <rect width="1024" height="1024" fill="url(#glow)"/>
    <g fill="url(#blade)" filter="url(#soft)">${blades}</g>
    <g transform="translate(470,455) rotate(-12)" filter="url(#lift)">
      <path d="M-320,40C-340,-90 -180,-205 20,-200C240,-195 370,-80 342,40C322,118 196,146 0,146C-196,146 -312,118 -320,40Z" fill="url(#navy)"/>
      <path d="M-262,-6C-236,-104 -120,-166 30,-164C150,-162 238,-118 282,-52C190,-112 64,-128 -50,-110C-150,-94 -220,-56 -262,-6Z" fill="#fff" opacity=".1"/>
      <path d="M-298,92C-146,146 156,146 312,84C304,130 170,164 0,164C-170,164 -290,134 -298,92Z" fill="#1e1f2e" opacity=".9"/>
      <rect x="-13" y="-232" width="26" height="40" rx="13" fill="#3d4058"/>
    </g>
    <g transform="translate(694,560) rotate(12)" fill="url(#navy)">
      <path d="M2,0C34,96 30,192 64,292Q72,312 92,304L104,298C76,196 86,96 44,-8Z"/>
      <path d="M14,0C-8,108 -54,190 -46,284Q-44,306 -24,304L-8,302C-18,204 28,110 54,8Z"/>
    </g>
    <g transform="translate(694,462)" filter="url(#soft)">
      <g fill="url(#petal)">${each(petal)}</g>
      <g fill="#e3e9f4">${each('M0,0C0.10,-0.08 0.13,-0.3 0.06,-0.46L0,-0.36Z')}</g>
      <circle r="${f(R * 0.17)}" fill="url(#heart)"/>
      <circle r="${f(R * 0.06)}" cx="${f(-R * 0.04)}" cy="${f(-R * 0.04)}" fill="#fff" opacity=".85"/>
    </g>
  </g>
</svg>
`;
}

// ---------------------------------------------------------------- m: two hills and a moon
// the "m" is one stroke: up from the bottom of the left stem, over the first arch (r 130) down to the
// baseline, then from the middle stem over the second arch; the moon sits in the top-right corner
function mSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <!-- Wings: a soft lowercase "m" of two hills, a warm moon rising beside them (made by make-logo.mjs) -->
  <defs>
    <linearGradient id="bg" x1="0.08" y1="0" x2="0.92" y2="1">
      <stop offset="0" stop-color="#8b5cf6"/>
      <stop offset="0.52" stop-color="#5b6cf0"/>
      <stop offset="1" stop-color="#1ec8e8"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.28" cy="0.12" r="0.8">
      <stop offset="0" stop-color="#fff" stop-opacity="0.34"/>
      <stop offset="0.6" stop-color="#fff" stop-opacity="0.04"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="moon" cx="0.36" cy="0.32" r="0.72">
      <stop offset="0" stop-color="#fff6cf"/>
      <stop offset="1" stop-color="#ffb03d"/>
    </radialGradient>
    <filter id="lift" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#1e1650" flood-opacity="0.32"/>
    </filter>
  </defs>
  <rect width="1024" height="1024" rx="236" fill="url(#bg)"/>
  <rect width="1024" height="1024" rx="236" fill="url(#glow)"/>
  <g filter="url(#lift)">
    <path d="M252 700V458a130 130 0 0 1 260 0v242M512 458a130 130 0 0 1 260 0v242" fill="none" stroke="#fff" stroke-width="108" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="822" cy="236" r="68" fill="url(#moon)"/>
  </g>
</svg>
`;
}

// ---------------------------------------------------------------- blade: straight plates in layers
function bladeSvg() {
  const G = 16; // the gap each plate leaves round itself in the plates under it
  // a plate: from its root along heading a (degrees up from the horizontal, to the right), len long on its
  // leading edge, w wide to its trailing side (clockwise of the heading), the tip cut back on the trailing
  // side by cut degrees; it reaches `back` behind its root, off the tile
  const plate = ({ x, y, a, len, w, cut, back = 500 }) => {
    const d = { x: Math.cos(rad(a)), y: -Math.sin(rad(a)) };
    const n = { x: -d.y, y: d.x };
    const r = { x: x - d.x * back, y: y - d.y * back };
    const L = len + back;
    const short = L - w * Math.tan(rad(cut));
    const at = (t, v) => ({ x: x + d.x * t + n.x * v, y: y + d.y * t + n.y * v }); // (t from the root, v across)
    return { a, w, at, poly: [r, { x: r.x + d.x * L, y: r.y + d.y * L }, { x: r.x + n.x * w + d.x * short, y: r.y + n.y * w + d.y * short }, { x: r.x + n.x * w, y: r.y + n.y * w }] };
  };
  // the leading bar, narrow and reaching furthest
  const bar = plate({ x: -60, y: 700, a: 42, len: 1000, w: 72, cut: 60 });
  // the plates under it: each turned 7 degrees flatter, set 132 further down, shorter
  const top = bar.at(0, 88);
  const n0 = { x: Math.sin(rad(38)), y: Math.cos(rad(38)) };
  const plates = [880, 760, 630, 500].map((len, i) =>
    plate({ x: top.x + n0.x * 132 * i, y: top.y + n0.y * 132 * i, a: 38 - 7 * i, len, w: 146, cut: 50 }),
  );
  // the eye: where the groove under the first plate opens into an angular almond, a diamond pupil in it
  const p = plates[0];
  const c = p.at(340, p.w + G / 2); // (on the groove's middle line)
  const L = 330, H = 146, k = L * 0.18;
  const co = Math.cos(rad(p.a)), si = -Math.sin(rad(p.a));
  const at = (u, v) => ({ x: c.x + u * co - v * si, y: c.y + u * si + v * co });
  const eye = [at(-L / 2, 0), at(-k, -H / 2), at(k, -H / 2), at(L / 2, 0), at(k, H / 2), at(-k, H / 2)];
  const pupil = [at(0, -H * 0.38), at(H * 0.21, 0), at(0, H * 0.38), at(-H * 0.21, 0)];

  // bottom plate first, the bar last (in front); each cuts its gap into those under it
  const layers = [...plates.reverse(), bar].map((l) => l.poly);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  ${NOTE}
  <defs>
    ${DEFS}
    <clipPath id="tile"><rect width="1024" height="1024" rx="236"/></clipPath>
    <mask id="wing" maskUnits="userSpaceOnUse" x="-400" y="-400" width="1824" height="1824">
      ${layers.map((l) => `<polygon points="${pts(l)}" fill="none" stroke="#000" stroke-width="${G * 2}" stroke-linejoin="miter" stroke-miterlimit="3"/>
      <polygon points="${pts(l)}" fill="#fff"/>`).join('\n      ')}
      <polygon points="${pts(eye)}" fill="#000"/>
      <polygon points="${pts(pupil)}" fill="#fff"/>
    </mask>
  </defs>
  ${TILE}
  <g clip-path="url(#tile)">
    <g filter="url(#lift)">
      <rect x="-400" y="-400" width="1824" height="1824" fill="#fff" mask="url(#wing)"/>
    </g>
  </g>
</svg>
`;
}

// ---------------------------------------------------------------- feather: curved blades
function feather() {
  // each feather: root (along the wing's bone), first heading (degrees up from the horizontal, outward),
  // how far it bends clockwise along its length, its length and widest half-width
  const F = [
    { a: 82, bend: 30, len: 1096, w: 139 },
    { a: 70, bend: 30, len: 979, w: 130 },
    { a: 58, bend: 30, len: 845, w: 122 },
    { a: 46, bend: 30, len: 697, w: 111 },
    { a: 34, bend: 30, len: 532, w: 99 },
  ].map((x, i) => ({ ...x, root: { x: 85 * i, y: 75 * i } }));
  const N = 48;
  const blades = F.map(({ a, bend, len, w, root }) => {
    // the spine: heading turns evenly from a to a-bend
    const spine = [];
    let p = { ...root };
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const h = ((a - bend * t) * Math.PI) / 180;
      spine.push({ ...p, h, t });
      p = { x: p.x + (Math.cos(h) * len) / N, y: p.y - (Math.sin(h) * len) / N };
    }
    // its width along it: full by a third, then tapering to a sharp point
    const width = (t) => (t < 0.38 ? w * (0.62 + 0.38 * Math.sin((t / 0.38) * (Math.PI / 2))) : w * Math.pow(1 - (t - 0.38) / 0.62, 1.15));
    const side = (sgn, lean) =>
      spine.map(({ x, y, h, t }) => {
        const n = { x: Math.sin(h), y: Math.cos(h) }; // across, to the lower side
        const ww = width(t) * (sgn < 0 ? 1 : lean); // (the lower half a little narrower: an asymmetric vane)
        return { x: x + n.x * ww * sgn, y: y + n.y * ww * sgn };
      });
    const upper = side(-1, 1);
    const lower = side(1, 0.8);
    return { shape: [...upper, ...lower.reverse()], lower: lower.reverse() };
  });
  // every feather but the lowest is parted from the one below along its lower edge
  return { shapes: blades.map((b) => b.shape), grooves: blades.slice(0, -1).map((b) => b.lower), fit: 800 };
}

// ---------------------------------------------------------------- facet: an angular wing in panels
function facet() {
  // the wing's outline: from the shoulder (bottom left) up the leading edge to the tip, then back down
  // the trailing edge, feather point by feather point
  const lead = [
    { x: 0, y: 0 },
    { x: 70, y: -230 },
    { x: 205, y: -440 },
    { x: 420, y: -600 }, // the tip
  ];
  const trail = [
    { x: 330, y: -455 }, // notch
    { x: 470, y: -400 }, // point
    { x: 350, y: -300 },
    { x: 470, y: -228 },
    { x: 330, y: -150 },
    { x: 425, y: -62 },
    { x: 270, y: -18 },
    { x: 330, y: 70 },
    { x: 130, y: 70 },
  ];
  const shape = [...lead, ...trail];
  // the panels: a groove a little in from the leading edge, the full length of the wing, and one from
  // each notch of the trailing edge back to it
  const along = [
    { x: 52, y: 24 },
    { x: 118, y: -200 },
    { x: 245, y: -395 },
    { x: 432, y: -536 },
  ];
  const at = (u) => {
    // a point at u (0..1) along the inner groove
    const seg = [0, 0.38, 0.72, 1];
    for (let i = 0; i < 3; i++) {
      if (u <= seg[i + 1]) {
        const k = (u - seg[i]) / (seg[i + 1] - seg[i]);
        return { x: along[i].x + (along[i + 1].x - along[i].x) * k, y: along[i].y + (along[i + 1].y - along[i].y) * k };
      }
    }
    return along[3];
  };
  const grooves = [along, [trail[0], at(0.8)], [trail[2], at(0.6)], [trail[4], at(0.4)], [trail[6], at(0.2)]];
  // (the panel by the shoulder, cut once across)
  grooves.push([at(0.07), { x: 160, y: 80 }]);
  return { shapes: [shape], grooves, fit: 640 };
}

// feather and facet: set in the middle, as large as fits with room around it
function centredSvg({ shapes, grooves, fit }) {
  const all = shapes.flat();
  const box = { x0: Math.min(...all.map((p) => p.x)), x1: Math.max(...all.map((p) => p.x)), y0: Math.min(...all.map((p) => p.y)), y1: Math.max(...all.map((p) => p.y)) };
  const k = fit / Math.max(box.x1 - box.x0, box.y1 - box.y0);
  const place = (p) => ({ x: 512 + (p.x - (box.x0 + box.x1) / 2) * k, y: 518 + (p.y - (box.y0 + box.y1) / 2) * k });
  const at = (list) => pts(list.map(place));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  ${NOTE}
  <defs>
    ${DEFS}
    <mask id="grooves" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
      <rect width="1024" height="1024" fill="#fff"/>
      <g fill="none" stroke="#000" stroke-width="${GROOVE}" stroke-linejoin="round" stroke-linecap="butt">
        ${grooves.map((g) => `<polyline points="${at(g)}"/>`).join('\n        ')}
      </g>
    </mask>
  </defs>
  ${TILE}
  <g filter="url(#lift)">
    <g fill="#fff" stroke="#fff" stroke-width="2" stroke-linejoin="miter" mask="url(#grooves)">
      ${shapes.map((s) => `<polygon points="${at(s)}"/>`).join('\n      ')}
    </g>
  </g>
</svg>
`;
}

// ---------------------------------------------------------------- sakura: the aperture flower
// On a 256 grid: the flower's centre (128, 128) - optically, a little above the middle of its own bulk;
// petals R 112 (base at 0.2 R from the centre, tips at R), 72° apart, each spun 22° about its own base;
// heart r 16. Colours from the wallpaper: crimson #A41154, rose #C4467F / #E08AAE, blush #F4A3C0.
const SAKURA = { crimson: '#A41154', blush: '#F4A3C0', tileFrom: '#9C1450', tileMid: '#C4467F', tileTo: '#E08AAE' };
const rotAbout = (p, deg, c) => {
  const a = rad(deg), s = Math.sin(a), k = Math.cos(a);
  return { x: c.x + (p.x - c.x) * k - (p.y - c.y) * s, y: c.y + (p.x - c.x) * s + (p.y - c.y) * k };
};
const f2 = (n) => Math.round(n * 100) / 100;
// the petal (unit: tip at y = -1): narrow at the base, a broad top in two round lobes, a shallow notch between
// them; `small`: the cut for 16–32 px - no notch, a little fuller, its base further from the heart
function petalPath({ small = false, thin = 1 } = {}) {
  if (small)
    return [
      ['M', { x: 0, y: -0.27 }],
      ['C', { x: 0.16, y: -0.31 }, { x: 0.42, y: -0.62 }, { x: 0.42, y: -0.86 }],
      ['C', { x: 0.42, y: -0.98 }, { x: 0.22, y: -1.02 }, { x: 0, y: -1.0 }],
      ['C', { x: -0.22, y: -1.02 }, { x: -0.42, y: -0.98 }, { x: -0.42, y: -0.86 }],
      ['C', { x: -0.42, y: -0.62 }, { x: -0.16, y: -0.31 }, { x: 0, y: -0.27 }],
    ];
  const P = [
    ['M', { x: 0, y: -0.2 }],
    ['C', { x: 0.14, y: -0.24 }, { x: 0.38, y: -0.6 }, { x: 0.38, y: -0.86 }],
    ['C', { x: 0.38, y: -0.96 }, { x: 0.24, y: -1.0 }, { x: 0.1, y: -0.99 }],
    ['L', { x: 0, y: -0.92 }],
    ['L', { x: -0.1, y: -0.99 }],
    ['C', { x: -0.24, y: -1.0 }, { x: -0.38, y: -0.96 }, { x: -0.38, y: -0.86 }],
    ['C', { x: -0.38, y: -0.6 }, { x: -0.14, y: -0.24 }, { x: 0, y: -0.2 }],
  ];
  // (thinned for white on dark, which looks heavier: each petal narrowed about its own middle line)
  return thin === 1 ? P : P.map(([c, ...ps]) => [c, ...ps.map((p) => ({ x: p.x * thin, y: -0.2 + (p.y + 0.2) * (0.5 + thin / 2) }))]);
}
function flowerD({ cx = 128, cy = 128, R = 112, spin = 22, small = false, thin = 1 } = {}) {
  const P = petalPath({ small, thin });
  const base = { x: 0, y: P[0][1].y };
  return [0, 1, 2, 3, 4]
    .map((i) => {
      const at = (p) => {
        const q = rotAbout(rotAbout(p, spin, base), i * 72, { x: 0, y: 0 });
        return `${f2(cx + q.x * R)},${f2(cy + q.y * R)}`;
      };
      return P.map(([c, ...ps]) => c + ps.map(at).join(' ')).join('') + 'Z';
    })
    .join('');
}
const heart = (cx, cy, r) => `M${f2(cx - r)},${cy}A${r},${r} 0 1,0 ${f2(cx + r)},${cy}A${r},${r} 0 1,0 ${f2(cx - r)},${cy}Z`;
// the symbol on its 256 square: petals and heart in one colour each
function sakuraSymbol({ petals = '#000000', core = petals, small = false, thin = 1, title = 'Wings logo' } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <title>${title}</title>
  <path fill="${petals}" d="${flowerD({ small, thin })}"/>
  <path fill="${core}" d="${heart(128, 128, small ? 14 : 16)}"/>
</svg>
`;
}
// the app icon: the flower in white on the crimson-to-rose tile (the small cut fills more of the tile)
function sakuraTile({ small = false } = {}) {
  // (the flower about 64 % of the tile; the small cut 70 %, so it holds at 16 px)
  const s = small ? 3.2 : 2.9;
  const o = (1024 - 256 * s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <title>Wings</title>
  <!-- Wings: Sakura aperture${small ? ' (the cut for 16-32 px)' : ''} - the wallpaper's flower spun like an aperture, white on crimson to rose (made by make-logo.mjs) -->
  <defs>
    <linearGradient id="bg" x1="0.1" y1="1" x2="0.9" y2="0"><stop offset="0" stop-color="${SAKURA.tileFrom}"/><stop offset="0.55" stop-color="${SAKURA.tileMid}"/><stop offset="1" stop-color="${SAKURA.tileTo}"/></linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="236" fill="url(#bg)"/>
  <g transform="translate(${f2(o)},${f2(o - 6)}) scale(${s})">
    <path fill="#FFFFFF" d="${flowerD({ small })}"/>
    <path fill="${SAKURA.blush}" d="${heart(128, 128, small ? 14 : 16)}"/>
  </g>
</svg>
`;
}

// ---------------------------------------------------------------- soyoku: Sōyoku Kamon (twin-wing crest)
// On a 256 grid, exact 180° rotational symmetry about (128, 128): two graceful two-tiered wings gliding
// around an open circular portal. Colours drawn from the default wallpaper (ui/assets/wallpapers/wings-default.jpg):
// sakura crimson #A41154, warm rose #D4528A, ice-pearl #E4F1FD (from the soaring pale wings), and the
// bright sakura-rose tile #D43B7E → #EE75AA → #FBBAD5.
const SOYOKU = {
  crimson: '#A41154',
  rose: '#D4528A',
  icePearl: '#E4F1FD',
  tileFrom: '#D43B7E',
  tileMid: '#EE75AA',
  tileTo: '#FBBAD5',
};
const SOYOKU_WING = {
  // Standard cut (≥ 40 px): 15u curved air-channel, C1-smooth outer arch & inner circular sky (r≈48)
  std: 'M68,62C86,34 110,22 136,22C188,22 230,62 230,114C230,144 220,168 204,184C208,160 207,136 203,114C194,72 158,47 110,48C100,48 100,63 110,63C150,62 183,83 188,116C190,131 187,144 180,154C178,132 173,112 162,98C148,80 120,74 92,80C76,83 62,72 68,62Z',
  // Small cut (16–32 px): fuller outer radius, 22u wide air-channel so both plumes stay crisp at 16–18 px
  small: 'M68,58C86,30 112,18 138,18C192,18 234,58 234,114C234,146 224,170 206,188C210,162 208,136 204,114C194,70 158,46 112,47C98,47 98,69 112,69C148,68 179,86 184,118C186,132 183,145 175,155C173,134 167,114 156,101C144,86 118,82 90,86C72,88 60,72 68,58Z',
  // Reversed cut (white on dark): optically thinned ~3% to counteract irradiation on dark surfaces
  rev: 'M70,63C87,36 111,24 136,24C187,24 228,63 228,114C228,143 218,167 203,182C207,159 206,136 202,114C193,73 158,48 111,48C100,48 100,65 111,65C150,64 182,84 187,116C189,130 186,143 179,153C177,131 172,112 161,98C147,81 120,76 93,81C77,84 64,73 70,63Z',
};
function rot180Path(d, cx = 128, cy = 128) {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) || [];
  let out = '', i = 0, cmd = '';
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) {
      cmd = tokens[i++];
      out += cmd;
      if (cmd === 'Z' || cmd === 'z') continue;
    }
    const pair = () => `${f2(2 * cx - parseFloat(tokens[i++]))},${f2(2 * cy - parseFloat(tokens[i++]))}`;
    if (cmd === 'M' || cmd === 'L') out += pair();
    else if (cmd === 'Q') out += `${pair()} ${pair()}`;
    else if (cmd === 'C') out += `${pair()} ${pair()} ${pair()}`;
  }
  return out;
}
function soyokuSymbol({ c1 = '#000000', c2 = c1, cut = 'std', title = 'Wings logo' } = {}) {
  const w1 = SOYOKU_WING[cut];
  const w2 = rot180Path(w1);
  const paths =
    c1 === c2
      ? `  <path fill="${c1}" d="${w1}${w2}"/>`
      : `  <path fill="${c1}" d="${w1}"/>\n  <path fill="${c2}" d="${w2}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-labelledby="title">
  <title id="title">${title}</title>
${paths}
</svg>
`;
}
function soyokuTile({ small = false } = {}) {
  const cut = small ? 'small' : 'std';
  const w1 = SOYOKU_WING[cut];
  const w2 = rot180Path(w1);
  // (symbol fills ~68 % of the tile at full size, ~75 % at 16–32 px so it reads crisply on the taskbar & title bar)
  const s = small ? 3.15 : 2.95;
  const o = f2((1024 - 256 * s) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-labelledby="title">
  <title id="title">Wings</title>
  <!-- Wings: Sōyoku Kamon${small ? ' (the cut for 16-32 px)' : ''} - twin gliding wings in Japanese kamon harmony, white & ice-pearl on crimson to rose (made by make-logo.mjs) -->
  <defs>
    <linearGradient id="bg" x1="0.1" y1="1" x2="0.9" y2="0"><stop offset="0" stop-color="${SOYOKU.tileFrom}"/><stop offset="0.55" stop-color="${SOYOKU.tileMid}"/><stop offset="1" stop-color="${SOYOKU.tileTo}"/></linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="236" fill="url(#bg)"/>
  <g transform="translate(${o},${o}) scale(${s})">
    <path fill="#FFFFFF" d="${w1}"/>
    <path fill="${SOYOKU.icePearl}" d="${w2}"/>
  </g>
</svg>
`;
}

if ((style === 'soyoku' || style === 'sakura') && !process.argv[3]) {
  // the app icon and its small cut, and the symbol's versions for everything else
  const kit = path.join(here, 'kit');
  fs.mkdirSync(kit, { recursive: true });
  const files =
    style === 'soyoku'
      ? {
          [path.join(here, 'wings.svg')]: soyokuTile(),
          [path.join(here, 'wings-small.svg')]: soyokuTile({ small: true }),
          [path.join(kit, 'wings-symbol.svg')]: soyokuSymbol({ c1: SOYOKU.crimson, c2: SOYOKU.rose }),
          [path.join(kit, 'wings-symbol-black.svg')]: soyokuSymbol(),
          [path.join(kit, 'wings-symbol-small.svg')]: soyokuSymbol({ c1: SOYOKU.crimson, c2: SOYOKU.rose, cut: 'small', title: 'Wings logo (16-32 px)' }),
          [path.join(kit, 'wings-symbol-reversed.svg')]: soyokuSymbol({ c1: '#FFFFFF', c2: SOYOKU.icePearl, cut: 'rev', title: 'Wings logo (on dark)' }),
        }
      : {
          [path.join(here, 'wings.svg')]: sakuraTile(),
          [path.join(here, 'wings-small.svg')]: sakuraTile({ small: true }),
          [path.join(kit, 'wings-symbol.svg')]: sakuraSymbol({ petals: SAKURA.crimson, core: SAKURA.blush }),
          [path.join(kit, 'wings-symbol-black.svg')]: sakuraSymbol(),
          [path.join(kit, 'wings-symbol-small.svg')]: sakuraSymbol({ petals: SAKURA.crimson, core: SAKURA.blush, small: true }),
          [path.join(kit, 'wings-symbol-reversed.svg')]: sakuraSymbol({ petals: '#FFFFFF', core: SAKURA.blush, thin: 0.975, title: 'Wings logo (on dark)' }),
        };
  for (const [p, s] of Object.entries(files)) fs.writeFileSync(p, s);
  console.log('written:', Object.keys(files).map((p) => path.relative(here, p)).join(', '));
} else {
  const svg = style === 'soyoku' ? soyokuTile() : style === 'sakura' ? sakuraTile() : style === 'beret' ? beretSvg() : style === 'm' ? mSvg() : style === 'blade' ? bladeSvg() : centredSvg(style === 'feather' ? feather() : facet());
  fs.writeFileSync(out, svg);
  console.log(path.basename(out), 'written:', style);
}
