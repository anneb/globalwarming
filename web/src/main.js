import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { BLOCK, LAYERS, VOLCANO, MAGMA, COAL, surfaceHeight, yAtDepth, coalThickness, findOutcrops } from './geology.js';
import { createBlock, createAtmosphereBox } from './terrain.js';
import { CarbonParticles, KIND, UNIT, ATM } from './particles.js';
import { Sim, NOW_YEAR, END_YEAR, MAX_FLUX, SCENARIOS, SEASON_GTC, seasonalAnomaly, greenness } from './sim.js';
import { createInfrastructure } from './infrastructure.js';
import { cameraAt, TOUR_END } from './cameraPath.js';
import './style.css';

const params = new URLSearchParams(location.search);
const RECORD = params.has('record');
const FPS = Number(params.get('fps')) || 30;
if (RECORD) document.body.classList.add('record');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261111);

// ---------- renderer, scene, camera
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: RECORD });
renderer.setPixelRatio(RECORD ? 1 : Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
app.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'labels';
app.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
{
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#3f6f9f');
  grd.addColorStop(0.6, '#9fbfd9');
  grd.addColorStop(1, '#e6ecef');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
}

const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 500);
camera.position.set(24, 12, 32);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, -1, 0);
controls.enableDamping = true;
controls.maxDistance = 120;

scene.add(new THREE.HemisphereLight(0xbcd8ff, 0x5a4632, 0.9));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(-14, 26, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 90 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.03;
scene.add(sun);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.ShadowMaterial({ opacity: 0.25 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = BLOCK.yBottom - 0.05;
floor.receiveShadow = true;
scene.add(floor);

// ---------- world
const uniforms = { uTime: { value: 0 }, uHighlight: { value: 0 }, uGreen: { value: 1 } };
const block = createBlock(uniforms);
scene.add(block.group);

const atmosphere = createAtmosphereBox(ATM);
scene.add(atmosphere.group);

const infra = createInfrastructure();
infra.group.visible = false;
scene.add(infra.group);

const particles = new CarbonParticles(rng);
scene.add(particles.points);

const Z = BLOCK.zMax;
const craterFloor = surfaceHeight(VOLCANO.x, VOLCANO.z);
const volcPath = particles.addPath(
  [new THREE.Vector3(MAGMA.x, MAGMA.y + MAGMA.ry - 0.2, Z + 0.07), new THREE.Vector3(VOLCANO.x, craterFloor, Z + 0.07)],
  2.0,
);
const coalPath = particles.addPath(infra.paths.coal, 3.0);
const oilPath = particles.addPath(infra.paths.oil, 3.0);
const outcrops = findOutcrops();

const sim = new Sim();

// ---------- labels
function tag(text, pos, cls = '') {
  const el = document.createElement('div');
  el.className = `tag ${cls}`;
  el.textContent = text;
  const o = new CSS2DObject(el);
  o.position.copy(pos);
  return o;
}
const natLabels = new THREE.Group();
const humanLabels = new THREE.Group();
const LX = -1.8;
for (const L of LAYERS) {
  if (L.id === 'veen') continue;
  const dMid = L.id === 'graniet' ? 7.5 : L.id === 'steenkool' ? COAL.top + 0.5 * coalThickness(LX, Z) : (L.from + L.to) / 2;
  natLabels.add(tag(L.name, new THREE.Vector3(LX, yAtDepth(LX, Z, dMid), Z + 0.05), L.fossil ? 'fossil' : ''));
}
natLabels.add(tag('Olie & gas: alleen in een "val" onder een koepel', new THREE.Vector3(2.1, yAtDepth(2.1, Z, 1.97), Z + 0.05), 'fossil'));
natLabels.add(tag('Magmakamer', new THREE.Vector3(MAGMA.x, MAGMA.y, Z + 0.05), 'hot'));
natLabels.add(tag('Vulkaan: CO₂ uit magma en verhit kalksteen', new THREE.Vector3(VOLCANO.x, craterFloor + 1.4, Z), 'route'));
natLabels.add(tag('Opgetilde lagen: erosie legt kolen en schalie bloot → oxidatie', new THREE.Vector3(10, 4.0, 3), 'route'));
natLabels.add(tag('Oceaan', new THREE.Vector3(-12, 0.3, -4.5)));
natLabels.add(tag('Atmosfeer (schematisch)', new THREE.Vector3(-11, ATM.yMax + 0.6, Z)));
for (let km = 0; km <= 10; km += 2) {
  natLabels.add(tag(`${km === 0 ? '0' : '−' + km} km`, new THREE.Vector3(BLOCK.xMin - 0.6, -km, Z), 'tick'));
}
humanLabels.add(tag('Olie- en gasbron', infra.anchors.well, 'human'));
humanLabels.add(tag('Kolenmijn', infra.anchors.mine, 'human'));
const plantTag = tag('Centrale: verbranding', infra.anchors.plant, 'human');
humanLabels.add(plantTag);
humanLabels.visible = false;
scene.add(natLabels, humanLabels);

// ---------- UI
const $ = (id) => document.getElementById(id);
const ui = {
  year: $('year'), ppm: $('ppm'), natVal: $('natVal'), humVal: $('humVal'),
  barNat: $('barNat'), barHum: $('barHum'), caption: $('caption'),
  btnNat: $('btnNat'), btnHuman: $('btnHuman'), btnFilm: $('btnFilm'), btnReset: $('btnReset'),
  speed: $('speed'), speedVal: $('speedVal'), chkLabels: $('chkLabels'), chkFossil: $('chkFossil'),
  scenario: $('scenario'),
};
const fmt = (v, d = 2) => v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });

function updateHUD() {
  const month = sim.seasonFade > 0.3 ? ` · ${MONTHS[Math.floor(sim.seasonPhase * 12)]}` : '';
  ui.year.textContent = (sim.mode === 'mens' ? `${Math.floor(sim.year)}` : 'natuurlijk evenwicht') + month;
  ui.ppm.textContent = `${Math.round(sim.ppm)} ppm`;
  ui.natVal.textContent = `${fmt(sim.naturalFlux)} GtC/jr`;
  ui.humVal.textContent = `${fmt(sim.humanFlux, 1)} GtC/jr`;
  ui.barNat.style.width = `${(100 * sim.naturalFlux) / MAX_FLUX}%`;
  ui.barHum.style.width = `${(100 * sim.humanFlux) / MAX_FLUX}%`;
  const t = Math.min(1, (sim.ppm - 280) / 320);
  atmosphere.material.color.setRGB(0.61 + 0.24 * t, 0.78 - 0.1 * t, 1.0 - 0.45 * t);
  atmosphere.material.opacity = 0.05 + 0.07 * t;
}

const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const TOUR_CAPTIONS = [
  [0, 'Elk jaar ademen de planten: in de zomer nemen ze CO₂ op, in de winter komt het weer vrij. Netto: nul.'],
  [6, 'Maar een heel klein deel wordt begraven. Miljoenen jaren lang vormen bossen, venen en algen zo koolstof in de bodem.'],
  [12, 'Een klein beetje komt terug via vulkanen: CO₂ uit magma en verhit kalksteen.'],
  [18, 'Kolen, olie en gas: geconcentreerde koolstof, kilometers diep opgeslagen.'],
  [25, 'Gebergtevorming tilt oude lagen omhoog. Erosie legt ze bloot en ze oxideren — heel langzaam.'],
];
function humanCaption(y) {
  if (sim.finished) return `${END_YEAR}: einde van dit scenario. Kies een ander scenario en klik op "Mens grijpt in".`;
  if (y > NOW_YEAR) {
    if (sim.scenario === 'doorgaan') return 'Als we zo doorgaan…';
    if (sim.scenario === 'afbouw' && y < 2050) return 'Afbouwen: de uitstoot daalt naar nul in 2050. Windmolens nemen het over.';
    if (y < NOW_YEAR + 40) return 'Uitstoot nul. Toch daalt de CO₂ maar langzaam: oceaan en land nemen het in decennia tot eeuwen op.';
    return 'Ongeveer een vijfde van de extra CO₂ blijft duizenden jaren in de lucht.';
  }
  if (y < 1900) return 'Vanaf 1850 halen mensen die koolstof gericht naar boven — en verbranden hem.';
  if (y < 1960) return `Elke stip ≈ ${UNIT * 1000} miljoen ton koolstof. Oranje = CO₂ uit fossiele brandstof.`;
  if (y < 2000) return 'Ongeveer de helft wordt opgenomen door oceaan en planten. De rest blijft in de lucht.';
  if (y <= NOW_YEAR) return 'Nu: ~10 miljard ton koolstof per jaar — 60–100× zoveel als vulkanen en verwering samen.';
  return 'Als we zo doorgaan…';
}
function updateCaption() {
  let text = '';
  if (sim.mode === 'mens') text = humanCaption(sim.year);
  else if (film.active) for (const [t, c] of TOUR_CAPTIONS) if (film.t >= t) text = c;
  if (ui.caption.textContent !== text) ui.caption.textContent = text;
  ui.caption.style.opacity = text ? 1 : 0;
}

function setMode(mode) {
  if (mode === 'mens') sim.startHuman(); else { sim.reset(); }
  infra.group.visible = mode === 'mens';
  humanLabels.visible = mode === 'mens' && ui.chkLabels.checked;
  ui.btnNat.classList.toggle('active', mode !== 'mens');
  ui.btnHuman.classList.toggle('active', mode === 'mens');
}

function resetWorld() {
  particles.reset();
  const nSeason = Math.round(SEASON_GTC / UNIT);
  particles.spawnBaseline(Math.round(590 / UNIT - nSeason / 2));
  particles.spawnSeasonal(nSeason);
  setMode('natuur');
  // warm up so the natural cycle is already flowing
  for (let i = 0; i < 90; i++) simulate(1 / 30);
}

// ---------- film
const film = { active: false, t: 0 };
const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3();
function startFilm() {
  resetWorld();
  setSpeed(0.5);
  film.active = true; film.t = 0;
  controls.enabled = false;
}
function stopFilm() {
  film.active = false;
  controls.target.copy(camTgt);
  controls.enabled = true;
  uniforms.uHighlight.value = ui.chkFossil.checked ? 1 : 0;
}
function updateFilm(dt) {
  film.t += dt;
  cameraAt(film.t, camPos, camTgt);
  camera.position.copy(camPos);
  camera.lookAt(camTgt);
  const hl = film.t > 18 && film.t < 25 ? 1 : 0;
  uniforms.uHighlight.value += (hl - uniforms.uHighlight.value) * Math.min(1, dt * 2);
  if (film.t >= TOUR_END && sim.mode !== 'mens') { setMode('mens'); setSpeed(4); }
  if (!RECORD && sim.mode === 'mens' && sim.year >= NOW_YEAR) stopFilm();
}

// ---------- simulation step
function updateRenewables(dt) {
  const after = sim.mode === 'mens' && sim.year > NOW_YEAR;
  const frac = after ? 1 - sim.humanFlux / MAX_FLUX : 0;
  const nOn = Math.round(frac * infra.turbines.length);
  infra.turbines.forEach((t, i) => {
    t.visible = i < nOn;
    if (t.visible) t.userData.rotor.rotation.z -= dt * 2.5;
  });
  const closed = after && sim.humanFlux < 0.01;
  const label = closed ? 'Centrale gesloten' : 'Centrale: verbranding';
  if (plantTag.element.textContent !== label) plantTag.element.textContent = label;
}

function simulate(dt) {
  uniforms.uTime.value += dt;
  const n = sim.step(dt);
  updateRenewables(dt);
  const fade = sim.seasonFade;
  particles.setPlantFraction(0.5 - 0.5 * seasonalAnomaly(sim.seasonPhase) * fade);
  uniforms.uGreen.value = 1 + (greenness(sim.seasonPhase) - 1) * fade;
  for (let k = 0; k < n.volc; k++) particles.spawnPath(volcPath, KIND.NATURAL);
  for (let k = 0; k < n.oxi && outcrops.length; k++) {
    const o = outcrops[Math.floor(rng() * outcrops.length)];
    particles.spawnRise(o[0], o[1] + 0.05, o[2], KIND.NATURAL, 0.35);
  }
  for (let k = 0; k < n.coal; k++) particles.spawnPath(coalPath, KIND.HUMAN);
  for (let k = 0; k < n.oil; k++) particles.spawnPath(oilPath, KIND.HUMAN);
  particles.update(dt, n.yrs);
}

function step(dt) {
  if (film.active) updateFilm(dt);
  simulate(dt);
  updateHUD();
  updateCaption();
}

function render() {
  if (!film.active) controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

function resize() {
  const w = RECORD ? Number(params.get('w')) || 1920 : innerWidth;
  const h = RECORD ? Number(params.get('h')) || 1080 : innerHeight;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  particles.setViewport(h * renderer.getPixelRatio(), camera.fov);
}
addEventListener('resize', resize);
resize();

// ---------- wiring
ui.btnNat.onclick = () => { if (film.active) stopFilm(); setMode('natuur'); };
ui.btnHuman.onclick = () => { if (film.active) stopFilm(); setMode('mens'); };
ui.btnFilm.onclick = () => startFilm();
ui.btnReset.onclick = () => { if (film.active) stopFilm(); resetWorld(); };
// log slider 0..100 -> 0.1..20 years per second
const sliderToSpeed = (v) => 0.1 * Math.pow(200, v / 100);
const speedToSlider = (sp) => (100 * Math.log(sp / 0.1)) / Math.log(200);
function setSpeed(sp) {
  sim.speed = sp;
  ui.speed.value = speedToSlider(sp);
  ui.speedVal.textContent = fmt(sp, sp < 1 ? 2 : sp < 10 ? 1 : 0);
}
ui.speed.oninput = () => setSpeed(sliderToSpeed(Number(ui.speed.value)));
ui.chkLabels.onchange = () => {
  natLabels.visible = ui.chkLabels.checked;
  humanLabels.visible = ui.chkLabels.checked && sim.mode === 'mens';
};
for (const [k, v] of Object.entries(SCENARIOS)) ui.scenario.add(new Option(v, k));
ui.scenario.onchange = () => { sim.scenario = ui.scenario.value; };
ui.chkFossil.onchange = () => { uniforms.uHighlight.value = ui.chkFossil.checked ? 1 : 0; };
renderer.domElement.addEventListener('pointerdown', () => { if (film.active) stopFilm(); });

setSpeed(4);
resetWorld();

if (RECORD) {
  startFilm();
  window.__frame = () => { step(1 / FPS); render(); return true; };
  window.__skip = (n) => { for (let i = 0; i < n; i++) step(1 / FPS); return true; };
  render();
  window.__ready = true;
} else {
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    step(Math.min(clock.getDelta(), 1 / 20));
    render();
  });
}

