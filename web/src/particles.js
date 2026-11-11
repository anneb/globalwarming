import * as THREE from 'three';
import { OCEAN, surfaceHeight } from './geology.js';
import { BERN } from './sim.js';

export const UNIT = 0.05; // GtC represented by one particle
export const KIND = { BASE: 0, NATURAL: 1, HUMAN: 2 };
export const ATM = { xMin: -15, xMax: 15, yMin: 3.6, yMax: 11, zMin: -8, zMax: 8 };

const MAX = 60000;
const ST = { FREE: 0, PATH: 1, RISE: 2, DRIFT: 3, SINK: 4, FADE: 5, SEASON: 6 };
// CO2 is well mixed through the atmosphere within ~1-2 years.
const MIX_YEARS = 1.5;
const NATURAL_TAU = 15; // years a natural particle stays airborne (display choice; flux is balanced)

export const COLORS = {
  base: [0.6, 0.76, 1.0],
  natural: [1.0, 1.0, 0.94],
  fossil: [1.0, 0.72, 0.25],
  human: [1.0, 0.33, 0.1],
  land: [0.35, 0.85, 0.4],
  leaf: [0.45, 0.95, 0.35],
  ocean: [0.3, 0.78, 0.98],
};

export class CarbonParticles {
  constructor(rng) {
    this.rng = rng;
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.alpha = new Float32Array(MAX);
    this.size = new Float32Array(MAX);
    this.state = new Uint8Array(MAX);
    this.kind = new Uint8Array(MAX);
    this.mixed = new Uint8Array(MAX);
    this.age = new Float32Array(MAX);  // years airborne
    this.life = new Float32Array(MAX); // years until uptake (Infinity = stays)
    this.vel = new Float32Array(MAX * 3);
    this.tgt = new Float32Array(MAX * 3); // mixing target, later sink target
    this.ty = new Float32Array(MAX);
    this.pathId = new Int16Array(MAX);
    this.seg = new Int16Array(MAX);
    this.dist = new Float32Array(MAX);
    this.paths = [];
    this.season = { idx: [], ground: [], air: [], th: [], plantFrac: 0.5 };
    this.free = [];
    for (let i = MAX - 1; i >= 0; i--) this.free.push(i);

    const g = new THREE.BufferGeometry();
    const dyn = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', dyn(this.pos, 3));
    g.setAttribute('aColor', dyn(this.col, 3));
    g.setAttribute('aAlpha', dyn(this.alpha, 1));
    g.setAttribute('aSize', dyn(this.size, 1));
    this.geometry = g;

    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aAlpha;
        attribute float aSize;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aAlpha > 0.0 ? max(1.5, aSize * uScale / -mv.z) : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = length(c);
          if (r > 0.5 || vAlpha <= 0.0) discard;
          float a = 1.0 - smoothstep(0.2, 0.5, r);
          gl_FragColor = vec4(vColor * (0.85 + 0.5 * (1.0 - 2.0 * r)), vAlpha * a);
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  // world-unit point size: height / (2 tan(fov/2))
  setViewport(heightPx, fovDeg) {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  addPath(points, speed) {
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + points[i].distanceTo(points[i - 1]));
    this.paths.push({ pts: points, cum, len: cum[cum.length - 1], speed });
    return this.paths.length - 1;
  }

  _alloc() {
    return this.free.length ? this.free.pop() : -1;
  }

  _release(i) {
    this.state[i] = ST.FREE;
    this.alpha[i] = 0;
    this.free.push(i);
  }

  _setColor(i, c) {
    this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
  }

  _setPos(i, x, y, z) {
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
  }

  _randomAtmTarget(i) {
    const r = this.rng;
    this.tgt[i * 3] = ATM.xMin + 0.3 + r() * (ATM.xMax - ATM.xMin - 0.6);
    this.tgt[i * 3 + 1] = ATM.yMin + 0.3 + r() * (ATM.yMax - ATM.yMin - 0.6);
    this.tgt[i * 3 + 2] = ATM.zMin + 0.3 + r() * (ATM.zMax - ATM.zMin - 0.6);
  }

  // Lifetime drawn from the same Bern response that drives the ppm counter,
  // so the number of orange particles left airborne tracks the model.
  _fate(i, kind) {
    const r = this.rng;
    if (kind === KIND.NATURAL) { this.life[i] = -NATURAL_TAU * Math.log(1 - r()); return; }
    if (kind === KIND.BASE) { this.life[i] = Infinity; return; }
    let u = r();
    for (const { a, tau } of BERN) {
      if (u < a) { this.life[i] = tau === Infinity ? Infinity : -tau * Math.log(1 - r()); return; }
      u -= a;
    }
    this.life[i] = Infinity;
  }

  spawnBaseline(n) {
    const r = this.rng;
    for (let k = 0; k < n; k++) {
      const i = this._alloc(); if (i < 0) return;
      this._setPos(i,
        ATM.xMin + r() * (ATM.xMax - ATM.xMin),
        ATM.yMin + r() * (ATM.yMax - ATM.yMin),
        ATM.zMin + r() * (ATM.zMax - ATM.zMin));
      this.vel.fill(0, i * 3, i * 3 + 3);
      this.state[i] = ST.DRIFT; this.kind[i] = KIND.BASE; this.age[i] = 0; this.mixed[i] = 1;
      this._fate(i, KIND.BASE);
      this._setColor(i, COLORS.base); this.alpha[i] = 0.38; this.size[i] = 0.09;
    }
  }

  // Fixed set of particles that move into the vegetation in summer and back
  // out in winter: the net seasonal swing. Each has a threshold so the share
  // inside plants follows plantFrac exactly.
  spawnSeasonal(n) {
    const r = this.rng, S = this.season;
    for (let k = 0; k < n; k++) {
      const i = this._alloc(); if (i < 0) return;
      let x, z;
      do { x = -6 + r() * 11; z = -7.5 + r() * 15; } while (Math.hypot(x + 7, z - 8) < 4.5);
      const gy = surfaceHeight(x, z) + 0.06;
      const ax = ATM.xMin + r() * (ATM.xMax - ATM.xMin);
      const ay = ATM.yMin + r() * (ATM.yMax - ATM.yMin);
      const az = ATM.zMin + r() * (ATM.zMax - ATM.zMin);
      S.idx.push(i); S.ground.push(x, gy, z); S.air.push(ax, ay, az); S.th.push((k + 0.5) / n);
      this._setPos(i, ax, ay, az);
      this.state[i] = ST.SEASON; this.kind[i] = KIND.BASE;
      this._setColor(i, COLORS.base); this.alpha[i] = 0.5; this.size[i] = 0.1;
    }
  }

  // Fraction (0..1) of the seasonal swing currently stored in plants.
  setPlantFraction(f) {
    this.season.plantFrac = f;
  }

  _updateSeasonal(dt) {
    const S = this.season, P = this.pos, k = 1 - Math.exp(-4 * dt);
    const t = this.clockSec || 0;
    for (let j = 0; j < S.idx.length; j++) {
      const i = S.idx[j], i3 = i * 3, j3 = j * 3;
      const inPlant = S.th[j] < S.plantFrac;
      const src = inPlant ? S.ground : S.air;
      const wob = inPlant ? 0 : 0.25;
      const tx = src[j3] + wob * Math.sin(t * 0.3 + j);
      const ty = src[j3 + 1] + wob * Math.sin(t * 0.23 + j * 1.7);
      const tz = src[j3 + 2] + wob * Math.cos(t * 0.27 + j * 0.9);
      P[i3] += (tx - P[i3]) * k; P[i3 + 1] += (ty - P[i3 + 1]) * k; P[i3 + 2] += (tz - P[i3 + 2]) * k;
      const g = Math.min(1, Math.max(0, 1 - (P[i3 + 1] - S.ground[j3 + 1]) / 2.5));
      for (let c = 0; c < 3; c++) this.col[i3 + c] = COLORS.base[c] + (COLORS.leaf[c] - COLORS.base[c]) * g;
      this.alpha[i] = 0.5 + 0.45 * g;
      this.size[i] = 0.1 + 0.05 * g;
    }
  }

  spawnPath(pid, kind) {
    const i = this._alloc(); if (i < 0) return;
    const p0 = this.paths[pid].pts[0];
    this._setPos(i, p0.x, p0.y, p0.z);
    this.state[i] = ST.PATH; this.kind[i] = kind; this.pathId[i] = pid; this.seg[i] = 0;
    this.dist[i] = this.rng() * 0.3; this.age[i] = 0;
    this._fate(i, kind);
    this._setColor(i, kind === KIND.HUMAN ? COLORS.fossil : COLORS.natural);
    this.alpha[i] = 0.95; this.size[i] = 0.13;
  }

  spawnRise(x, y, z, kind, speed = 0.5) {
    const i = this._alloc(); if (i < 0) return;
    this._setPos(i, x, y, z);
    this.kind[i] = kind; this.age[i] = 0;
    this._fate(i, kind);
    this._setColor(i, kind === KIND.HUMAN ? COLORS.human : COLORS.natural);
    this.alpha[i] = 0.95; this.size[i] = 0.13;
    this._startRise(i, speed);
  }

  _startRise(i, speed) {
    const r = this.rng;
    this.state[i] = ST.RISE;
    this.ty[i] = ATM.yMin + r() * 1.5;
    this.vel[i * 3] = (r() - 0.5) * 0.4;
    this.vel[i * 3 + 1] = speed * (0.8 + r() * 0.6);
    this.vel[i * 3 + 2] = (r() - 0.5) * 0.4;
    if (this.kind[i] === KIND.HUMAN) { this._setColor(i, COLORS.human); this.size[i] = 0.15; }
  }

  _startSink(i) {
    const r = this.rng;
    let x, y, z, c;
    if (r() < 0.5) { // ocean uptake
      x = OCEAN.xMin + 0.5 + r() * (OCEAN.xMax - OCEAN.xMin - 2);
      z = OCEAN.zMin + 0.5 + r() * (OCEAN.zMax - OCEAN.zMin - 2);
      y = OCEAN.level; c = COLORS.ocean;
    } else {         // land uptake: forests and soils on the plains
      x = -4 + r() * 9; z = -7 + r() * 13;
      y = surfaceHeight(x, z) + 0.05; c = COLORS.land;
    }
    this.tgt[i * 3] = x; this.tgt[i * 3 + 1] = y; this.tgt[i * 3 + 2] = z;
    this.state[i] = ST.SINK;
    this._mixColor(i, c, 0.5);
  }

  _mixColor(i, c, t) {
    for (let k = 0; k < 3; k++) this.col[i * 3 + k] += (c[k] - this.col[i * 3 + k]) * t;
  }

  reset() {
    this.season = { idx: [], ground: [], air: [], th: [], plantFrac: 0.5 };
    this.free.length = 0;
    for (let i = MAX - 1; i >= 0; i--) { this.state[i] = ST.FREE; this.alpha[i] = 0; this.free.push(i); }
  }

  // dt: display seconds; yrs: simulated years in this step (0 when time is frozen).
  update(dt, yrs) {
    const r = this.rng, P = this.pos, V = this.vel, T = this.tgt;
    const speed = dt > 0 ? yrs / dt : 0; // years per second
    const tempo = Math.min(2, Math.max(0.6, Math.sqrt(speed / 4)));
    // mixing: fraction of remaining distance closed this step (capped for readability)
    const mixRate = Math.min(1.2, speed / MIX_YEARS);
    const mixK = 1 - Math.exp(-mixRate * dt);

    for (let i = 0; i < MAX; i++) {
      const s = this.state[i];
      if (s === ST.FREE) continue;
      const i3 = i * 3;
      if (s === ST.PATH) {
        const path = this.paths[this.pathId[i]];
        const d = (this.dist[i] += path.speed * tempo * dt);
        if (d >= path.len) {
          const e = path.pts[path.pts.length - 1];
          this._setPos(i, e.x, e.y, e.z);
          this._startRise(i, this.kind[i] === KIND.HUMAN ? 0.9 : 0.6);
          continue;
        }
        let k = this.seg[i];
        while (k < path.cum.length - 2 && path.cum[k + 1] < d) k++;
        this.seg[i] = k;
        const a = path.pts[k], b = path.pts[k + 1];
        const t = (d - path.cum[k]) / (path.cum[k + 1] - path.cum[k] || 1);
        this._setPos(i, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      } else if (s === ST.RISE) {
        const f = tempo * dt;
        P[i3] += V[i3] * f; P[i3 + 1] += V[i3 + 1] * f; P[i3 + 2] += V[i3 + 2] * f;
        if (P[i3 + 1] >= this.ty[i]) {
          this.state[i] = ST.DRIFT; this.age[i] = 0; this.mixed[i] = 0;
          this._randomAtmTarget(i);
        }
      } else if (s === ST.DRIFT) {
        this.age[i] += yrs;
        if (!this.mixed[i]) {
          // fresh emission spreads out to its own random spot in the atmosphere
          P[i3] += (T[i3] - P[i3]) * mixK;
          P[i3 + 1] += (T[i3 + 1] - P[i3 + 1]) * mixK;
          P[i3 + 2] += (T[i3 + 2] - P[i3 + 2]) * mixK;
          const dx = T[i3] - P[i3], dy = T[i3 + 1] - P[i3 + 1], dz = T[i3 + 2] - P[i3 + 2];
          if (dx * dx + dy * dy + dz * dz < 0.25) { this.mixed[i] = 1; V[i3] = V[i3 + 1] = V[i3 + 2] = 0; }
        } else {
          // mixed gas: independent random walk (diffusion), reflected at the box walls
          V[i3] = V[i3] * 0.97 + (r() - 0.5) * 0.15;
          V[i3 + 1] = V[i3 + 1] * 0.97 + (r() - 0.5) * 0.1;
          V[i3 + 2] = V[i3 + 2] * 0.97 + (r() - 0.5) * 0.15;
          P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
          if (P[i3] < ATM.xMin) { P[i3] = ATM.xMin; V[i3] = Math.abs(V[i3]); }
          if (P[i3] > ATM.xMax) { P[i3] = ATM.xMax; V[i3] = -Math.abs(V[i3]); }
          if (P[i3 + 1] < ATM.yMin) { P[i3 + 1] = ATM.yMin; V[i3 + 1] = Math.abs(V[i3 + 1]); }
          if (P[i3 + 1] > ATM.yMax) { P[i3 + 1] = ATM.yMax; V[i3 + 1] = -Math.abs(V[i3 + 1]); }
          if (P[i3 + 2] < ATM.zMin) { P[i3 + 2] = ATM.zMin; V[i3 + 2] = Math.abs(V[i3 + 2]); }
          if (P[i3 + 2] > ATM.zMax) { P[i3 + 2] = ATM.zMax; V[i3 + 2] = -Math.abs(V[i3 + 2]); }
        }
        if (this.age[i] > this.life[i]) this._startSink(i);
      } else if (s === ST.SINK) {
        const dx = T[i3] - P[i3], dy = T[i3 + 1] - P[i3 + 1], dz = T[i3 + 2] - P[i3 + 2];
        const len = Math.hypot(dx, dy, dz);
        const step = 2.5 * tempo * dt;
        if (len <= step) {
          P[i3] = T[i3]; P[i3 + 1] = T[i3 + 1]; P[i3 + 2] = T[i3 + 2];
          this.state[i] = ST.FADE;
        } else {
          P[i3] += (dx / len) * step; P[i3 + 1] += (dy / len) * step; P[i3 + 2] += (dz / len) * step;
        }
      } else if (s === ST.FADE) {
        this.alpha[i] -= dt * 1.2 * tempo;
        if (this.alpha[i] <= 0) this._release(i);
      }
    }
    this.clockSec = (this.clockSec || 0) + dt;
    this._updateSeasonal(dt);
    const a = this.geometry.attributes;
    a.position.needsUpdate = true; a.aColor.needsUpdate = true; a.aAlpha.needsUpdate = true; a.aSize.needsUpdate = true;
  }
}
