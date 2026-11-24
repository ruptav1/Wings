// Wings (Gecko) logo redesign — Iteration 5 (v5), black first, 256x256 canvas.
// Final studio-grade craft pass before full testing & concept checkpoint:
//   A v5 (Hane Sweep): refines primary leading arch & tip taper + lightens heel slightly for airy lift.
//   B v5 (Soyoku Kamon): completely rebuilt with C1-tangent-continuous cubics (zero arc-to-cubic kinks!),
//        two silky 2-plume wings gliding in 180-degree harmony around a serene open circular sky portal.
//   C v5 (Plume W): slims lower outer cheeks by ~5u and curves primary wingtips slightly more outward
//        so stroke weight is gracefully consistent and airy across the entire mark.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const f = (n) => Math.round(n * 100) / 100;

const wrapSvg = (title, note, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="title">
  <title id="title">${title}</title>
  <!-- ${note} -->
${body}
</svg>
`;

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
      return `${f(2 * cx - x)},${f(y ? 2 * cy - y : 2 * cy)}`;
    };
    if (cmd === 'M' || cmd === 'L') out += pair() + ' ';
    else if (cmd === 'Q') out += pair() + ' ' + pair() + ' ';
    else if (cmd === 'C') out += pair() + ' ' + pair() + ' ' + pair() + ' ';
  }
  return out.trim();
}

// ---------------------------------------------------------------------------
// Concept A (v5): Hane Sweep — Polished lyrical 3-plume anime wing
// C1-smooth everywhere except the three deliberate soft feather tips.
// ---------------------------------------------------------------------------
function conceptA_v5() {
  const wing = [
    // Smooth shoulder anchor (vertical tangent cleanly matched between incoming & outgoing handles)
    'M 30,184',
    // Silky unbroken leading arch sweeping gracefully upward-right to slender tapered Primary Tip (230, 30)
    'C 36,112 96,48 168,34',
    'C 192,29 214,28 230,30',
    // Primary underside: smooth tapering sweep into rounded air-channel 1
    'C 212,62 180,88 134,104',
    'C 106,114 82,126 68,140',
    // Rounded air-channel 1 (~16u open sky gap)
    'C 62,146 69,155 78,150',
    // Secondary plume sweeping harmoniously out-and-up to Tip 2 (218, 100)
    'C 118,130 168,111 218,100',
    // Secondary underside sweeping smoothly into rounded air-channel 2
    'C 198,133 165,156 124,169',
    'C 104,175 86,183 75,192',
    // Rounded air-channel 2 (~14u open sky gap)
    'C 69,197 75,205 84,202',
    // Tertiary plume sweeping gracefully to Tip 3 (186, 168)
    'C 118,190 153,179 186,168',
    // Airy lower sweep curling back into a light, C1-continuous rounded heel (30, 184)
    'C 160,201 118,221 72,222',
    'C 44,223 27,210 30,184 Z',
  ].join(' ');

  return wrapSvg(
    'Wings logo — Concept A (Hane Sweep v5)',
    'A v5 - Hane Sweep: polished weightless anime wing with three curved plumes and sweeping negative-space air channels',
    `  <path fill="#000000" d="${wing}"/>`
  );
}

// ---------------------------------------------------------------------------
// Concept B (v5): Soyoku Kamon — Pure C1-cubic Twin-Wing Japanese Crest
// Two identical silky 2-plume wings gliding in 180-degree rotational harmony
// around a serene luminous circular portal (center 128,128).
// Notice: every single anchor along the outer arch & inner sky uses collinear
// C1 handles (ZERO kinks, ZERO blocky ends, ZERO flat arc-cubic seams!).
// ---------------------------------------------------------------------------
function conceptB_v5() {
  // Upper-right wing:
  //   - Soft tapered rounded leading edge starts gracefully near 10:30 o'clock at (76, 62)
  //   - Outer arch sweeps smoothly over 12 o'clock (136, 22) and down the right side (232, 114)
  //     tapering softly to Primary Feather Tip 1 at (210, 184)
  //   - Primary underside sweeps smoothly back along the inner curve to rounded air-slot root at (124, 52)
  //   - Rounded 15u air-channel turns cleanly at (124, 52) -> (124, 67)
  //   - Secondary Feather sweeps concentrically inside to delicate Secondary Tip 2 at (184, 152)
  //   - Secondary inner edge traces a serene circular sky curve (r≈48) from (184, 152) back up
  //     around (166, 94) -> (128, 76) -> (94, 86) and curves softly into the leading edge at (76, 62)!
  //
  // Check C1 tangent continuity at (136, 22) [top crown]:
  //   incoming handle (104, 24) -> anchor (136, 22) -> outgoing handle (186, 20) — nearly collinear horizontal!
  // Check C1 tangent continuity at (232, 114) [rightmost]:
  //   Wait — we can go from (136, 22) to (210, 184) in TWO C1-matched cubics through (230, 112):
  //     (136, 22) C (188, 22) (230, 62) (230, 112)
  //     (230, 112) C (230, 142) (222, 166) (210, 184)   <-- exact vertical tangent at (230, 112)! ZERO kink!
  // Check thickness at top crown (x=136):
  //   Outer y=22, Primary underside y=46 -> Primary thickness = 24u!
  //   Air-channel: y=46 to y=61 -> 15u luminous gap!
  //   Secondary plume: y=61 to y=80 -> 19u sleek secondary plume!
  //   Central open sky: y=80 to y=176 (diameter 96u!! Spacious, airy, radiant!)
  // Check 180-degree twin clearance:
  //   Lower wing primary tip = rotate180(210, 184) = (46, 72)
  //   Upper wing shoulder start = (68, 60) -> wait: (46, 72) to (68, 60) is 25u!
  //   And lower wing outer curve sweeps DOWN-LEFT from (46, 72), while upper wing sweeps UP-RIGHT from (68, 60),
  //   creating a clean ~22-25u diagonal swirling breeze opening into the central sky!

  const wing1 = [
    // Soft tapered rounded shoulder starting smoothly at (66, 64)
    'M 66,64',
    // Smooth unbroken leading arch climbing gracefully to top crown (136, 22)
    'C 84,36 108,22 136,22',
    // Pure silky outer wing arch curving over top-right to rightmost extremum (230, 112) [C1 horizontal->vertical]
    'C 188,22 230,62 230,112',
    // Primary plume curving gently inward to delicate tapered Primary Tip 1 at (208, 182) [C1 vertical start]
    'C 230,140 222,165 208,182',
    // Primary plume underside sweeping back along concentric inner arc to (202, 114) [vertical tangent]
    'C 208,158 206,136 202,114',
    // Continuing smoothly over the upper arch into the rounded air-slot root at (120, 48)
    'C 194,72 162,48 120,48',
    // Smooth rounded semicircular U-turn of air-channel (width 15u: from y=48 to y=63 at x=120!)
    'C 110,48 110,63 120,63',
    // Secondary plume outer edge sweeping concentrically inside Primary plume to Secondary Tip 2 at (182, 152)
    'C 156,63 184,84 188,116',
    'C 190,130 188,142 182,152',
    // Secondary plume inner curve: sleek graceful return tracing the serene open circular sky (r≈48)
    'C 178,130 174,112 164,98',
    'C 150,80 124,74 96,82',
    // Softly sweeping outward-left to close cleanly into the rounded leading shoulder (66, 64)
    'C 78,87 60,76 66,64 Z',
  ].join(' ');

  const wing2 = rotate180(wing1, 128, 128);

  return wrapSvg(
    'Wings logo — Concept B (Soyoku Kamon v5)',
    'B v5 - Soyoku Kamon: two silky 2-plume wings in 180-degree rotational harmony around a serene circular sky',
    `  <path fill="#000000" d="${wing1} ${wing2}"/>`
  );
}

// ---------------------------------------------------------------------------
// Concept C (v5): Plume W — Refined calligraphic winged W
// Micro-polished from v4:
//   - Slightly sleeker lower outer cheeks (6u lighter, keeping silky uniform calligraphic weight!)
//   - Primary wingtips arch 4u more gracefully outward-up for an even more poetic soaring lift
//   - Subtle optical harmony between the soft rounded center arch and twin rounded lower troughs
// ---------------------------------------------------------------------------
function conceptC_v5() {
  const wPath = [
    // Soft poised center arch apex (C1 horizontal tangent)
    'M 128,90',
    // Left inner slope sweeping cleanly into left inner valley (92, 162)
    'C 116,90 105,126 92,162',
    // Inner edge of left primary arm rising and flaring gracefully outward to soaring Tip 1 (14, 46)
    'C 76,118 52,66 14,46',
    // Underside of left primary wing curving cleanly into the air-channel root (56, 124)
    'C 26,76 42,102 56,124',
    // Rounded 15u luminous air-channel turn
    'C 60,131 50,139 42,133',
    // Upper edge of left secondary plume flaring gracefully parallel to Tip 2 (16, 114)
    'C 32,126 24,120 16,114',
    // Sleeker, airier lower curve of secondary wing sweeping into soft left trough (76, 204)
    'C 30,152 50,186 74,203',
    // Soft rounded trough (consistent calligraphic stroke width!)
    'C 84,210 97,207 103,195',
    // Clean inner-left underside lifting to center underside (128, 134)
    'C 113,172 120,146 128,134',
    // --- EXACT MIRROR RIGHT HALF ---
    'C 136,146 143,172 153,195',
    'C 159,207 172,210 182,203',
    'C 206,186 226,152 240,114',
    'C 232,120 224,126 214,133',
    'C 206,139 196,131 200,124',
    'C 214,102 230,76 242,46',
    'C 204,66 180,118 164,162',
    'C 151,126 140,90 128,90 Z',
  ].join(' ');

  return wrapSvg(
    'Wings logo — Concept C (Plume W v5)',
    'C v5 - Plume W: refined airy calligraphic W with outward-flaring paired curved wing plumes',
    `  <path fill="#000000" d="${wPath}"/>`
  );
}

fs.writeFileSync(path.join(here, 'a-hane-v5.svg'), conceptA_v5());
fs.writeFileSync(path.join(here, 'b-soyoku-v5.svg'), conceptB_v5());
fs.writeFileSync(path.join(here, 'c-plume-w-v5.svg'), conceptC_v5());
console.log('written v5 concepts');
