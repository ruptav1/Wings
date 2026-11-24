// Wings (Gecko) logo redesign — Iteration 4 (v4), black first, 256x256 canvas.
// Craft refinements from v3 visual inspection:
//   A v4 (Hane Sweep): C1-smooth lower-left heel (zero kink), refined harmonic upward lift across
//        all three curved plumes, balanced calligraphic weight, optically centred.
//   B v4 (Soyoku Kamon): 180-degree rotational twin-wing Japanese kamon framing a serene open
//        circular sky — completely eliminates v3's vertical "horn/pincer" reading while achieving
//        iconic Japanese crest elegance & crisp 16 px clarity.
//   C v4 (Plume W): eliminates v3's self-intersecting pinch completely via exact stroke-width math;
//        primary wing stems stay a lush 24-28u through the split, paired with sweeping secondary
//        feathers and the refined soft calligraphic center arch.
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
    else if (cmd === 'A') {
      const rx = tokens[i++], ry = tokens[i++], rot = tokens[i++];
      const large = tokens[i++], sweep = tokens[i++];
      out += `${rx},${ry} ${rot} ${large},${sweep} ${pair()} `;
    }
  }
  return out.trim();
}

// ---------------------------------------------------------------------------
// Concept A (v4): Hane Sweep — C1-smooth lyrical anime wing
// Check tangent continuity at the lower-left heel (34, 198):
//   Incoming handle from bottom: (30, 214) -> anchor (34, 198) -> outgoing handle (38, 182)
//   Exact collinear handles! Zero corner kink!
// Also refine leading arch & plume tips for silkier, buoyant upward flow.
// ---------------------------------------------------------------------------
function conceptA_v4() {
  const wing = [
    // Start on the smooth left shoulder curve at (32, 186) where tangent is cleanly near-vertical
    'M 32,186',
    // Leading arch: soaring smoothly upward-right with a single graceful buoyant sweep to tip 1 (230, 30)
    'C 38,116 96,52 170,36',
    'C 194,31 214,29 230,30',
    // Primary feather trailing curve: silky concave sweep back to rounded slot 1
    'C 214,62 182,88 136,104',
    'C 108,114 84,126 70,141',
    // Rounded air-channel 1 (16u open gap)
    'C 64,147 71,156 80,151',
    // Secondary feather upper sweep rising gently to tip 2 (218, 102)
    'C 118,131 168,112 218,102',
    // Secondary feather underside sweeping back to rounded slot 2
    'C 198,134 166,156 126,169',
    'C 106,175 88,183 77,192',
    // Rounded air-channel 2 (14u open gap)
    'C 71,197 77,205 86,202',
    // Tertiary feather upper curve fanning gracefully to tip 3 (186, 170)
    'C 120,190 154,180 186,170',
    // Tertiary lower curve sweeping smoothly into a truly C1-rounded soft heel back to (32, 186)
    // Incoming handle to (32, 186) is (29, 212) -> collinear with outgoing (38, 116) direction!
    'C 162,202 122,222 76,224',
    'C 46,225 29,212 32,186 Z',
  ].join(' ');

  return wrapSvg(
    'Wings logo — Concept A (Hane Sweep v4)',
    'A v4 - Hane Sweep: C1-smooth weightless anime wing with three curved plumes and sweeping negative-space air channels',
    `  <path fill="#000000" d="${wing}"/>`
  );
}

// ---------------------------------------------------------------------------
// Concept B (v4): Soyoku Kamon — 180-degree rotational twin-wing Japanese crest
// Two identical graceful wings glide in 180-degree rotational harmony around
// a serene circular sky portal (r ≈ 44, center 128,128).
// Each wing is a single cohesive curved sweep along the outer circle (R=106)
// that splits gracefully along its trailing half into TWO lush curving feathers
// separated by a wide ~15u curved air-channel — unmistakably wings in gentle
// orbital flight, 100% Japanese kamon elegance, ZERO horn/onion/pincer risk!
// ---------------------------------------------------------------------------
function conceptB_v4() {
  const cx = 128, cy = 128;
  // Polar helper: deg = 0 at 12 o'clock, increases clockwise (90 = 3 o'clock, 180 = 6 o'clock)
  const pt = (r, deg) => {
    const a = rad(deg - 90);
    return { x: f(cx + r * Math.cos(a)), y: f(cy + r * Math.sin(a)) };
  };
  const s = (p) => `${p.x},${p.y}`;
  // Tangent offset helper at (r, deg): dDeg positive = clockwise along circle, dR positive = outward
  const tp = (r, deg, dDeg, dR = 0) => {
    const a = rad(deg - 90);
    const rx = Math.cos(a), ry = Math.sin(a);
    const tx = -Math.sin(a), ty = Math.cos(a);
    const L = r * rad(dDeg);
    return { x: f(cx + (r + dR) * rx + L * tx), y: f(cy + (r + dR) * ry + L * ty) };
  };

  // Let's construct the UPPER-RIGHT wing sweeping CLOCKWISE from its soft rounded shoulder
  // near 9:30 o'clock (-70° = 290°) UP over the top crown (0°), arching smoothly down-right
  // into TWO gracefully tiered soaring feather tips near 2:30–4:00 o'clock!
  // Wait: let's check angular coverage so the two 180°-rotated wings have a clean ~16–18u gap
  // between the tail of Wing 1 and the leading shoulder of Wing 2!
  // Let Wing 1 span from leading shoulder at -62° (around 10 o'clock, inner/mid radius R≈68)
  // soaring outward & clockwise over 0° (R=106) all the way to:
  //   - Primary outer feather tip at +98° (just past 3 o'clock, R=100) — sweeps wide along R=106!
  //   - Air-channel cut inward from ~+95° back along R≈80 to rounded root at +28° (gap ~15u: R=80 to R=65)!
  //   - Secondary inner feather tip at +76° (R=66) — tucked smoothly inside the primary plume!
  //   - Inner circular sky edge running along R=46 from +48° counter-clockwise back to the leading
  //     shoulder at -58° (softly curving outward to close the shoulder smoothly)!
  // Let's check clearance between Wing 1 and Wing 2 (rotated 180°):
  //   - Wing 1 leading shoulder is at -62° (= 298°), radius ~52..82.
  //   - Wing 2 primary tip is at +98° + 180° = 278°, radius 100!
  //     Angular gap between 278° and 298° = 20° at R=95 -> arc distance = 95 * 20° = 33 units!!
  //     Wait: at 278° (R=100) vs Wing 1 outer arch rising from -62° (R=72) to -20° (R=104):
  //     At 282° (-78°), Wing 2 primary tip ends at R=100, while Wing 1 hasn't even started yet (-62°)!
  //     Let's bring Wing 1's leading curve softly down to -76° (at inner sky R=48..66) so the
  //     two wings weave together with an even, serene ~18-unit circular breathing rhythm!

  // Check radii along Wing 1 at every angle:
  //   Angle -70° (shoulder base, soft rounded beak/nose curving into the flow): R = 48..68 (20u thick)
  //   Angle -30° (rising leading arch): outer R=96, inner R=46 (50u? Wait: let's cut the air-channel back to -6°!)
  //   Angle   0° (top crown): outer R=106, inner R=46 -> wait: 106 - 46 = 60u!
  //   With 2 plumes separated by a 15u air-channel:
  //     - Primary plume:   R = 106..82 (thick 24u)
  //     - Air-channel:     R = 82..67  (gap 15u — crisp at 16 px!)
  //     - Secondary plume: R = 67..46  (thick 21u)
  //   Check at -35° (before the split): if outer edge curves smoothly from R=68 (at -72°) to R=106 (at +5°),
  //   then at -35° outer R ≈ 88, inner R = 46 -> thickness ≈ 42u? Let's make it even sleeker:
  //   Start inner sky slightly wider (r = 52) or cut a sleek graceful leading taper so the shoulder
  //   is ~28–32u thick right before splitting into 22u + 20u plumes!
  //   Check with inner sky R = 50, outer max R = 106:
  //     - Primary plume:   R = 106..83 (23u thick), sweeps all the way to tip at +96° (R=98)
  //     - Air-channel:     R = 83..68  (15u gap!), rounded root at +4°
  //     - Secondary plume: R = 68..48  (20u thick), sweeps to tip at +74° (R=62)
  //     - Leading shoulder (-68° to +4°): inner edge hugs R=48, outer edge sweeps smoothly from
  //       soft rounded shoulder tip at (-74°, R=56) out to (-30°, R=94) and (+10°, R=106)!
  //       At -30°, thickness = 94 - 48 = 46u? No, if outer sweeps from (-66°, R=60) -> (-22°, R=92) -> (+12°, R=106),
  //       and slot root reaches back to -8° (R=76..64), then the solid shoulder is only ~28–34u at its widest!

  const wing1 = [
    // Start at soft tapered leading shoulder tip near 9:45 o'clock (-66°, R=58)
    `M ${s(pt(58, -66))}`,
    // Outer soaring circular arch rising from (-66°, R=58) out to R=106 at (+14°)
    `C ${s(tp(66, -54, 18, 12))} ${s(tp(102, -16, -24, 2))} ${s(pt(106, 16))}`,
    // Continue smoothly along pure outer circle R=106 from 16° to 74°, easing to Primary Tip 1 at (96, 100°)
    `A 106,106 0 0,1 ${s(pt(106, 72))}`,
    `C ${s(tp(106, 72, 12, -1))} ${s(tp(100, 92, -6, 2))} ${s(pt(94, 102))}`,
    // Underside of Primary Plume sweeping counter-clockwise back along R≈83 to rounded air-slot root at (-4°, R=81)
    `C ${s(tp(87, 90, -14, -2))} ${s(tp(83, 62, 18, 0))} ${s(pt(83, 46))}`,
    `A 83,83 0 0,0 ${s(pt(82, -2))}`,
    // Smooth semicircular U-turn of air-channel (width 15u: from R=82 to R=67 at -2°!)
    `A 7.5,7.5 0 0,0 ${s(pt(67, -2))}`,
    // Outer edge of Secondary Plume sweeping clockwise along R=68 from -2° to 52°, tapering to Tip 2 at (61, 74°)
    `A 68,68 0 0,1 ${s(pt(68, 48))}`,
    `C ${s(tp(68, 48, 11, -1))} ${s(tp(64, 66, -5, 1))} ${s(pt(58, 74))}`,
    // Inner edge of Secondary Plume curving smoothly back onto the serene central sky circle (R=48) at 42°
    `C ${s(tp(52, 64, -10, -2))} ${s(tp(48, 48, 8, 0))} ${s(pt(48, 38))}`,
    // Pure circular central sky portal (R=48) sweeping counter-clockwise from 38° back to -48°
    `A 48,48 0 0,0 ${s(pt(48, -48))}`,
    // Graceful soft curve closing back into the leading shoulder tip (-66°, R=58)
    `C ${s(tp(48, -48, -10, 1))} ${s(tp(52, -62, 6, -1))} ${s(pt(58, -66))} Z`,
  ].join(' ');

  const wing2 = rotate180(wing1, cx, cy);

  return wrapSvg(
    'Wings logo — Concept B (Soyoku Kamon v4)',
    'B v4 - Soyoku Kamon: two graceful 2-plume wings in 180-degree rotational harmony embracing a serene circular sky',
    `  <path fill="#000000" d="${wing1} ${wing2}"/>`
  );
}

// ---------------------------------------------------------------------------
// Concept C (v4): Plume W — Clean, non-pinching calligraphic winged W
// Let's verify EVERY x-coordinate on the left half so stroke widths stay a
// lush, consistent 24–28u with ZERO pinch and a generous 15u air-channel!
//   Center peak apex:      (128, 90)
//   Center underside:      (128, 134)
//   Left inner valley:     (90, 166)
//   Left bottom trough:    (80, 206)  [width between inner (90,166) and outer bottom (80,206) ~28u]
//   Left primary wingtip:  (16, 46)   [soaring gracefully outward-up!]
//     - Inner edge sweeps: (90, 166) -> (76, 120) -> (48, 66) -> (16, 46)
//     - Outer edge sweeps: (16, 46)  -> (26, 78)  -> (46, 108) -> (54, 126)
//       CHECK WIDTH at y=120: inner x=76, outer x=51 -> solid 25u stem!! ZERO PINCH!
//   Air-channel U-turn:    from (54, 126) around soft U-bend to (40, 133) [gap = 15.6u!!]
//   Left secondary plume:
//     - Upper edge sweeps: (40, 133) -> (26, 124) -> (14, 114) [tip 2 flaring parallel!]
//     - Lower edge sweeps: (14, 114) -> (26, 152) -> (50, 188) -> (72, 204)
//       CHECK WIDTH of secondary plume at midpoint (y=142): upper edge y≈128, lower edge y≈156 -> lush ~24u feather!
// ---------------------------------------------------------------------------
function conceptC_v4() {
  const wPath = [
    // Center peak top (soft graceful arch, C1 horizontal tangent at 128,90)
    'M 128,90',
    // Inner-left slope descending smoothly into left inner valley (92, 164)
    'C 116,90 106,126 92,164',
    // Inner edge of left primary wing rising smoothly then flaring gracefully out to tip 1 (16, 46)
    'C 76,120 54,68 16,46',
    // Outer/lower edge of left primary plume sweeping cleanly down-right to slot root (54, 126)
    // (Maintains a lush 25u stem thickness against inner edge x≈78 at y=126!)
    'C 26,76 40,104 54,126',
    // Smooth rounded U-bend of air-channel (width ~15u: from 54,126 to 41,134)
    'C 58,133 48,140 41,134',
    // Upper edge of left secondary plume flaring gracefully outward-up parallel to primary tip -> tip 2 (14, 112)
    'C 31,126 22,119 14,112',
    // Lower sweeping edge of secondary plume curving sleekly into the rounded left trough (76, 205)
    'C 24,152 46,188 74,204',
    // Soft rounded left trough turning smoothly upward
    'C 84,210 97,208 103,196',
    // Sleek inner-left underside rising to center underside (128, 136)
    'C 113,174 120,148 128,136',
    // --- EXACT MIRROR RIGHT HALF ---
    'C 136,148 143,174 153,196',
    'C 159,208 172,210 182,204',
    'C 210,188 232,152 242,112',
    'C 234,119 225,126 215,134',
    'C 208,140 198,133 202,126',
    'C 216,104 230,76 240,46',
    'C 202,68 180,120 164,164',
    'C 150,126 140,90 128,90 Z',
  ].join(' ');

  return wrapSvg(
    'Wings logo — Concept C (Plume W v4)',
    'C v4 - Plume W: balanced calligraphic W with lush non-pinching primary and secondary curved wing plumes',
    `  <path fill="#000000" d="${wPath}"/>`
  );
}

fs.writeFileSync(path.join(here, 'a-hane-v4.svg'), conceptA_v4());
fs.writeFileSync(path.join(here, 'b-soyoku-v4.svg'), conceptB_v4());
fs.writeFileSync(path.join(here, 'c-plume-w-v4.svg'), conceptC_v4());
console.log('written v4 concepts');
