// Micro-polish for Concept B (b-soyoku-v6):
//   - Slightly sleeker leading shoulder (~7u lighter around 10:30 o'clock)
//   - Air-channel extends ~10u deeper into the shoulder for airy balance
//   - Silky outer/inner curvature all the way into Primary Tip 1 (zero straight pinch)
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

const wing1 = [
  // Sleeker, lighter rounded shoulder tip near 10:30 o'clock (68, 62)
  'M 68,62',
  // Unbroken soaring leading arch climbing to top crown (136, 22)
  'C 86,34 110,22 136,22',
  // Silky outer circular wing arch to rightmost extremum (230, 114)
  'C 188,22 230,62 230,114',
  // Graceful inward taper to Primary Tip 1 at (204, 184) — lush smooth curve
  'C 230,144 220,168 204,184',
  // Primary underside sweeping smoothly back along concentric arc (no flat pinch!)
  'C 208,160 207,136 203,114',
  'C 194,72 158,47 110,48',
  // Deeper, serene rounded 15u air-channel U-turn (from y=48 to y=63 at x=110)
  'C 100,48 100,63 110,63',
  // Secondary plume outer edge sweeping concentrically inside to Secondary Tip 2 at (180, 154)
  'C 150,62 183,83 188,116',
  'C 190,131 187,144 180,154',
  // Secondary inner curve tracing the serene open circular sky portal (r≈48)
  'C 178,132 173,112 162,98',
  'C 148,80 120,74 92,80',
  // Sleek graceful closing back into shoulder (68, 62) — lighter, zero heaviness!
  'C 76,83 62,72 68,62 Z',
].join(' ');

const wing2 = rotate180(wing1, 128, 128);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="title">
  <title id="title">Wings logo — Concept B (Soyoku Kamon v6)</title>
  <!-- B v6 - Soyoku Kamon: two sleek silky 2-plume wings in 180-degree rotational harmony around a serene circular sky -->
  <path fill="#000000" d="${wing1} ${wing2}"/>
</svg>
`;

fs.writeFileSync(path.join(here, 'b-soyoku-v6.svg'), svg);
// Copy the three finalists to clean canonical concept filenames
fs.copyFileSync(path.join(here, 'a-hane-v5.svg'), path.join(here, 'a-hane.svg'));
fs.copyFileSync(path.join(here, 'b-soyoku-v6.svg'), path.join(here, 'b-soyoku.svg'));
fs.copyFileSync(path.join(here, 'c-plume-w-v5.svg'), path.join(here, 'c-plume-w.svg'));
console.log('written b-soyoku-v6 and canonical a-hane, b-soyoku, c-plume-w');
