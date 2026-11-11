import { UNIT } from './particles.js';

// Fossil CO2 emissions, GtC/yr (approx., see docs/wetenschap-koolstofkringloop.md).
const FOSSIL = [
  [1850, 0.05], [1900, 0.5], [1950, 1.6], [1970, 4.0], [1990, 6.1],
  [2000, 6.8], [2010, 9.0], [2020, 9.5], [2025, 10.2],
];
// Land-use change (deforestation), GtC/yr. Counts toward ppm but has no
// underground source in the block, so it spawns no particles.
const LAND = [[1850, 0.5], [1950, 1.3], [2000, 1.4], [2025, 1.1]];

export const NOW_YEAR = 2025;
export const END_YEAR = 2150;
export const NATURAL = { volcanic: 0.09, oxidation: 0.07 }; // GtC/yr
export const MAX_FLUX = 10.2;
const GTC_PER_PPM = 2.12;
const COAL_SHARE = 0.42;

// Bern carbon-cycle impulse response (Joos et al. 2013, IPCC AR5):
// fraction a of an emitted pulse decays with time constant tau (years).
// Time constants scaled by 0.35 so the historical run matches observed ppm
// (1960: 321 vs 317, 2000: 375 vs 369, 2025: 425 vs ~425). The unscaled
// pulse response underestimates historical uptake (2025 -> 461 ppm).
const TAU_SCALE = 0.35;
export const BERN = [
  { a: 0.2173, tau: Infinity },
  { a: 0.224, tau: 394.4 * TAU_SCALE },
  { a: 0.2824, tau: 36.54 * TAU_SCALE },
  { a: 0.2763, tau: 4.304 * TAU_SCALE },
];

// Seasonal "breathing" of the (mostly northern-hemisphere) biosphere.
// Mauna Loa: ~6.5 ppm peak-to-peak, maximum mid-May, minimum end of September.
export const SEASON_PPM = 3.2;      // amplitude, ppm
export const SEASON_GTC = 2 * SEASON_PPM * 2.12; // net carbon swing in/out of plants, GtC
const PEAK = 0.37, TROUGH = 0.74;   // fraction of year

// Seasonal CO2 anomaly in [-1, 1]: falls quickly May→Sep (growth), rises slowly Oct→May.
export function seasonalAnomaly(phase) {
  const u = (((phase - PEAK) % 1) + 1) % 1;
  const fall = TROUGH - PEAK;
  return u < fall ? Math.cos((Math.PI * u) / fall) : -Math.cos((Math.PI * (u - fall)) / (1 - fall));
}

// Leaf greenness in [0, 1], peaks mid-July.
export function greenness(phase) {
  return 0.5 + 0.5 * Math.cos(2 * Math.PI * (phase - 0.54));
}

// Seasons are only visible at slow time-lapse; above ~1.5 yr/s they average out.
export function seasonVisibility(speed) {
  return Math.min(1, Math.max(0, (1.5 - speed) / 1.1));
}

export const SCENARIOS = {
  doorgaan: 'Zoals nu doorgaan',
  afbouw: 'Afbouwen naar nul in 2050',
  stop: 'Direct stoppen in 2025',
};

function interp(table, year) {
  if (year <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [y1, e1] = table[i];
    if (year <= y1) {
      const [y0, e0] = table[i - 1];
      return e0 + ((e1 - e0) * (year - y0)) / (y1 - y0);
    }
  }
  return table[table.length - 1][1];
}

// Multiplier on 2025 emissions after NOW_YEAR.
function scenarioFactor(scenario, year) {
  if (year <= NOW_YEAR) return 1;
  if (scenario === 'stop') return 0;
  if (scenario === 'afbouw') return Math.max(0, 1 - (year - NOW_YEAR) / 25);
  return 1;
}

export function fossilEmission(year, scenario = 'doorgaan') {
  return interp(FOSSIL, year) * scenarioFactor(scenario, year);
}
export function landUseEmission(year, scenario = 'doorgaan') {
  return interp(LAND, year) * scenarioFactor(scenario, year);
}

export class Sim {
  constructor() {
    this.speed = 4; // years per second
    this.scenario = 'doorgaan';
    this.reset();
  }

  reset() {
    this.mode = 'natuur';
    this.year = 1850;
    this.boxes = BERN.map(() => 0); // excess atmospheric carbon per Bern pool, GtC
    this.clock = 0.3; // years elapsed (drives the seasons); start in spring
    this.acc = { volc: 0, oxi: 0, coal: 0, oil: 0 };
  }

  startHuman() {
    this.reset();
    this.mode = 'mens';
  }

  get finished() {
    return this.mode === 'mens' && this.year >= END_YEAR;
  }

  get humanFlux() {
    return this.mode === 'mens' ? fossilEmission(this.year, this.scenario) : 0;
  }

  get naturalFlux() {
    return NATURAL.volcanic + NATURAL.oxidation;
  }

  get excessGtC() {
    return this.boxes.reduce((s, b) => s + b, 0);
  }

  get trendPpm() {
    return 280 + this.excessGtC / GTC_PER_PPM;
  }

  get seasonPhase() {
    return this.clock % 1;
  }

  get seasonFade() {
    return seasonVisibility(this.speed);
  }

  // Trend plus the visible part of the seasonal cycle.
  get ppm() {
    return this.trendPpm + SEASON_PPM * seasonalAnomaly(this.seasonPhase) * this.seasonFade;
  }

  // Advance dt seconds. Returns years elapsed and whole particles to spawn per source.
  step(dt) {
    let yrs = this.finished ? 0 : dt * this.speed;
    if (this.mode === 'mens' && yrs > 0) {
      const y2 = Math.min(END_YEAR, this.year + yrs);
      yrs = y2 - this.year;
      const mid = (this.year + y2) / 2;
      const ef = fossilEmission(mid, this.scenario);
      const e = ef + landUseEmission(mid, this.scenario);
      BERN.forEach(({ a, tau }, i) => {
        if (tau === Infinity) this.boxes[i] += a * e * yrs;
        else {
          const k = Math.exp(-yrs / tau);
          this.boxes[i] = this.boxes[i] * k + a * e * tau * (1 - k);
        }
      });
      this.acc.coal += (COAL_SHARE * ef * yrs) / UNIT;
      this.acc.oil += ((1 - COAL_SHARE) * ef * yrs) / UNIT;
      this.year = y2;
    }
    this.clock += yrs;
    this.acc.volc += (NATURAL.volcanic * yrs) / UNIT;
    this.acc.oxi += (NATURAL.oxidation * yrs) / UNIT;
    const out = { yrs };
    for (const k in this.acc) {
      out[k] = Math.floor(this.acc[k]);
      this.acc[k] -= out[k];
    }
    return out;
  }
}
