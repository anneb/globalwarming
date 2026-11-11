// Shared geology model (units: km). The GLSL in strataShader.js mirrors
// uplift/fold/depth so CPU-side placement (pipes, labels, outcrops) matches
// what the shader draws.

export const BLOCK = { xMin: -15, xMax: 15, zMin: -8, zMax: 8, yBottom: -10 };
export const SED_TOP = 0.3; // original top of sediment pile
export const VOLCANO = { x: -7, z: 8, height: 3.0, radius: 3.2, craterR: 0.6, craterDepth: 0.8 };
export const MAGMA = { x: -7, y: -6.5, z: 8, rx: 3.0, ry: 1.4, rz: 2.4 };
export const OCEAN = { xMin: -15, xMax: -8, zMin: -8, zMax: -1, level: 0.0 };

// Oil/gas only accumulates in traps: domes in the porous reservoir layer,
// sealed by shale above. Elsewhere that sandstone holds salt water.
export const POCKETS = [
  { x: 0.5, z: 8.0, r: 1.4 },   // tapped by the well, visible in the front section
  { x: -11.0, z: 3.0, r: 1.6 },
  { x: -2.5, z: -4.0, r: 1.3 },
  { x: 6.5, z: -2.0, r: 1.2 },
];
export const RESERVOIR = { top: 1.9, bottom: 2.3 };
export const COAL = { top: 0.9, second: 1.3 };

// Layer table by depth below original sediment top (km). Thickness exaggerated
// (real coal seams are 1-10 m thick, here up to ~140 m).
export const LAYERS = [
  { id: 'veen', from: 0.0, to: 0.12, name: 'Veen', fossil: true },
  { id: 'zand', from: 0.12, to: 0.9, name: 'Zand & klei (met bruinkool)', fossil: false },
  { id: 'steenkool', from: 0.9, to: 0.97, name: 'Steenkoollagen (alleen in het kolenbekken)', fossil: true },
  { id: 'zandsteen', from: 1.05, to: 1.9, name: 'Zandsteen & schalie', fossil: false },
  { id: 'reservoir', from: 1.9, to: 2.3, name: 'Poreuze zandsteen (meestal zout water)', fossil: false },
  { id: 'schalie', from: 2.3, to: 3.1, name: 'Zwarte schalie: verspreid organisch materiaal, bron van olie & gas', fossil: true },
  { id: 'kalksteen', from: 3.1, to: 4.6, name: 'Kalksteen (carbonaat)', fossil: false },
  { id: 'graniet', from: 4.6, to: 99, name: 'Graniet (grondgebergte)', fossil: false },
];

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function uplift(x) {
  return 5.5 * smoothstep(2, 13, x);
}

export function fold(x, z) {
  return 0.35 * Math.sin(x * 0.45 + z * 0.25) + 0.2 * Math.sin(z * 0.8 - x * 0.2);
}

// Anticline domes above the oil/gas traps.
export function dome(x, z) {
  let s = 0;
  for (const p of POCKETS) {
    const dx = x - p.x, dz = z - p.z;
    s += 0.35 * Math.exp(-(dx * dx + dz * dz) / (p.r * p.r * 1.8));
  }
  return s;
}

// Coal seam thickness (km): only inside the coal basin, pinching out at its edges.
export function coalThickness(x, z) {
  const basin = smoothstep(-5, -2, x) * (1 - smoothstep(10, 13, x));
  return 0.14 * basin * (0.75 + 0.25 * Math.sin(z * 0.45 + x * 0.25));
}

// Depth (km) below original sediment top for a point; mirrors the shader (minus noise).
export function depthAt(x, y, z) {
  const d0 = SED_TOP - y + uplift(x);
  return d0 + fold(x, z) * smoothstep(0, 1.5, d0) + dome(x, z) * smoothstep(0.6, 1.8, d0);
}

// World y where a given layer depth occurs at (x, z). depthAt is monotone in y.
export function yAtDepth(x, z, d) {
  let lo = -14, hi = 12;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (depthAt(x, mid, z) > d) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function surfaceHeight(x, z) {
  let h = SED_TOP + 0.08 * Math.sin(x * 0.9 + 1.3) * Math.cos(z * 0.7) + 0.05 * Math.sin(x * 2.1 + z * 1.7);

  // volcano cone with crater
  const dx = x - VOLCANO.x, dz = z - VOLCANO.z;
  const r2 = dx * dx + dz * dz;
  h += VOLCANO.height * Math.exp(-r2 / (VOLCANO.radius * VOLCANO.radius));
  h -= VOLCANO.craterDepth * Math.exp(-r2 / (VOLCANO.craterR * VOLCANO.craterR));

  // mountain range on +x: uplifted, eroded strata
  const m = smoothstep(4, 11, x);
  const r1 = 1 - Math.abs(Math.sin(z * 0.7 + x * 0.35));
  const rr = 1 - Math.abs(Math.sin(z * 1.6 - x * 0.9 + 1.0));
  h += m * (0.8 + 1.4 * r1 * r1 + 0.6 * rr * rr + 0.15 * Math.sin(x * 3.3 + z * 2.7));

  // ocean basin, back-left
  h -= 0.9 * smoothstep(-8, -12, x) * smoothstep(-1, -5, z);
  return h;
}

export function surfaceNormalY(x, z, e = 0.05) {
  const gx = (surfaceHeight(x + e, z) - surfaceHeight(x - e, z)) / (2 * e);
  const gz = (surfaceHeight(x, z + e) - surfaceHeight(x, z - e)) / (2 * e);
  return 1 / Math.sqrt(1 + gx * gx + gz * gz);
}

// Surface points in the mountains where fossil-bearing strata crop out:
// here rock organic carbon slowly oxidises (natural return route 2).
export function findOutcrops() {
  const pts = [];
  for (let x = 4.5; x <= 15; x += 0.15) {
    for (let z = BLOCK.zMin + 0.2; z <= BLOCK.zMax - 0.2; z += 0.15) {
      const h = surfaceHeight(x, z);
      if (surfaceNormalY(x, z) > 0.85) continue; // needs bare, steep rock
      const d = depthAt(x, h, z);
      const ct = coalThickness(x, z);
      const coal = (d > COAL.top && d < COAL.top + ct) || (d > COAL.second && d < COAL.second + 0.5 * ct);
      if (coal || (d > 2.3 && d < 3.1)) pts.push([x, h, z]);
    }
  }
  return pts;
}
