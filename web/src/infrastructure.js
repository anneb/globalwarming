import * as THREE from 'three';
import { BLOCK, COAL, surfaceHeight, yAtDepth, coalThickness } from './geology.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function cylinderBetween(a, b, r, mat) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 12), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
  m.castShadow = true;
  return m;
}

// Smooth route over the terrain surface through control points (x, z).
function surfaceRoute(ctrl, lift, samples = 40) {
  const curve = new THREE.CatmullRomCurve3(ctrl.map(([x, z]) => V(x, 0, z)));
  return curve.getSpacedPoints(samples).map((p) => V(p.x, surfaceHeight(p.x, p.z) + lift, p.z));
}

export function createInfrastructure() {
  const g = new THREE.Group();
  const Z = BLOCK.zMax;
  const F = Z + 0.07; // particle lane just in front of the cut face
  const metal = new THREE.MeshStandardMaterial({ color: 0x4a4e55, roughness: 0.45, metalness: 0.7 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xbdb7ab, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.95 });
  const lattice = new THREE.MeshBasicMaterial({ color: 0x222222, wireframe: true });

  // --- oil/gas well
  const wx = 0.5, wTop = surfaceHeight(wx, Z), wBot = yAtDepth(wx, Z, 2.02); // oil leg of the trap
  g.add(cylinderBetween(V(wx, wBot, Z), V(wx, wTop + 0.15, Z), 0.05, metal));
  const derrick = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 4, 4, true), lattice);
  derrick.position.set(wx, wTop + 0.45, Z - 0.25);
  g.add(derrick);

  // --- coal mine: shaft + gallery along the seam
  const seamD = (x) => COAL.top + 0.5 * coalThickness(x, Z);
  const mx = 3.2, mTop = surfaceHeight(mx, Z), mBot = yAtDepth(mx, Z, seamD(mx));
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.22, mTop - mBot, 0.3), dark);
  shaft.position.set(mx, (mTop + mBot) / 2, Z - 0.1);
  g.add(shaft);
  const galleryPts = [];
  for (let x = 1.8; x <= 4.8; x += 0.1) galleryPts.push(V(x, yAtDepth(x, Z, seamD(x)), Z));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(galleryPts), 60, 0.07, 8), dark));
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.75, 3, 3, true), lattice);
  head.position.set(mx, mTop + 0.37, Z - 0.15);
  g.add(head);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.018, 8, 24), metal);
  wheel.position.set(mx, mTop + 0.72, Z - 0.15);
  g.add(wheel);

  // --- power plant
  const px = -2, pz = 5.5, pTop = surfaceHeight(px, pz);
  const hall = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.35, 0.6), concrete);
  hall.position.set(px, pTop + 0.17, pz);
  const hall2 = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, 0.45), concrete);
  hall2.position.set(px + 0.35, pTop + 0.27, pz + 0.45);
  for (const m of [hall, hall2]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  const chimneyBase = V(px + 0.5, pTop, pz - 0.15);
  const chimneyTop = V(px + 0.5, pTop + 1.4, pz - 0.15);
  g.add(cylinderBetween(chimneyBase, chimneyTop, 0.07, concrete));
  const towerProfile = [];
  for (let i = 0; i <= 16; i++) {
    const y = (0.75 * i) / 16;
    towerProfile.push(new THREE.Vector2(0.16 * Math.sqrt(1 + ((y - 0.5) / 0.22) ** 2), y));
  }
  const tower = new THREE.Mesh(new THREE.LatheGeometry(towerProfile, 32), new THREE.MeshStandardMaterial({ color: 0xc9c4b8, roughness: 0.9, side: THREE.DoubleSide }));
  tower.position.set(px - 0.75, pTop - 0.02, pz + 0.25);
  tower.castShadow = true;
  g.add(tower);

  // --- surface transport (conveyor / pipeline)
  const coalRoute = surfaceRoute([[mx, Z - 0.1], [2.2, 7.0], [0.4, 6.0], [chimneyBase.x, chimneyBase.z]], 0.05);
  const oilRoute = surfaceRoute([[wx, Z - 0.1], [-0.4, 6.8], [chimneyBase.x, chimneyBase.z]], 0.05);
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0x5b5148, roughness: 0.7 });
  for (const r of [coalRoute, oilRoute]) {
    const t = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(r), 80, 0.035, 6), tubeMat);
    t.castShadow = true;
    g.add(t);
  }

  const lift = (pts) => pts.map((p) => V(p.x, p.y + 0.04, p.z));
  const paths = {
    coal: [
      V(4.8, yAtDepth(4.8, Z, seamD(4.8)), F),
      ...galleryPts.filter((p) => p.x >= mx).reverse().map((p) => V(p.x, p.y, F)),
      V(mx, mTop, F),
      ...lift(coalRoute),
      chimneyTop.clone(),
    ],
    oil: [V(wx, wBot, F), V(wx, wTop, F), ...lift(oilRoute), chimneyTop.clone()],
  };

  // --- wind turbines: appear as fossil emissions are phased out
  const turbines = [];
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
  const sites = [[-3.5, -5.5], [-1.5, -6.2], [0.5, -5.2], [2.5, -6.0], [-2.5, -2.8], [-0.4, -3.2], [1.6, -2.6], [3.6, -3.4], [-3.0, 0.2], [-1.0, -0.4], [1.2, 0.3], [3.0, -0.6]];
  for (const [x, z] of sites) {
    const t = new THREE.Group();
    const mast = cylinderBetween(V(0, 0, 0), V(0, 0.75, 0), 0.018, bladeMat);
    const rotor = new THREE.Group();
    rotor.position.set(0, 0.75, 0.04);
    for (let k = 0; k < 3; k++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.34, 0.01), bladeMat);
      blade.position.y = 0.17;
      blade.castShadow = true;
      const arm = new THREE.Group();
      arm.rotation.z = (k * 2 * Math.PI) / 3;
      arm.add(blade);
      rotor.add(arm);
    }
    t.add(mast, rotor);
    t.position.set(x, surfaceHeight(x, z), z);
    t.rotation.y = 0.5;
    t.visible = false;
    t.userData.rotor = rotor;
    g.add(t);
    turbines.push(t);
  }

  return {
    group: g,
    turbines,
    paths,
    anchors: {
      well: V(wx, wTop + 1.6, Z),
      mine: V(mx, mTop + 1.5, Z),
      plant: V(chimneyTop.x, chimneyTop.y + 0.9, chimneyTop.z),
    },
  };
}
