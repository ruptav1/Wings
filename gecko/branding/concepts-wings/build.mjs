// Wings (Gecko) logo redesign — Phase 4 exploration (black first, 256x256 canvas).
// Generates v1 SVGs for three distinct wing/feather directions:
//   A  Hane Sweep   — three graceful sweeping plumes fanning upward from a quiet root (inspired by the wallpaper's soaring wings)
//   B  Tsuru Crest  — paired crane-like wings embracing a luminous circular portal in Japanese kamon spirit
//   C  Plume W      — twin calligraphic wings rising from twin soft troughs to form an airy letter W
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const f = (n) => Math.round(n * 100) / 100;
const rad = (d) => (d * Math.PI) / 180;

const wrapSvg = (title, note, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="title">
  <title id="title">${title}</title>
  <!-- ${note} -->
${body}
</svg>
`;

// Helper: build a smooth organic feather/plume along a cubic Bezier spine with clean cubic Bezier sides.
// Actually, hand-crafted cubic Bezier paths with extrema anchors give far fewer points and zero wobble!
// Let's write clean mathematical helpers where needed and minimal-anchor cubic paths.

function mirrorX(d, cx = 128) {
  // Mirrors SVG path commands (M, L, C, Q, Z) across x = cx.
  // Only handles absolute M/L/C/Q/H/V/Z with space/comma-separated numbers.
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
      return `${f(2 * cx - x)},${f(y)}`;
    };
    if (cmd === 'M' || cmd === 'L') {
      out += pair() + ' ';
    } else if (cmd === 'Q') {
      out += pair() + ' ' + pair() + ' ';
    } else if (cmd === 'C') {
      out += pair() + ' ' + pair() + ' ' + pair() + ' ';
    } else if (cmd === 'H') {
      const x = parseFloat(tokens[i++]);
      out += `${f(2 * cx - x)} `;
    } else if (cmd === 'V') {
      const y = parseFloat(tokens[i++]);
      out += `${f(y)} `;
    }
  }
  return out.trim();
}

// ---------------------------------------------------------------------------
// Concept A (v1): Hane Sweep — three graceful sweeping plumes fanning upward
// Constructed with minimal cubic Beziers, generous air channels (~15-18 u),
// full smooth leading arches, gentle concave undersides, soft tapered tips.
// ---------------------------------------------------------------------------
function conceptA_v1() {
  // Plume 1 (upper primary): sweeps from soft root (32,196) arching gracefully to tip (226,34)
  // Upper leading edge: broad soaring arch. Lower trailing edge: graceful concave scoop back to root.
  const p1 = [
    'M 34,196',
    'C 38,118 110,48 226,34',
    'C 208,68 176,98 134,122',
    'C 96,144 62,172 34,196 Z',
  ].join(' ');

  // Plume 2 (middle secondary): nested harmoniously below p1 with ~18u air gap
  // Root tucked at (52,208), sweeping out and up to tip (232,102)
  const p2 = [
    'M 54,208',
    'C 92,160 154,122 232,102',
    'C 208,136 172,162 130,178',
    'C 98,190 74,200 54,208 Z',
  ].join(' ');

  // Plume 3 (lower tertiary): shorter tender plume from (84,218) sweeping to (206,174)
  const p3 = [
    'M 86,218',
    'C 122,192 162,176 206,174',
    'C 182,202 146,218 112,222',
    'C 98,223 90,221 86,218 Z',
  ].join(' ');

  return wrapSvg(
    'Wings logo — Concept A (Hane Sweep v1)',
    'A v1 - Hane Sweep: three graceful sweeping plumes fanning upward from a quiet root',
    `  <path fill="#000000" d="${p1} ${p2} ${p3}"/>`
  );
}

// ---------------------------------------------------------------------------
// Concept B (v1): Tsuru Crest — Japanese kamon circular embrace of twin wings
// Two symmetrical wings sweep from a soft lower cradle up around a luminous open circle.
// Each side has two cleanly stepped sweeping plumes following concentric arcs:
//   - Outer plume sweeps from bottom-center around the outer circle (R=104) nearly to top crown
//   - Inner plume fans softly inside (R~76) with a generous ~16u curved channel between them
//   - Open sky circle (~r=42) in the middle + airy upward opening at 12 o'clock
// ---------------------------------------------------------------------------
function conceptB_v1() {
  // Right half of the crest (mirrored across x=128 for left half)
  // Outer right wing plume: starts softly at bottom-right (136, 224), sweeps out to (230, 134),
  // arches cleanly up to graceful inward-pointing tip near top crown (154, 28)
  const outerR = [
    'M 136,224',
    'C 194,218 232,174 232,118',
    'C 232,74 202,38 152,26',
    'C 178,52 194,84 194,118',
    'C 194,158 172,192 136,224 Z',
  ].join(' ');

  // Inner right wing plume: starts tucked near (134, 198), sweeps inside outerR with clean ~15u air gap
  // up to a secondary soft tip around (166, 66)
  const innerR = [
    'M 134,198',
    'C 166,176 182,146 180,112',
    'C 178,86 168,66 150,52',
    'C 158,76 160,98 156,120',
    'C 152,146 144,172 134,198 Z',
  ].join(' ');

  const outerL = mirrorX(outerR, 128);
  const innerL = mirrorX(innerR, 128);

  return wrapSvg(
    'Wings logo — Concept B (Tsuru Crest v1)',
    'B v1 - Tsuru Crest: twin layered wings curving into a Japanese kamon open circle',
    `  <path fill="#000000" d="${outerR} ${innerR} ${outerL} ${innerL}"/>`
  );
}

// ---------------------------------------------------------------------------
// Concept C (v1): Plume W — Twin calligraphic wings forming an airy letter W
// Symmetric around x=128. Each half has:
//   - A main calligraphic curved stroke forming half of W, rising into a lush upper-outer wingtip
//   - A nestled secondary outer wing plume curving underneath the upper tip (separated by crisp air-cut)
//   - Smooth rounded lower troughs and an airy rising center peak so both "W" and "wings" read instantly
// ---------------------------------------------------------------------------
function conceptC_v1() {
  // Continuous central W body whose left and right outer arms flare up into graceful curved primary wingtips
  // Left tip at (18, 56), left trough at (78, 200), center peak at (128, 102), right trough at (178, 200), right tip at (238, 56)
  const wBody = [
    'M 18,54',
    // upper sweeping outer-left curve inward-down toward left inner valley
    'C 46,66 64,98 80,156',
    // rise to center peak (inner left edge of center peak)
    'C 96,118 112,96 128,88',
    // descend from center peak (inner right edge)
    'C 144,96 160,118 176,156',
    // sweep up right inner arm to right upper wingtip
    'C 192,98 210,66 238,54',
    // right outer edge of primary wing curving down toward right trough
    'C 226,106 206,162 184,198',
    // rounded right bottom trough
    'C 178,208 164,208 158,196',
    // inner right rise into the underside of the center peak
    'C 146,168 136,144 128,132',
    // inner left descend from center peak underside
    'C 120,144 110,168 98,196',
    // rounded left bottom trough
    'C 92,208 78,208 72,198',
    // left outer edge sweeping back up to left tip
    'C 50,162 30,106 18,54 Z',
  ].join(' ');

  // Secondary lower outer wing plume on the left (and mirrored on the right)
  // Curves gracefully alongside the lower outer flank with a clean ~15u air gap
  const wingL = [
    'M 20,126',
    'C 32,148 48,170 66,184',
    'C 52,186 36,174 26,154',
    'C 21,144 19,134 20,126 Z',
  ].join(' ');
  const wingR = mirrorX(wingL, 128);

  return wrapSvg(
    'Wings logo — Concept C (Plume W v1)',
    'C v1 - Plume W: twin calligraphic wings forming a soft letter W',
    `  <path fill="#000000" d="${wBody} ${wingL} ${wingR}"/>`
  );
}

fs.writeFileSync(path.join(here, 'a-hane-v1.svg'), conceptA_v1());
fs.writeFileSync(path.join(here, 'b-tsuru-v1.svg'), conceptB_v1());
fs.writeFileSync(path.join(here, 'c-plume-w-v1.svg'), conceptC_v1());
console.log('written v1 concepts');
