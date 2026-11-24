// Wings (Gecko) logo redesign — Iteration 3 (v3), black first, 256x256 canvas.
// Major craft pass from v2 critique:
//   A v3 (Hane Sweep): eliminates the bulky bottom-left "E-like" heel. Now a truly lyrical, weightless
//        soaring wing: sleek tapered curving shoulder sweeping up into an S-arched primary plume and
//        two harmoniously nested curved plumes beneath, optically centred with balanced stroke weight.
//   B v3 (Tsuru Kamon): eliminates the spiky "flame/antler" outward barbs of v2. Now an authentic,
//        serene Japanese circular wing crest (Tsuru-maru spirit): smooth circular outer arcs with
//        gracefully tucked concentric curved feather tips curving *tangentially inward* around a pure
//        luminous circular sky portal.
//   C v3 (Plume W): eliminates the chunky bottom cheeks & rabbit-ear tips of v2. Now an airy, refined
//        calligraphic W whose twin outer arms flare gracefully outward in soft S-curved wing plumes
//        with balanced calligraphic weight and a poised, elegant center arch.
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

function mirrorX(d, cx = 128) {
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
    if (cmd === 'M' || cmd === 'L') out += pair() + ' ';
    else if (cmd === 'Q') out += pair() + ' ' + pair() + ' ';
    else if (cmd === 'C') out += pair() + ' ' + pair() + ' ' + pair() + ' ';
    else if (cmd === 'A') {
      const rx = tokens[i++], ry = tokens[i++], rot = parseFloat(tokens[i++]);
      const large = tokens[i++], sweep = parseInt(tokens[i++], 10);
      out += `${rx},${ry} ${f(-rot)} ${large},${sweep ? 0 : 1} ${pair()} `;
    } else if (cmd === 'H') out += `${f(2 * cx - parseFloat(tokens[i++]))} `;
    else if (cmd === 'V') out += `${f(parseFloat(tokens[i++]))} `;
  }
  return out.trim();
}

// ---------------------------------------------------------------------------
// Concept A (v3): Hane Sweep — weightless lyrical Japanese/anime wing
// Key improvements over v2:
//   - Slim, graceful curving shoulder/quill base curving smoothly from lower-left (34, 212)
//     upward and sweeping right (ZERO bulky blob at the heel!)
//   - 3 layered curved feathers fanning with graceful upward-right momentum:
//       * Primary plume arches highest to delicate curved tip (230, 32)
//       * Secondary plume curves cleanly beneath to (222, 108)
//       * Tertiary plume tucks softly below to (188, 174) with a nimble, airy underside
//         that lifts lightly instead of drooping flat!
//   - Two generous (~16u) curved luminous air-channels following concentric flow lines
//   - Optically balanced horizontally (margins ~L26 R26)
// ---------------------------------------------------------------------------
function conceptA_v3() {
  // Let's craft ONE unified soaring wing with a sleek curved spine & graceful tapered heel
  // (plus a light calligraphic lift along the lower edge so it floats effortlessly in midair!)
  const wing = [
    // Sleek, graceful lower-left shoulder root curving lightly down-left like a drifting quill base
    'M 26,204',
    // Outer leading edge: sweeping boldly upward from lower-left, arching gracefully skyward,
    // with a whisper of lyrical S-lift toward the soaring primary wingtip at (230, 30)
    'C 32,126 88,60 162,40',
    'C 188,33 212,30 230,28',
    // Primary feather underside: lush smooth taper sweeping back along a gentle curve into slot 1
    'C 214,62 182,88 138,104',
    'C 110,114 84,126 68,142',
    // Air-channel 1 rounded inner bend (~15u wide luminous gap, deep enough to keep the shoulder sleek!)
    'C 62,148 69,157 78,152',
    // Secondary feather upper curve: fanning gracefully out to tip 2 at (218, 104)
    'C 116,132 166,114 218,104',
    // Secondary feather underside sweeping back into slot 2
    'C 198,136 164,158 124,170',
    'C 104,176 86,184 74,194',
    // Air-channel 2 rounded inner bend (~14u wide luminous gap)
    'C 68,199 74,207 83,204',
    // Tertiary feather upper edge: delicate shorter plume fanning to tip 3 at (186, 172)
    'C 118,192 152,182 186,172',
    // Tertiary underside: airy curving lift back to the nimble wing heel (NO bulky boot!)
    'C 160,204 120,222 72,224',
    'C 48,225 32,218 26,204 Z',
  ].join(' ');

  return wrapSvg(
    'Wings logo — Concept A (Hane Sweep v3)',
    'A v3 - Hane Sweep: sleek weightless anime wing with slender shoulder, lyrical primary arch, and two sweeping air channels',
    `  <path fill="#000000" d="${wing}"/>`
  );
}

// ---------------------------------------------------------------------------
// Concept B (v3): Tsuru Kamon — Serene Japanese circular wing crest
// Key improvements over v2:
//   - ZERO outward spiky "flames/antlers"! Every feather curves TANGENTIALLY ALONG
//     the circular envelope, curling gracefully inward like a traditional Japanese
//     Tsuru-maru (crane circle) crest modernized into pure vector geometry!
//   - Each side has TWO lush, smoothly shingled curved plumes (instead of 3 cramped spiky ones)
//     PLUS a delicate rounded inner cradle — wait: let's check!
//     Picture a circular crest (center 128, 128, R=106):
//       1. Outer primary wing-plume (right): sweeps smoothly along R=106 from 158° up around
//          the side and arches over the top to a gentle inward tip at (R=94, 10°), tapering cleanly
//          along its inner arc R=78 down to 132° — sleek ~24-26u thickness!
//       2. Inner secondary wing-plume (right): nestled concentrically inside with a crisp 14u
//          luminous curved air-channel! Starts softly along the bottom cradle at (R=88, 173°),
//          sweeps gently up around R=68..48 (thick ~20u) to a soft inward-curling tip at (R=62, 42°),
//          its inner edge tracing a pure serene circular sky (r=48) down to 156°!
//   - WAIT A SECOND! Check that geometry carefully so it NEVER looks like an onion (v1)!
//     Why did v1 look like an onion?
//       (a) v1 had sharp points at the BOTTOM AND TOP (symmetric vertically!).
//       (b) v1's two crescents were separated symmetrically all the way from bottom to top.
//     How does v3 make it UNMISTAKABLY **crane wings in a Japanese kamon** (and 0% onion)?
//       (a) Connect the base of each wing smoothly as ONE unified sweeping wing-shoulder at the
//           lower curve (around 130°–174°), so the wing splits into 3 (or 2) stepped feathers
//           ONLY along the UPPER-INNER skyward sweep (from ~10° down to ~80°), curling inward!
//       (b) Give the bottom center (6 o'clock) a subtle graceful **upward-lifted tail / diamond
//           cradle** (a gentle rising V-base where the two wings spring outward, NOT pinching down
//           to two vertical parentheses!).
//       (c) Let the primary wingtip sweep **high & gracefully over the top** (~10° from 12 o'clock)
//           and step the 2nd and 3rd feathers cleanly INSIDE it like real overlapping crane wings
//           folded in a circle!
// ---------------------------------------------------------------------------
function conceptB_v3() {
  const cx = 128, cy = 128;
  // angle deg: 0 = 12 o'clock (top), 90 = 3 o'clock (right), 180 = 6 o'clock (bottom)
  const pt = (r, deg) => {
    const a = rad(deg - 90);
    return { x: f(cx + r * Math.cos(a)), y: f(cy + r * Math.sin(a)) };
  };
  const s = (p) => `${p.x},${p.y}`;
  const arcTo = (r, p, sweep = 0) => `A ${f(r)},${f(r)} 0 0,${sweep} ${s(p)}`;

  // Let's design ONE serene, unmistakable Japanese Tsuru-maru (crane wing circle):
  // Imagine TWO graceful mirrored wings springing cleanly from a delicate lower V-cradle
  // at 6 o'clock (separated by a clean 14u vertical cleft so the two wings breathe!).
  // For the RIGHT wing:
  //   - OUTER EDGE: ONE pure, unbroken, lush circular sweep from bottom (R=104, 173°)
  //     all the way up around the right side (90°) and curving softly inward over the crown
  //     to the primary wingtip at (R=96, 12°)! That unbroken outer arc gives total Japanese
  //     kamon serenity — zero jagged spikes!
  //   - INNER EDGE (shingled feathers curving inward around the open sky!):
  //       * Primary feather (tip 1 at R=96, 12°): its underside curves smoothly along R=78
  //         down to a rounded air-slot root at (R=78, 86°) [26u thick primary feather!].
  //       * Air-channel 1 (wide 14u U-turn from R=78 to R=64 at 86°): curves cleanly UP to
  //         Secondary feather tip 2 at (R=68, 36°)!
  //       * Secondary feather underside curves smoothly along R=50 down to (R=54, 126°)
  //         [18u thick secondary feather!].
  //       * Wait: below 126°, to keep the lower wing body sleek (NOT 50u thick!), let the
  //         inner edge curve smoothly OUTWARD from (R=54, 126°) along a graceful ascending
  //         inner crescent toward the lower base at (R=78, 172°) — wait, let's check thickness
  //         at 126°: from R=54 to R=104 is 50u! How do we make 126° sleek (~26u)?
  //   AHA!! SHIFT THE INNER SKY CIRCLE DOWNWARD!
  //   Center the outer circle at (128, 128) with R=104.
  //   Center the inner sky circle at (128, 138) with r=62 (so at the bottom 180°, outer is y=232
  //   and inner sky is y=200 → thickness is a sleek 32u! And at the sides 90°, outer is x=232
  //   and inner sky is x=190 → wait, let's place the inner sky at (128, 134), r=54, and cut
  //   a sleek 3rd lower feather OR let the outer edge tuck gently inward along the lower curve
  //   like real bird wings whose lower shoulders taper cleanly toward the tail!)
  //   YES!! Real wings are WIDE at the mid-upper arch and TAPER SLEEKLY toward the lower base!
  //   So instead of a uniform thick donut at the bottom, the outer wing silhouette starts narrow
  //   at the bottom tail-cradle (x=136, y=220), swells gracefully outward to R=104 at the sides
  //   and upper arch, and fans into **THREE sleek stepped concentric feathers** (all curving
  //   gracefully inward along the circle!) — like an origami/kamon crane spreading its wings
  //   to frame a serene luminous moon/sky!

  // Let's trace the RIGHT wing cleanly with smooth cubic curves & circular arcs:
  // Outer silhouette: starts softly at bottom-right (135, 222) -> swells smoothly out to right (232, 124) ->
  // arches cleanly over top-right to delicate inward-curving Primary Tip 1 at (146, 26)!
  // Inner silhouette:
  //   1. Primary plume underside sweeps down-right along a crisp concentric curve into Slot 1 at (190, 114)
  //   2. Wide 14u rounded air-slot turns cleanly UP into Secondary Plume Tip 2 at (172, 54)
  //   3. Secondary plume underside sweeps smoothly down-right into Slot 2 at (174, 152)
  //   4. Wide 13u rounded air-slot turns cleanly UP into Tertiary Plume Tip 3 at (178, 102)?
  //      Wait — no, 3 concentric nested layers get busy! Look how clean **TWO lush tiered plumes +
  //      a graceful lower inner cradle** (or 3 gently staggered feathers where the lower one tucks
  //      cleanly into the bottom curve) is!
  //   Let's check the widths of TWO lush concentric plumes with a sleek tapered base:
  //     - Primary plume (outer): ~24u thick at middle, sweeps from lower-right shoulder up to (144, 26)
  //     - Air-channel: ~15u wide clean sweeping luminous arc!
  //     - Secondary plume (inner): ~20u thick at middle, sweeps from lower-right shoulder up to (166, 58)
  //     - AND add a sleek **3rd outer wingtip notch** OR a graceful **floating small crest / lower tail feather**?
  //     WAIT: let's test the pure 2-tier embracing crane wings with a sleek tapered lower cradle FIRST,
  //     AND notice: if the outer wingtips curl gracefully OVER the top (almost forming a halo, with a crisp
  //     28u sky opening at 12 o'clock) AND the secondary plumes sweep up INSIDE them, AND the bottom has a
  //     delicate **tapered curved lower wing-tail** curving softly outward-down (like a crane's sweeping lower edge
  //     instead of a blunt stub!), it looks like an authentic **museum-grade Japanese kamon**!!

  const rightKamon = [
    // Start at soft lower-inner wing root (135, 214) — leaves a clean 14u vertical breathing cleft at bottom center
    'M 135,214',
    // Graceful lower-outer curve sweeping wide & up along a serene circular outer arc (R≈104)
    'C 186,210 232,174 232,118',
    // Upper-outer circular sweep arching smoothly over the crown to Primary Tip 1 at (144, 24)
    'C 232,68 196,30 144,24',
    // Primary plume inner curve: lush tapered arch sweeping cleanly down-right into rounded air-slot 1
    'C 178,42 204,76 204,116',
    'C 204,136 198,154 189,168',
    // Smooth rounded U-bottom of air-channel 1 (15u luminous gap!)
    'C 184,176 172,171 175,161',
    // Outer curve of Secondary plume sweeping smoothly UP inside Primary plume to Tip 2 at (164, 58)
    'C 184,134 186,94 164,58',
    // Inner curve of Secondary plume curving softly down to frame the serene open central sky!
    'C 168,86 168,116 158,144',
    // Graceful inner sky arc curving down toward a sleek tapered base (keeps lower mass light & balanced!)
    'C 150,168 139,188 135,204',
    // Soft rounded lower tip closing back to (135, 214)
    'C 134,209 134,212 135,214 Z',
  ].join(' ');

  // WAIT A SECOND! Look closely at the coordinates of rightKamon above:
  // At y=170 (bottom of slot 1): outer edge is around (206, 184), slot bottom is (189, 168), inner edge is (148, 174).
  // That means at y=175: solid thickness from inner (148, 174) to outer (206, 184) is ~58u? NO, wait:
  // At y=174, outer curve `C 186,210 232,174 232,118` at t=0.45 is around x=206, y=184;
  // inner curve at y=184 is around x=142 — so width is ~60u if solid!
  // Let's check: why was it 60u? Because slot 1 ended at (189, 168) leaving solid mass between (189, 168) and (142, 184) (~48u wide!).
  // FIX: extend a **SECOND sleek sweeping air-channel** OR bring the lower-inner sky circle down lower (wider sky circle r=56 centered at 128,136!) so the lower shoulder band is a **sleek, consistent 24–28u** all the way around!
  // Let's calculate exact points for a SLEEK 24–28u band:
  //   Outer circle: center (128, 126), R=104 (at bottom-right 145°: x = 128 + 104*sin(145)=187.6, y = 126 - 104*cos(145)=211.2)
  //   Inner sky circle: center (128, 134), r=52? At 145°: x = 128 + 52*0.574=157.8, y = 134 + 52*0.819=176.6 -> distance = ~45u.
  //   If we place TWO plumes + a **3rd inner/lower plume** OR make the **outer bottom start at (136, 224)** and inner sky sweep down to **(136, 198)** (thickness = 26u at bottom!):
  //   Check at 135° (lower-right diagonal):
  //     Outer edge at 135°: (202, 200)
  //     Inner sky at 135°:  (174, 176)  -> distance = sqrt(28^2 + 24^2) = 37u!
  //     And if slot 1 ends right at (184, 172), then below slot 1 the spine is ONLY 28u thick!!
  //   CHECK AT 90° (3 o'clock):
  //     Outer edge: x = 232
  //     Primary plume (24u): x = 232..208
  //     Air-channel 1 (14u): x = 208..194
  //     Secondary plume (22u): x = 194..172
  //     Central open sky: x = 84..172 (width = 88u — spacious, luminous!)
  //   CHECK AT 135° (lower right):
  //     Outer edge: (202, 199)
  //     Inner sky:  (172, 176)  -> solid wing shoulder = ~36u tapering smoothly to 24u at (136, 222)/(136, 198)!
  //   AND AT 45° (upper right):
  //     Primary plume arches cleanly from (202, 52) up to delicate inward tip (144, 24)!
  //     Secondary plume arches cleanly inside from (178, 74) up to delicate inward tip (156, 52)!
  //   AND AT 6 O'CLOCK (bottom):
  //     What if the two wings meet with a **graceful subtle lift / tiny upward V-cleft** at the bottom
  //     AND a tiny serene **negative-space teardrop / rising crane silhouette** emerges in the open center?!
  //   WAIT A SECOND!! Look at the central negative space created by those two embracing wings:
  //     - Top: softly open between the two overarching wingtips (x: 112..144)
  //     - Middle: a serene luminous circular sky (diameter ~88u!)
  //     - Bottom: gently narrows into a graceful cradle above the 14u vertical cleft!
  //   Let's write those EXACT balanced coordinates right now!

  const rightKamonBalanced = [
    // Start at soft lower-outer base (136, 226)
    'M 136,226',
    // Smooth circular outer wing back sweeping through (204, 198) and (232, 126) up to (204, 52)
    'C 192,222 232,180 232,124',
    'C 232,70 196,30 142,24',
    // Primary wingtip curling softly inward at (142, 24), then underside sweeping down along R≈80
    'C 178,42 204,76 204,120',
    'C 204,142 197,162 186,177',
    // Smooth rounded bottom of air-channel 1 (~14u luminous gap!)
    'C 181,184 170,178 173,169',
    // Secondary plume outer curve sweeping cleanly UP along R≈66 inside Primary plume to Tip 2 at (162, 54)
    'C 186,138 190,94 162,54',
    // Secondary plume inner curve: lush tapered inner edge descending smoothly into the circular sky (r≈48)
    'C 172,82 174,112 167,138',
    'C 161,162 150,180 136,196',
    // Soft rounded lower inner corner (thickness 30u -> 26u, light and balanced!)
    'C 134,199 134,224 136,226 Z',
  ].join(' ');

  // Wait: let's make the bottom corner at (136, 196)..(136, 226) a graceful tapered curve (not a flat vertical wall!)
  // If inner edge curves down to (135, 198) and outer edge starts at (136, 226), a smooth vertical line x=136 creates
  // a crisp, architectural Japanese kamon split (16u clean white channel between left x=120 and right x=136)!
  // Let's make it slightly softer at the ends (rounded bevels) so it feels soft & delicate, not sharp rectangular!
  const rightKamonSoft = [
    'M 136,224',
    // Outer sweeping arc R≈104 from bottom-right up to upper crown tip (142, 24)
    'C 194,220 232,178 232,122',
    'C 232,68 196,28 142,24',
    // Underside of Primary Plume curving concentrically down to rounded air-slot root (188, 174)
    'C 180,42 204,76 204,120',
    'C 204,142 198,160 187,174',
    // Generous 14u rounded air-slot turning smoothly upward
    'C 182,181 171,175 174,166',
    // Secondary Plume soaring inside along concentric arc up to delicate Tip 2 at (162, 56)
    'C 186,136 189,94 162,56',
    // Inner sky edge of Secondary Plume descending smoothly around the luminous open sky
    'C 172,84 173,114 166,142',
    'C 160,164 149,182 136,196',
    // Soft rounded lower cradle end (gentle vertical cleft x=120..136, softly rounded top & bottom)
    'C 132,201 132,224 136,224 Z',
  ].join(' ');

  const leftKamonSoft = mirrorX(rightKamonSoft, 128);

  return wrapSvg(
    'Wings logo — Concept B (Tsuru Kamon v3)',
    'B v3 - Tsuru Kamon: twin serene Japanese crane wings curving tangentially around a luminous circular sky',
    `  <path fill="#000000" d="${rightKamonSoft} ${leftKamonSoft}"/>`
  );
}

// ---------------------------------------------------------------------------
// Concept C (v3): Plume W — Graceful calligraphic winged W
// Key improvements over v2:
//   - Primary wingtips curve OUTWARD & UPWARD in a lyrical anime wing arch
//     (NOT stiff straight rabbit ears!)
//   - Secondary feathers flow PARALLEL below the primaries with wide ~15u curved
//     air-channels and sleek tapered tips (NO chunky rounded cheeks!)
//   - Balanced, refined calligraphic stroke weight (~26u) flowing seamlessly
//     through twin soft lower troughs up into a poised, airy center arch
//     (ZERO heavy triangular bat-head in the middle!)
// ---------------------------------------------------------------------------
function conceptC_v3() {
  // Let's trace the entire symmetric W smoothly across x=128.
  // Landmarks (256x256, optical vertical centre slightly above 128):
  //   Primary wingtips:     (14, 54) and (242, 54) — arching gently outward-upward!
  //   Secondary wingtips:   (20, 118) and (236, 118) — graceful parallel curved lower plume!
  //   Air-channel U-root:   (66, 114) and (190, 114) — wide ~15u sweeping curve!
  //   Bottom troughs:       (82, 206) and (174, 206) — soft rounded calligraphic turns
  //   Center arch apex:     (128, 92) (soft graceful rounded-crest peak, NOT a sharp spike!)
  //   Center underside:     (128, 134) (light, balanced ~26-28u stroke!)

  const wPath = [
    // Start at soft refined center apex (128, 92)
    'M 128,92',
    // Graceful left inner descent into left valley (92, 166)
    'C 116,92 104,126 90,164',
    // Inner edge of left primary arm sweeping UP, then curving gracefully OUTWARD to soaring tip (14, 52)
    'C 76,118 54,70 14,52',
    // Underside of left primary wing curving gently inward-down into the luminous air-channel
    'C 30,78 48,96 68,108',
    // Smooth rounded inner bend of air-channel (~15u open gap!)
    'C 75,112 70,124 61,122',
    // Upper edge of left secondary plume flaring cleanly outward to tip 2 at (22, 114)
    'C 46,119 34,116 22,114',
    // Sweeping lower edge of secondary wing curving sleekly (NOT bloated!) down into soft left trough (82, 206)
    'C 36,154 56,188 76,204',
    // Soft rounded bottom trough (width ~26u)
    'C 85,211 97,208 102,197',
    // Sleek rising inner-left underside to center underside arch (128, 134)
    'C 113,172 120,146 128,134',
    // --- MIRRORED RIGHT HALF ---
    'C 136,146 143,172 154,197',
    'C 159,208 171,211 180,204',
    'C 200,188 220,154 234,114',
    'C 222,116 210,119 195,122',
    'C 186,124 181,112 188,108',
    'C 208,96 226,78 242,52',
    'C 202,70 180,118 166,164',
    'C 152,126 140,92 128,92 Z',
  ].join(' ');

  return wrapSvg(
    'Wings logo — Concept C (Plume W v3)',
    'C v3 - Plume W: airy calligraphic W with outward-flaring twin curved wing plumes and balanced refined weight',
    `  <path fill="#000000" d="${wPath}"/>`
  );
}

fs.writeFileSync(path.join(here, 'a-hane-v3.svg'), conceptA_v3());
fs.writeFileSync(path.join(here, 'b-tsuru-v3.svg'), conceptB_v3());
fs.writeFileSync(path.join(here, 'c-plume-w-v3.svg'), conceptC_v3());
console.log('written v3 concepts');
