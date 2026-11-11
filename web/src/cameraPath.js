import * as THREE from 'three';

// Film camera: keyframes [time s, position, target]. After the last key the
// camera keeps orbiting slowly around the block.
const KEYS = [
  [0, [-9, 26, 14], [-7, 1, 5]],          // high above the volcano
  [6, [-8, 7, 21], [-7, 0, 8]],           // descend toward the cut face
  [11, [-6, -3.5, 22], [-6.5, -3.5, 8]],  // magma chamber in section
  [16, [0, -1.5, 21], [-0.5, -1.5, 8]],   // coal, oil & gas layers
  [21, [12, 2, 20], [9, 0, 6]],           // uplifted, eroded mountains
  [27, [-4, 22, 20], [-2, 1, 0]],         // over the forests: seasonal breathing
  [33, [26, 16, 34], [0, 0, 0]],          // overview with atmosphere
];
export const TOUR_END = KEYS[KEYS.length - 1][0];

const posCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k[1])), false, 'centripetal');
const tgtCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k[2])), false, 'centripetal');

function param(t) {
  const n = KEYS.length - 1;
  if (t <= 0) return 0;
  for (let i = 0; i < n; i++) {
    const t0 = KEYS[i][0], t1 = KEYS[i + 1][0];
    if (t <= t1) {
      let u = (t - t0) / (t1 - t0);
      if (i === 0) u = u * u * (3 - 2 * u) * 0.5 + u * 0.5; // soft start
      return (i + u) / n;
    }
  }
  return 1;
}

const last = KEYS[KEYS.length - 1];
const R = Math.hypot(last[1][0], last[1][2]);
const A0 = Math.atan2(last[1][0], last[1][2]);

export function cameraAt(t, pos, target) {
  if (t <= TOUR_END) {
    const u = param(t);
    posCurve.getPoint(u, pos);
    tgtCurve.getPoint(u, target);
  } else {
    const a = A0 - (t - TOUR_END) * 0.02;
    pos.set(R * Math.sin(a), last[1][1], R * Math.cos(a));
    target.set(...last[2]);
  }
}
