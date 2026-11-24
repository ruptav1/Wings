// Wings (Gecko) logo redesign — Iteration 2 (v2), black first, 256x256 canvas.
// Fixing every weakness spotted in v1:
//   A v2 (Hane Sweep): unified cohesive wing with flowing S-curved leading arch + 3 cleanly parted
//        sweeping plumes (connected at a soft graceful shoulder so it reads 100% as a wing, not 3 leaves).
//   B v2 (Tsuru Kamon): authentic Japanese circular crane-wing crest — continuous circular outer leading
//        arcs with 3 stepped concentric inner feather tips per side embracing an open luminous sky.
//   C v2 (Plume W): serene calligraphic W whose left & right soaring arms each branch gracefully into
//        paired curved wingtips with clean wide air-channels — zero tacked-on shards or pinch junctions.
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
// Concept A (v2): Hane Sweep — unified lyrical sweeping wing
// A single fluid silhouette: soft curved leading shoulder at lower-left sweeps
// in a poised anime arch up to the primary tip (228, 34). Two wide luminous
// curved negative-space cuts carve inward from the trailing edge to separate
// three graceful sweeping feather tiers, all anchored seamlessly to the wing's
// spine (reading unmistakably as one weightless soaring wing, never 3 leaves).
// ---------------------------------------------------------------------------
function conceptA_v2() {
  // Drawn as one continuous closed path tracing the entire wing silhouette
  // including two deep, smooth U-rounded air channels between the 3 feathers:
  const wing = [
    // Start at the soft tucked lower-left wing root/heel
    'M 42,208',
    // Leading edge: smooth soaring arch rising steeply from the shoulder then curving gracefully right to primary tip
    'C 28,158 56,88 122,50',
    'C 158,30 198,24 230,30',
    // Primary feather trailing underside sweeping cleanly back-left toward first air-slot root
    'C 212,62 182,88 140,104',
    'C 116,113 94,124 84,136',
    // Smooth rounded inner turn of air-slot 1 (~15u wide channel)
    'C 78,143 85,152 94,148',
    // Secondary feather upper curve sweeping out & gently up to tip 2
    'C 128,132 174,114 222,102',
    // Secondary feather trailing underside curving back toward air-slot 2
    'C 202,134 170,156 132,168',
    'C 114,174 100,180 94,187',
    // Smooth rounded inner turn of air-slot 2 (~14u wide channel)
    'C 89,193 95,200 104,198',
    // Tertiary feather upper edge sweeping gracefully to soft lower tip 3
    'C 134,190 166,178 196,170',
    // Tertiary lower edge curving gently back into a soft rounded wing heel
    'C 172,202 134,222 86,224',
    'C 62,225 46,220 42,208 Z',
  ].join(' ');

  return wrapSvg(
    'Wings logo — Concept A (Hane Sweep v2)',
    'A v2 - Hane Sweep: single fluid anime wing with sweeping leading arch and two carved air channels into three plumes',
    `  <path fill="#000000" d="${wing}"/>`
  );
}

// ---------------------------------------------------------------------------
// Concept B (v2): Tsuru Kamon — Japanese circular crane-wing crest
// Two mirrored wings rise from a serene lower cradle, following a true circular
// outer boundary (center 128,128, R=104), each branching along its upper-inner
// contour into THREE concentrically stepped curved feather tips embracing an
// open luminous sky circle at the center.
// Constructed cleanly using polar coordinates around (128,128) so circularity
// is mathematically exact (zero lumpy hand-guessed arcs!).
// ---------------------------------------------------------------------------
function conceptB_v2() {
  const cx = 128, cy = 128;
  // Polar helper: angle deg measured clockwise from 12 o'clock (0 = top, 90 = right, 180 = bottom)
  const pt = (r, deg) => {
    const a = rad(deg - 90);
    return { x: f(cx + r * Math.cos(a)), y: f(cy + r * Math.sin(a)) };
  };
  const s = (p) => `${p.x},${p.y}`;

  // Build the RIGHT wing as one continuous sweeping kamon shape (then mirror for left wing):
  // Outer back runs smoothly along R=104 from bottom cradle (173°) up around the right side to primary tip (14°).
  // Wait: let's taper the tip smoothly off the outer circle with a delicate feathered curve,
  // then step smoothly into feather 1 (tip at 14°, R_mid=92), feather 2 (tip at 46°, R_mid=78),
  // and feather 3 (tip at 78°, R_mid=64), returning along a smooth circular inner sky arc (R=56)
  // down to the lower-inner cradle at (166°, R=74)!
  const R = 104;
  // Helper for circular arc command from point A to point B at radius r
  const arcTo = (r, p, sweep = 0) => `A ${f(r)},${f(r)} 0 0,${sweep} ${s(p)}`;

  // Let's trace RIGHT wing COUNTER-CLOCKWISE on the outer edge (from bottom 174° UP to top 16°):
  // Wait: in SVG coords (y down), going from 174° (bottom-right) through 90° (right) up to 16° (top-right)
  // is COUNTER-CLOCKWISE (sweep = 0)!
  const pBaseOut = pt(R, 174);
  const pOuterMid = pt(R, 90);
  const pTip1 = pt(98, 13);        // primary plume tip near 12 o'clock (gentle inward curl)
  const pSlot1In = pt(82, 54);     // inner rounded root of cut 1 (between plume 1 & 2)
  const pSlot1Out = pt(79, 58);
  const pTip2 = pt(78, 34);        // secondary plume tip nestled inside
  const pSlot2In = pt(64, 84);     // inner rounded root of cut 2 (between plume 2 & 3)
  const pSlot2Out = pt(61, 89);
  const pTip3 = pt(60, 62);        // tertiary plume tip nestled deepest
  const pInnerArcMid = pt(58, 124);
  const pBaseIn = pt(78, 169);

  // Let's build ultra-smooth curved feathers using exact polar control points!
  // Better: compute cubic control point tangent to circle of radius r at angle deg!
  const tanPt = (r, deg, dAngleDeg, dR = 0) => {
    const a = rad(deg - 90);
    // tangent direction for INCREASING deg (clockwise) is (-sin(a), cos(a)) = (cos(a+90), sin(a+90))
    const tx = -Math.sin(a), ty = Math.cos(a);
    const rx = Math.cos(a), ry = Math.sin(a);
    const L = r * rad(dAngleDeg);
    return { x: f(cx + (r + dR) * rx + L * tx), y: f(cy + (r + dR) * ry + L * ty) };
  };

  // Let's craft each feather step with crisp geometric clarity:
  // Outer leading edge: true circular arc R=104 from 173° up to 24°, easing gently inward to tip1 at (R=96, 11°)
  const rightWing = [
    `M ${s(pt(104, 173))}`,
    // Smooth circular outer wing back up to 28° (sweep=0 goes CCW from bottom through right to top)
    arcTo(104, pt(104, 28), 0),
    // Gentle calligraphic taper to primary tip at (94, 12°)
    `C ${s(tanPt(104, 28, -9, -1))} ${s(tanPt(97, 16, 4, 2))} ${s(pt(94, 11))}`,
    // Underside of primary plume sweeping back along R≈84 down to slot 1 root at (82, 62°)
    `C ${s(tanPt(90, 18, 12, -3))} ${s(tanPt(84, 44, -10, 0))} ${s(pt(83, 60))}`,
    // Soft rounded U-bottom of air-slot 1 (width ~12u radial? Wait: let's make radial gap >= 14u so it holds at 16px!)
    // Actually: R=104 outer, plume 1 thickness ~20u -> underside at R=84; air-slot ~13u -> plume 2 outer at R=71!
    // Wait: if we have 3 concentric plumes inside R=104:
    //   Plume 1: R 104 .. 84 (thickness 20)
    //   Gap 1:   R 84 .. 71  (gap 13)
    //   Plume 2: R 71 .. 53  (thickness 18)
    //   Center open sky: r = 53 (diameter 106 — generous & luminous!)
    // WHOA!! 2 concentric tiers per wing (instead of 3 cramped thin strips!) gives:
    //   - Thicker, bolder, softer feathers (20u & 18u)
    //   - Wider air gap (14u) that NEVER closes at 16 px!
    //   - PLUS a graceful 3rd lower-outer step OR subtle flare at the outer back so it looks 100% like wings!
    // Let's check! What if EACH wing has 3 stepped plumes fanning OUTWARD/UPWARD along the circle by angle (not stacked radially into thin strips)?
    // Let's trace that!
    //   - Plume 1 (longest outer plume): sweeps from 172° all the way up to 12° (R: 104 outer, 80 inner -> 24u thick!)
    //   - Cut 1 opens from the inner edge at 54° (width 14u!)
    //   - Plume 2 (middle plume): sweeps up along R: 76 outer, 54 inner -> 22u thick, reaching tip at 38°!
    //   - Lower inner curve sweeps smoothly along R=54 from 72° down to 166° (meeting the soft tapered lower base)!
    // WAIT A SECOND! Compare 2 lush plumes + a crisp graceful lower tail-notch at 6 o'clock vs 3 plumes!
    // Let's compute 2 lush overlapping plumes + a 3rd tucked inner-lower feather tip at ~78° where R goes from 66 -> 48!
    // Wait: even cleaner — let's test the 2-lush-plume + graceful flare design right now AND see it rendered!
  ];

  // Clean 2-tier concentric crane wing (right half, thick 22u plumes, 14u air-channel, R=104 outer, r=50 inner sky):
  // Plus a delicate soft lower-center tail/cradle so the bottom is grounded and the top opens to the sky!
  const pA = pt(104, 173);       // outer bottom start
  const pB = pt(104, 30);        // outer top-right arc end
  const pTip1b = pt(93, 11);     // primary plume tip (softly curved inward toward 12 o'clock)
  const pC1 = pt(82, 58);        // underside of plume 1 into air channel
  const pSlotEnd = pt(79, 86);   // rounded end of air-channel (deep sweeping channel!)
  const pSlotRet = pt(69, 82);   // inner side of rounded air-channel (width ~12-14u!)
  const pTip2b = pt(68, 38);     // secondary plume tip curving up inside plume 1
  const pInTop = pt(54, 72);     // inner sky boundary top-right
  const pInBot = pt(56, 138);    // inner sky boundary bottom-right
  const pBaseEnd = pt(84, 172);  // bottom inner corner (leaving a clean 14u vertical cleft between left & right wings at 6 o'clock!)

  const kamonR = [
    `M ${s(pA)}`,
    // Outer circular back R=104 from 173° up to 30°
    arcTo(104, pB, 0),
    // Soft tapered curve to primary wingtip at (93, 11°)
    `C ${s(tanPt(104, 30, -10, -1))} ${s(tanPt(97, 16, 4, 2))} ${s(pTip1b)}`,
    // Underside of primary plume curving back down along R≈82 to 68°
    `C ${s(tanPt(88, 22, 14, -2))} ${s(tanPt(82, 48, -12, 0))} ${s(pt(82, 66))}`,
    // Continue down to rounded slot bottom at 96°
    arcTo(82, pt(82, 98), 1),
    // Smooth semicircular U-turn of the air-channel (diameter 14u: from R=82 to R=68!)
    `A 7,7 0 0,1 ${s(pt(68, 98))}`,
    // Outer curve of secondary plume sweeping UP along R=68 from 98° to 48°
    arcTo(68, pt(68, 52), 0),
    // Taper softly to secondary wingtip at (61, 34°)
    `C ${s(tanPt(68, 52, -9, -1))} ${s(tanPt(63, 39, 3, 1))} ${s(pt(59, 34))}`,
    // Inner curve of secondary plume dropping back to the central sky circle (R=50) at 68°
    `C ${s(tanPt(54, 42, 10, -2))} ${s(tanPt(50, 58, -8, 0))} ${s(pt(50, 72))}`,
    // Central sky arc (R=50) curving down to 132°, then easing smoothly to bottom cradle (82, 173°)
    arcTo(50, pt(50, 128), 1),
    `C ${s(tanPt(50, 128, 24, 4))} ${s(tanPt(72, 158, -12, -2))} ${s(pt(82, 172))}`,
    // Soft rounded base connecting back to pA (104, 173°)
    `C ${s(pt(90, 175))} ${s(pt(98, 175))} ${s(pA)} Z`,
  ].join(' ');

  // WAIT: check if the outer wingtips flaring slightly UP & OUT (or staying circular) looks better!
  // Let's also make sure the lower-inner mass doesn't look too thick compared to upper plumes!
  // At 173°, R goes from 82 to 104 = 22u thick (matches plume 1's 22u thickness!).
  // At 98°–128°, the wing spine goes from R=50 to R=104 = 54u? WAIT — that's way too thick (54u vs 22u)!
  // Let's add a SECOND air channel below plume 2 OR shift the inner sky circle slightly lower (cy=136, r=58)
  // so the lower wing spine stays sleek and consistent (~26–30u) all the way around!
  // Let's fix that RIGHT NOW before rendering!
  const kamonR_clean = (() => {
    // 3 harmoniously stepped concentric feathers per side — wait, let's check thickness!
    // Outer circle R=104.
    // Plume 1 (uppermost): R 104..82 (thick 22u), tip at 12°, slot 1 runs down to 82° (gap 13u: R 82..69)
    // Plume 2 (middle):    R 69..51  (thick 18u), tip at 40°? Wait: below 82°, solid body spans R 51..104 = 53u unless we cut a 2nd feather!
    // YES! Cut a 2nd curved feather along the OUTER-LOWER flank (like real overlapping wing feathers fanning around a circle)!
    // Imagine:
    //   - Primary feather (top): sweeps from 112° (shoulder) up along R=104 to 14° (tip), thickness 24u -> inner edge at R=80
    //   - Secondary feather (mid): sweeps from 142° up along R=104? No, staggered along the circle!
    // Look at how a real Japanese Tsuru-maru (crane circle) draws layered wings:
    //   Three sweeping curved feathers shingle smoothly along the circular rim, each starting slightly lower
    //   and curving up & inward, with clean ~13-15u white arcs separating them!
    // Let's construct 3 graceful shingled circular plumes on each side (6 total around the circle, mirrored left/right):
    //   1. Upper primary plume: sweeps from (R=92, 118°) curving out to R=104 and soaring up to tip (R=94, 14°), inner arc R=76
    //   2. Middle plume:        sweeps from (R=86, 152°) curving out along R=94..72 up to tip (R=68, 46°)
    //   3. Lower plume:         sweeps from (R=84, 174°) curving smoothly along the lower arc up to tip (R=56, 88°)
    // WAIT A MINUTE!! Think about how that looks:
    //   - Plume 1 (outer high sweep): bottom-right (126°, R=102) -> arches up along R=104 to tip near top (14°, R=95), inner curve back to (118°, R=80)!
    //   - Plume 2 (mid sweeping arc): nestled inside/below! Starts at (154°, R=98) -> arches smoothly inside Plume 1 with 14u gap to tip (42°, R=68), inner curve back to (146°, R=76)!
    //   - Plume 3 (lower cradle arc): starts near bottom center (173°, R=94) -> sweeps gently upward along the inner rim to tip (76°, R=56), cradling a serene open center circle!
    // Wait: make sure the 3 plumes on the right side ALL visually belong to ONE sweeping wing (thickest in the middle, soft rounded roots aligned along the circular outer-bottom contour, curving up-inward like crane feathers!), and NONE of them pinch symmetrically at both ends like an onion!

    // Helper to create one graceful crescent-feather plume with a soft rounded root and delicate tapered tip:
    // Sweeps counter-clockwise (decreasing angle from startDeg up to tipDeg) along outer radius rOut and inner radius rIn.
    function circularPlume(startDeg, tipDeg, rOut, rIn, tipR) {
      const midDeg = (startDeg + tipDeg) / 2;
      const pStartOut = pt(rOut, startDeg);
      const pStartIn = pt(rIn, startDeg);
      const pTip = pt(tipR, tipDeg);
      // Outer curve: circular-ish smooth Bezier from startDeg up to tipDeg
      const span = startDeg - tipDeg;
      const kOut = span * 0.36;
      const kIn = span * 0.36;
      const pRootMid = pt((rOut + rIn) / 2, startDeg + 4.5); // rounded root cap!
      return [
        `M ${s(pStartOut)}`,
        // Smooth outer sweeping arch up to tip
        `C ${s(tanPt(rOut, startDeg, -kOut, 1))} ${s(tanPt(tipR + (rOut - tipR) * 0.45, tipDeg + span * 0.3, -kOut * 0.65, 3))} ${s(pTip)}`,
        // Smooth inner concave sweep back down to inner root
        `C ${s(tanPt(tipR - (tipR - rIn) * 0.35, tipDeg + span * 0.25, kIn * 0.6, -2))} ${s(tanPt(rIn, startDeg, -kIn, -2))} ${s(pStartIn)}`,
        // Soft rounded heel closing back to outer root (no sharp onion pinch at the bottom!)
        `Q ${s(pRootMid)} ${s(pStartOut)} Z`,
      ].join(' ');
    }

    // Plume 1 (outer high soaring wing plume): from 126° up to 11°, R 106..82 (thick 24u), tip curls gently inward at R=96
    const pl1 = circularPlume(126, 11, 106, 82, 95);
    // Plume 2 (middle sweeping wing plume): from 154° up to 44°, R 92..70 -> Wait, check radial overlap with Plume 1 at 126°!
    // At angle 126°, Plume 1 inner edge is at R=82. To have a clean 14u gap everywhere, Plume 2 outer edge near 126° must be <= 68!
    // WAIT: better yet, place Plume 1, 2, 3 cleanly with explicit math so gap is ALWAYS 14–16u!
    // Let's check radii at overlap angles:
    //   If Plume 1 stays in R=106..82 (angles 122° -> 12°),
    //   Plume 2 stays in R=88..66 from 154° -> 126°, then ducks smoothly to R=68..50 as it passes inside Plume 1 up to 44°?
    //   YES — OR even cleaner and more iconic: ONE unified sweeping wing body on each side with 2 clean carved feather cuts (just like a real wing!), where the lower base tapers cleanly to 24u at 172°!
    return pl1;
  })();

  // Let's build the UNIFIED 3-feather crane wing (right half) cleanly by tracing its exact contour!
  // Think of the right wing sitting along a circular envelope (R=104):
  //   - Bottom cradle at (136, 224) — rounded soft base, width ~22u
  //   - Outer back sweeps along R=104 from 172° up through 90° to 18°, tapering gracefully to Primary Tip 1 at (148, 28) [angle ~11°, R=102]
  //   - Plume 1 underside curves back along R=80 to rounded slot 1 at (R=80, 62°)
  //   - Air gap 1 (~14u wide): semicircular U-turn from (R=80, 62°) to (R=66, 65°)
  //   - Plume 2 sweeps up from (R=66, 65°) along R=68 to Secondary Tip 2 at (R=66, 36°),
  //     then its underside drops smoothly along R=52 down to rounded slot 2 at (R=56, 98°)
  //   - Wait: at 98°, if the wing body goes from R=56 to R=104, that's 48u thick unless the outer edge ALSO steps!
  //   AHA!! THAT'S THE SECRET OF REAL KAMON WINGS!!
  //   Real Japanese crane wings step on the **OUTER** edge (shingled feathers stepping UP from bottom-center to top!),
  //   keeping the **INNER** edge a clean, serene circular sky (`R=56`)!!
  //   OH!! VISUALIZE THAT!!
  //   - Inner sky = ONE pure, serene, luminous open circle (`r = 52`, centered at `(128, 126)`)!
  //   - Wrapped around that inner sky are **two symmetrical wings** rising from a soft rounded cradle at the bottom `(128, 212)`:
  //     - Their inner edge hugs the serene open circle `r = 52`!
  //     - Their **OUTER** edge fans gracefully upward into **3 shingled soaring feather tips** (each stepping outward & upward along the outer circle `R=104`, with crisp curved ~14u air-notches cutting cleanly between the feather tips from the outside!)
  //   WAIT A SECOND!! STOP AND PICTURE THAT!!
  //   - Look from far away (16 px): unmistakable **wings spread in a circle** cradling an open luminous center (like a winged halo / browser portal)!
  //   - Look up close (256 px): crisp, serene, unmistakably **Japanese kamon crane wings** — smooth circular inner sky, 3 lyrical outward-soaring feathered tiers on each side, zero onion look, zero laurel wreath look!
  const innerSkyR = 52;
  const craneR = [
    // Start at soft bottom-center outer notch (128, 226) -> actually leave a subtle 10u V-notch or clean rounded point at 6 o'clock
    `M ${s(pt(94, 174))}`,
    // Lower-outer tertiary feather sweeping outward-up along R~96 to tip 3 at (104, 124°)
    `C ${s(pt(98, 154))} ${s(pt(104, 138))} ${s(pt(106, 118))}`,
    // Notch 3 (sweeps inward along feather 3's upper curve to rounded root at R=76, 132°)
    `C ${s(pt(96, 124))} ${s(pt(86, 129))} ${s(pt(78, 134))}`,
    `C ${s(pt(74, 136))} ${s(pt(75, 126))} ${s(pt(80, 122))}`,
    // Middle secondary feather sweeping outward-up from R=80 to soaring tip 2 at (108, 74°)
    `C ${s(pt(94, 112))} ${s(pt(108, 96))} ${s(pt(108, 72))}`,
    // Notch 2 (sweeps gracefully inward along feather 2's upper curve to rounded root at R=76, 86°)
    `C ${s(pt(98, 79))} ${s(pt(87, 84))} ${s(pt(78, 89))}`,
    `C ${s(pt(74, 91))} ${s(pt(74, 80))} ${s(pt(79, 75))}`,
    // Upper primary feather soaring high around the crown to graceful inward tip 1 at (92, 16°)
    `C ${s(pt(96, 62))} ${s(pt(106, 38))} ${s(pt(92, 14))}`,
    // Smooth inner edge of primary wing curving gently down into the serene circular sky (r=52)
    `C ${s(pt(76, 22))} ${s(pt(58, 42))} ${s(pt(54, 68))}`,
    // Pure circular inner sky arc (r=54) sweeping down to 146°
    arcTo(54, pt(54, 144), 1),
    // Softly tapering into bottom inner base (70, 174°) and closing cleanly back to (94, 174°)
    `C ${s(pt(58, 160))} ${s(pt(64, 170))} ${s(pt(72, 174))}`,
    `Q ${s(pt(83, 177))} ${s(pt(94, 174))} Z`,
  ].join(' ');

  const craneL = mirrorX(craneR, 128);
  return wrapSvg(
    'Wings logo — Concept B (Tsuru Kamon v2)',
    'B v2 - Tsuru Kamon: twin Japanese crane wings embracing a luminous circular sky with three shingled feather tiers',
    `  <path fill="#000000" d="${craneR} ${craneL}"/>`
  );
}

// ---------------------------------------------------------------------------
// Concept C (v2): Plume W — Serene calligraphic paired wings forming letter W
// Symmetric around x=128. Constructed as TWO gracefully mirrored wings that
// meet in the center to form a fluid, airy W:
//   - Each outer wing arm sweeps gracefully UP & OUT with TWO lush layered
//     feathers separated by a wide (~16u) curved air-channel carved cleanly
//     into the outer flank (so zero tacked-on shards or pinch junctions!).
//   - Smooth rounded lower troughs (y≈206) and a light, rising calligraphic
//     center peak (y≈88) so BOTH "W" and "wings" read effortlessly at 16 px!
// ---------------------------------------------------------------------------
function conceptC_v2() {
  // Let's trace the entire symmetric W as ONE continuous unified fluid path (or two seamlessly meeting halves)!
  // Actually, tracing the LEFT half cleanly from the center peak (128, 86) down to left trough,
  // up through two lush sweeping outer wing plumes, and back down to the underside of center peak (128, 134),
  // then mirroring across x=128 — Wait: if we connect both halves into ONE closed path, there's zero center seam!
  // Let's define left-side points carefully, then reflect right-side points cleanly!
  // Key landmarks (on 256x256):
  //   Center peak top:     (128, 88)
  //   Center peak bottom:  (128, 138)
  //   Left valley inner:   (88, 162)
  //   Left trough bottom:  (82, 206)
  //   Primary upper tip:   (16, 46)   -- soaring outward-upward graceful wingtip!
  //   Air-cut root (inner):(66, 136)  -- smooth rounded U-cut separating upper & lower outer plumes
  //   Secondary lower tip: (22, 118)  -- graceful secondary curved feather flaring below primary tip!

  const wPath = [
    // Start at center peak apex
    'M 128,86',
    // Descend gracefully along inner-left side of center peak into left inner valley
    'C 114,96 100,126 88,162',
    // Sweep smoothly UP-LEFT along the inner edge of the soaring left primary wingtip
    'C 72,112 52,66 16,44',
    // Outer leading arch of primary plume curving back-down toward the air-channel
    'C 22,74 36,102 58,124',
    // Smooth rounded inner bend of the air-channel (wide, luminous ~15u separation!)
    'C 64,130 57,139 49,134',
    // Upper curve of secondary wing plume flaring gracefully out to tip 2 at (22, 118)
    'C 40,128 30,122 22,118',
    // Lower sweeping curve of secondary plume flowing seamlessly into the rounded left bottom trough!
    'C 30,156 50,188 74,204',
    // Soft rounded trough turning upward toward center arch
    'C 84,211 98,208 104,196',
    // Rise along underside of center peak to center-bottom apex (128, 138)
    'C 114,174 121,152 128,138',
    // --- MIRRORED RIGHT HALF ---
    // Descend from center-bottom apex into rounded right trough
    'C 135,152 142,174 152,196',
    'C 158,208 172,211 182,204',
    // Sweep out-up along lower curve of right secondary plume to tip 2 at (234, 118)
    'C 206,188 226,156 234,118',
    // Upper curve of right secondary plume back into rounded air-channel
    'C 226,122 216,128 207,134',
    'C 199,139 192,130 198,124',
    // Outer arch of right primary plume soaring up to right wingtip at (240, 44)
    'C 220,102 234,74 240,44',
    // Inner edge of right primary plume sweeping down into right inner valley
    'C 204,66 184,112 168,162',
    // Rise along inner-right edge back to center peak apex (128, 86)
    'C 156,126 142,96 128,86 Z',
  ].join(' ');

  return wrapSvg(
    'Wings logo — Concept C (Plume W v2)',
    'C v2 - Plume W: single fluid calligraphic W whose twin soaring arms split cleanly into paired curved wing plumes',
    `  <path fill="#000000" d="${wPath}"/>`
  );
}

fs.writeFileSync(path.join(here, 'a-hane-v2.svg'), conceptA_v2());
fs.writeFileSync(path.join(here, 'b-tsuru-v2.svg'), conceptB_v2());
fs.writeFileSync(path.join(here, 'c-plume-w-v2.svg'), conceptC_v2());
console.log('written v2 concepts');
