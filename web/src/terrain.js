import * as THREE from 'three';
import { BLOCK, OCEAN, surfaceHeight } from './geology.js';
import { STRATA_VERT_PARS, STRATA_VERT, STRATA_FRAG_PARS, STRATA_FRAG } from './strataShader.js';

export function createStrataMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uHighlight = uniforms.uHighlight;
    shader.uniforms.uGreen = uniforms.uGreen;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${STRATA_VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${STRATA_VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${STRATA_FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${STRATA_FRAG}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;');
  };
  return mat;
}

function buildTop(nx, nz) {
  const { xMin, xMax, zMin, zMax } = BLOCK;
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  let k = 0;
  for (let j = 0; j <= nz; j++) {
    const z = zMin + ((zMax - zMin) * j) / nz;
    for (let i = 0; i <= nx; i++) {
      const x = xMin + ((xMax - xMin) * i) / nx;
      pos[k++] = x; pos[k++] = surfaceHeight(x, z); pos[k++] = z;
    }
  }
  const idx = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('top', new THREE.BufferAttribute(new Float32Array((nx + 1) * (nz + 1)).fill(1), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Vertical wall along an edge. Traversal direction `dir` must satisfy dir × up = outward.
function buildWall(start, dir, length, n, outward) {
  const pos = [], nor = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const x = start[0] + (dir[0] * length * i) / n;
    const z = start[1] + (dir[1] * length * i) / n;
    pos.push(x, surfaceHeight(x, z), z, x, BLOCK.yBottom, z);
    nor.push(...outward, ...outward);
  }
  for (let i = 0; i < n; i++) {
    const t0 = 2 * i, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
    idx.push(b0, b1, t0, t0, b1, t1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('top', new THREE.BufferAttribute(new Float32Array(pos.length / 3), 1));
  g.setIndex(idx);
  return g;
}

function buildBottom() {
  const { xMin, xMax, zMin, zMax, yBottom: y } = BLOCK;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([xMin, y, zMin, xMax, y, zMin, xMin, y, zMax, xMax, y, zMax], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0], 3));
  g.setAttribute('top', new THREE.BufferAttribute(new Float32Array(4), 1));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  return g;
}

export function createBlock(uniforms) {
  const { xMin, xMax, zMin, zMax } = BLOCK;
  const W = xMax - xMin, D = zMax - zMin;
  const mat = createStrataMaterial(uniforms);
  const group = new THREE.Group();

  const geoms = [
    buildTop(300, 160),
    buildWall([xMin, zMax], [1, 0], W, 600, [0, 0, 1]),   // front (+z)
    buildWall([xMax, zMin], [-1, 0], W, 600, [0, 0, -1]), // back (-z)
    buildWall([xMax, zMax], [0, -1], D, 320, [1, 0, 0]),  // right (+x)
    buildWall([xMin, zMin], [0, 1], D, 320, [-1, 0, 0]),  // left (-x)
    buildBottom(),
  ];
  for (const g of geoms) {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  // ocean: thin water slab inset slightly so block walls win where they overlap
  const e = 0.01;
  const ow = OCEAN.xMax - OCEAN.xMin - e, od = OCEAN.zMax - OCEAN.zMin - e;
  const water = new THREE.Mesh(
    new THREE.BoxGeometry(ow, 0.7, od),
    new THREE.MeshStandardMaterial({ color: 0x1d5878, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.82 }),
  );
  water.position.set(OCEAN.xMin + e + ow / 2, OCEAN.level - 0.35, OCEAN.zMin + e + od / 2);
  water.receiveShadow = true;
  group.add(water);

  return { group, material: mat };
}

export function createAtmosphereBox(atm) {
  const w = atm.xMax - atm.xMin, h = atm.yMax - atm.yMin, d = atm.zMax - atm.zMin;
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshBasicMaterial({ color: 0x9cc8ff, transparent: true, opacity: 0.05, depthWrite: false });
  const box = new THREE.Mesh(geo, mat);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }),
  );
  const g = new THREE.Group();
  g.add(box, edges);
  g.position.set(atm.xMin + w / 2, atm.yMin + h / 2, atm.zMin + d / 2);
  return { group: g, material: mat };
}
