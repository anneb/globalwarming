// GLSL injected into MeshStandardMaterial. Colors every point of the block
// from its world position, so every cut face shows consistent 3D strata.
// Must mirror uplift/fold/depth in geology.js.

import { POCKETS } from './geology.js';

const f = (v) => v.toFixed(3);
// Unrolled per-pocket GLSL (pocket list is static).
const DOME_GLSL = POCKETS.map((p) => `
  { vec2 q = p.xz - vec2(${f(p.x)}, ${f(p.z)}); domeS += 0.35 * exp(-dot(q, q) / ${f(p.r * p.r * 1.8)}); }`).join('');
const TRAP_GLSL = POCKETS.map((p) => `
  { float rr = length(p.xz - vec2(${f(p.x)}, ${f(p.z)})) / ${f(p.r)};
    trap = max(trap, 1.0 - rr * rr); }`).join('');

export const STRATA_VERT_PARS = /* glsl */ `
attribute float top;
varying vec3 vWPos;
varying float vTop;
varying vec3 vWNormal;
`;

export const STRATA_VERT = /* glsl */ `
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTop = top;
vWNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

export const STRATA_FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform float uHighlight;
uniform float uGreen;
varying vec3 vWPos;
varying float vTop;
varying vec3 vWNormal;

float gHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float gNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(gHash(i + vec3(0,0,0)), gHash(i + vec3(1,0,0)), f.x),
        mix(gHash(i + vec3(0,1,0)), gHash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(gHash(i + vec3(0,0,1)), gHash(i + vec3(1,0,1)), f.x),
        mix(gHash(i + vec3(0,1,1)), gHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float gFbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * gNoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
`;

export const STRATA_FRAG = /* glsl */ `
vec3 p = vWPos;
float gRough = 0.9;
vec3 gEmis = vec3(0.0);
float fossil = 0.0;

float up = 5.5 * smoothstep(2.0, 13.0, p.x);
float fld = 0.35 * sin(p.x * 0.45 + p.z * 0.25) + 0.2 * sin(p.z * 0.8 - p.x * 0.2);
float n = gFbm(p * vec3(1.5, 6.0, 1.5));
float grain = gFbm(p * vec3(9.0, 40.0, 9.0));
float d0 = 0.3 - p.y + up;
float domeS = 0.0;${DOME_GLSL}
float d = d0 + fld * smoothstep(0.0, 1.5, d0) + domeS * smoothstep(0.6, 1.8, d0) + (n - 0.5) * 0.06;
float basin = smoothstep(-5.0, -2.0, p.x) * (1.0 - smoothstep(10.0, 13.0, p.x));
float ct = 0.14 * basin * (0.75 + 0.25 * sin(p.z * 0.45 + p.x * 0.25));
float rV = length(p.xz - vec2(-7.0, 8.0));
bool volcanic = d0 < -0.05 && rV < 4.6;
if (!volcanic) d = max(d, 0.001);

vec3 c;
if (volcanic) {
  float band = gFbm(vec3(p.x * 0.8, p.y * 6.0, p.z * 0.8));
  c = mix(vec3(0.17, 0.15, 0.14), vec3(0.36, 0.22, 0.16), smoothstep(0.45, 0.7, band));
  gRough = 0.95;
} else if (d < 0.12) {            // veen
  c = vec3(0.24, 0.17, 0.10) * (0.85 + 0.3 * grain); fossil = 0.35;
} else if (d < 0.9) {             // zand & klei, bruinkoollaag
  c = mix(vec3(0.74, 0.62, 0.44), vec3(0.6, 0.49, 0.34), grain);
  if (d > 0.52 && d < 0.6) { c = vec3(0.28, 0.2, 0.13); fossil = 0.6; }
} else if ((d < 0.9 + ct) || (d > 1.3 && d < 1.3 + 0.5 * ct)) {  // steenkoollagen (bekken)
  c = vec3(0.06, 0.055, 0.05) + grain * 0.06; gRough = 0.4; fossil = 1.0;
} else if (d < 1.9) {             // zandsteen / schalie wisselend; schalie 1.75-1.9 = afsluitende laag
  float alt = step(0.5, fract(d * 6.0 + n * 0.4));
  c = mix(vec3(0.62, 0.52, 0.4), vec3(0.43, 0.4, 0.36), alt) * (0.85 + 0.3 * grain);
  if (d > 1.75) c = vec3(0.36, 0.35, 0.33) * (0.85 + 0.3 * grain);
} else if (d < 2.3) {             // poreuze zandsteen: water, olie/gas alleen in vallen
  c = mix(vec3(0.66, 0.61, 0.52), vec3(0.56, 0.53, 0.47), grain);
  float trap = 0.0;${TRAP_GLSL}
  float resH = d - 1.9;
  if (resH < 0.4 * trap) { c = vec3(0.34, 0.19, 0.05) * (0.8 + 0.4 * grain); gRough = 0.2; fossil = 1.0; }  // olie
  if (resH < 0.13 * trap) { c = vec3(0.9, 0.62, 0.58) * (0.9 + 0.2 * grain); gRough = 0.6; fossil = 1.0; } // gas
} else if (d < 3.1) {             // zwarte schalie: verspreid kerogeen, grotendeels niet winbaar
  c = vec3(0.18, 0.17, 0.165) * (0.8 + 0.4 * grain); fossil = 0.25;
} else if (d < 4.6) {             // kalksteen
  c = mix(vec3(0.85, 0.82, 0.73), vec3(0.72, 0.69, 0.6), grain);
} else {                          // graniet
  float sp = gFbm(p * 7.0);
  c = mix(vec3(0.5, 0.44, 0.42), vec3(0.7, 0.57, 0.52), smoothstep(0.45, 0.6, sp));
  c = mix(c, vec3(0.22, 0.2, 0.2), 0.6 * smoothstep(0.62, 0.72, sp));
}

// magma chamber + conduit
vec3 mq = (p - vec3(-7.0, -6.5, 8.0)) / vec3(3.0, 1.4, 2.4);
float md = length(mq);
float conduit = length(p.xz - vec2(-7.0, 8.0)) - (0.2 + 0.05 * sin(p.y * 3.0 + uTime));
bool inMagma = md < 1.0 || (conduit < 0.0 && p.y > -6.0 && p.y < 2.6);
if (inMagma) {
  float f = gFbm(p * 1.8 + vec3(0.0, uTime * 0.25, 0.0));
  vec3 hot = mix(vec3(0.9, 0.12, 0.01), vec3(1.0, 0.5, 0.08), f);
  c = hot * 0.2;
  gEmis = hot * (0.55 + 0.5 * f);
  gRough = 0.6;
  fossil = 0.0;
} else {
  float halo = 1.0 - smoothstep(1.0, 1.7, md);
  c = mix(c, vec3(0.42, 0.16, 0.08), halo * 0.55);
  gEmis += vec3(0.7, 0.14, 0.02) * halo * halo * 0.3;
  float ch = (1.0 - smoothstep(0.0, 0.4, conduit)) * step(-6.0, p.y) * (1.0 - step(2.6, p.y));
  gEmis += vec3(0.9, 0.2, 0.03) * ch * 0.2;
}

// top surface: vegetation, beach, snow; bare rock on steep slopes
if (vTop > 0.5) {
  float slope = 1.0 - clamp(vWNormal.y, 0.0, 1.0);
  float veg = (1.0 - smoothstep(0.1, 0.28, slope)) * (1.0 - smoothstep(1.6, 2.4, p.y)) * smoothstep(1.4, 3.2, rV);
  float vn = gFbm(p * 3.0);
  vec3 g = mix(vec3(0.16, 0.26, 0.09), vec3(0.32, 0.37, 0.15), vn);
  vec3 winter = mix(vec3(0.36, 0.29, 0.17), vec3(0.45, 0.38, 0.24), vn);   // bare deciduous / dry grass
  g = mix(winter, g, uGreen);
  vec3 conifer = mix(vec3(0.06, 0.12, 0.06), vec3(0.07, 0.15, 0.06), uGreen);
  g = mix(g, conifer, smoothstep(0.5, 0.62, gFbm(p * 0.9 + 3.0)));
  c = mix(c, g, veg);
  gRough = mix(gRough, 0.95, veg);
  fossil *= (1.0 - veg);
  c = mix(c, vec3(0.76, 0.7, 0.52), (1.0 - smoothstep(0.02, 0.14, p.y)) * step(p.x, -7.5));
  c = mix(c, vec3(0.95), smoothstep(2.7, 3.0, p.y + 0.3 * vn) * step(4.0, p.x));
}

gEmis += vec3(1.0, 0.55, 0.12) * fossil * uHighlight * (0.16 + 0.1 * sin(uTime * 3.0));
diffuseColor.rgb = pow(c, vec3(2.2));
totalEmissiveRadiance += gEmis;
`;
