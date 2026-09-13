import type {V} from './vector';

/**
 * Mars body-fixed geography shared by physics and rendering, so what you see is what you hit.
 *
 * Convention (matches three.js SphereGeometry UVs and equirectangular maps with 0°E at the centre):
 *   +Y = north pole, east longitude = atan2(-z, x), texture u = 0.5 + lon/360, v = 0.5 + lat/180.
 * Using atan2(z, x) instead would mirror MOLA elevations against the colour map.
 */
export const MARS_RADIUS_M = 3389500;
export const MOLA_OFFSET_M = 3396000;
const DEG = Math.PI / 180;

export function latLonToDir(lat: number, lon: number): V {
  const a = lat * DEG, b = lon * DEG;
  return [Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b)];
}
export function dirToLatLon(d: V) {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return {lat: Math.asin(Math.max(-1, Math.min(1, d[1] / l))) / DEG, lon: Math.atan2(-d[2], d[0]) / DEG};
}
/** Rotate an inertial vector into the body-fixed frame at simulation time t. */
export function inertialToBody(p: V, t: number, rotationPeriod: number): V {
  const a = -t / rotationPeriod * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
  return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
}
export function bodyToInertial(p: V, t: number, rotationPeriod: number): V {
  return inertialToBody(p, -t, rotationPeriod);
}

// ---------------------------------------------------------------- MOLA elevation

export class MolaHeights {
  private global: Int16Array;
  private canyon: Int16Array | null = null;
  constructor(buffer: ArrayBuffer) {
    if (buffer.byteLength !== 1440 * 720 * 2) throw Error('Invalid MOLA radius dataset');
    this.global = bigEndian16(buffer);
  }
  setCanyon(buffer: ArrayBuffer) {
    if (buffer.byteLength !== 2560 * 2048 * 2) throw Error('Invalid canyon radius dataset');
    this.canyon = bigEndian16(buffer);
  }
  /** Radius in metres. Catmull-Rom bicubic so 15 km MOLA cells do not read as flat facets. */
  radius(lat: number, lon: number) {
    const east = ((lon % 360) + 360) % 360;
    const coarse = MOLA_OFFSET_M + bicubic(this.global, 1440, 720, east * 4 - .5, (90 - lat) * 4 - .5, true);
    if (!this.canyon || east <= 280 || east >= 300 || lat >= 0 || lat <= -16) return coarse;
    const fine = MOLA_OFFSET_M + bicubic(this.canyon, 2560, 2048, (east - 280) * 128 - .5, -lat * 128 - .5, false);
    const edge = Math.min(east - 280, 300 - east, -lat, lat + 16);
    const w = Math.min(1, edge / .5);
    return coarse + (fine - coarse) * w * w * (3 - 2 * w);
  }
}
function bigEndian16(buffer: ArrayBuffer) {
  const view = new DataView(buffer), out = new Int16Array(buffer.byteLength / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, false);
  return out;
}
function bicubic(data: Int16Array, w: number, h: number, x: number, y: number, wrap: boolean) {
  const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
  const at = (i: number, j: number) => {
    j = j < 0 ? 0 : j >= h ? h - 1 : j;
    i = wrap ? ((i % w) + w) % w : i < 0 ? 0 : i >= w ? w - 1 : i;
    return data[j * w + i];
  };
  const row = (j: number) => cubic(at(ix - 1, j), at(ix, j), at(ix + 1, j), at(ix + 2, j), tx);
  return cubic(row(iy - 1), row(iy), row(iy + 1), row(iy + 2), ty);
}
function cubic(a: number, b: number, c: number, d: number, t: number) {
  return b + .5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
}

// ---------------------------------------------------------------- procedural detail

function hash2(x: number, y: number, seed: number) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** 2D gradient noise in [-1, 1], unbounded domain (no 256-cell period). */
function noise2(x: number, y: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const g = (i: number, j: number, dx: number, dy: number) => {
    const a = hash2(ix + i, iy + j, seed) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = g(0, 0, fx, fy), b = g(1, 0, fx - 1, fy), c = g(0, 1, fx, fy - 1), d = g(1, 1, fx - 1, fy - 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.41;
}

const CRATER_SCALES = [3200, 900, 260, 70, 18];
/** Detail height (metres) in one planar projection. Octaves below minWavelength are skipped (band-limited LOD). */
function planarDetail(x: number, y: number, minWavelength: number) {
  let h = 0;
  // Regional roughness mask: some plains are smooth, some regions broken and hilly.
  const mask = .45 + .55 * (noise2(x / 60000, y / 60000, 7) * .5 + .5) + .4 * Math.max(0, noise2(x / 23000, y / 23000, 8));
  for (let wl = 12000, o = 0; wl >= minWavelength && o < 14; wl /= 2, o++) {
    let n = noise2(x / wl, y / wl, 11 + o);
    if (wl <= 3000 && wl >= 400) n = (.5 - Math.abs(n)) * 1.6; // ridged mid band: mesas, ridges, buttes
    h += n * wl * .011 * mask;
  }
  // Dune fields: long transverse ridges where a regional mask allows, crests steeper downwind.
  if (minWavelength < 400) {
    const field = noise2(x / 38000, y / 38000, 91);
    if (field > .28) {
      const k = Math.min(1, (field - .28) / .2), phase = (x * .83 + y * .55) / 210 + noise2(x / 1600, y / 1600, 92) * 2.2;
      const crest = Math.pow(Math.max(0, Math.sin(phase * Math.PI * 2)), 3) * .8 + Math.pow(Math.max(0, Math.sin(phase * Math.PI * 2 + .7)), 8) * .4;
      h += k * crest * 14;
    }
  }
  for (let s = 0; s < CRATER_SCALES.length; s++) {
    const cell = CRATER_SCALES[s];
    if (cell * .4 < minWavelength) break;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const k = hash2(cx + i, cy + j, 101 + s);
      if (k > .32) continue;
      const r = cell * (.12 + .28 * hash2(cx + i, cy + j, 202 + s));
      const px = (cx + i + .2 + .6 * hash2(cx + i, cy + j, 303 + s)) * cell;
      const py = (cy + j + .2 + .6 * hash2(cx + i, cy + j, 404 + s)) * cell;
      const t = Math.hypot(x - px, y - py) / r;
      if (t > 1.8) continue;
      const fresh = .35 + .65 * hash2(cx + i, cy + j, 505 + s), depth = r * .18 * fresh;
      const bowl = t < 1 ? depth * (t * t - 1) : 0;
      const rim = depth * .32 * Math.exp(-(((t - 1) / .28) ** 2));
      h += bowl + rim;
    }
  }
  return h;
}

/** Triplanar blend of planar detail on the body-fixed point (metres); continuous across the whole sphere. */
export function detailHeight(p: V, minWavelength: number) {
  const l = Math.hypot(p[0], p[1], p[2]);
  let wx = Math.abs(p[0] / l) ** 8, wy = Math.abs(p[1] / l) ** 8, wz = Math.abs(p[2] / l) ** 8;
  const sum = wx + wy + wz; wx /= sum; wy /= sum; wz /= sum;
  let h = 0;
  if (wx > .01) h += wx * planarDetail(p[1], p[2], minWavelength);
  if (wy > .01) h += wy * planarDetail(p[0] + 1.7e6, p[2], minWavelength);
  if (wz > .01) h += wz * planarDetail(p[0] - 2.3e6, p[1], minWavelength);
  return h;
}

export class MarsSurface {
  private pads: {dir: V; base: number; detail: number; inner: number; outer: number; cos: number}[] = [];
  constructor(public mola: MolaHeights) {}
  /** Landing sites were chosen for being flat: smooth procedural detail inside ~120 m of each. */
  flatten(sites: {dir: V; inner?: number; outer?: number}[]) {
    this.pads = sites.map(({dir, inner = 50, outer = 140}) => {
      const {lat, lon} = dirToLatLon(dir), base = this.mola.radius(lat, lon);
      return {dir, base, detail: detailHeight([dir[0] * base, dir[1] * base, dir[2] * base], 2), inner, outer, cos: Math.cos((outer + 20) / MARS_RADIUS_M)};
    });
  }
  /** 0 inside a levelled site, 1 outside its falloff. */
  flatWeight(dir: V) {
    const l = Math.hypot(dir[0], dir[1], dir[2]);
    let w = 1;
    for (const pad of this.pads) {
      const c = (dir[0] * pad.dir[0] + dir[1] * pad.dir[1] + dir[2] * pad.dir[2]) / l;
      if (c < pad.cos) continue;
      const metres = Math.acos(Math.min(1, c)) * pad.base, k = Math.min(1, Math.max(0, (metres - pad.inner) / (pad.outer - pad.inner)));
      w = Math.min(w, k * k * (3 - 2 * k));
    }
    return w;
  }
  /** Surface radius in metres along a body-fixed direction, at the given detail limit. */
  radiusM(dir: V, minWavelength = 3) {
    const l = Math.hypot(dir[0], dir[1], dir[2]), d: V = [dir[0] / l, dir[1] / l, dir[2] / l];
    const {lat, lon} = dirToLatLon(d);
    const base = this.mola.radius(lat, lon);
    let radius = base + detailHeight([d[0] * base, d[1] * base, d[2] * base], minWavelength);
    for (const pad of this.pads) {
      const c = d[0] * pad.dir[0] + d[1] * pad.dir[1] + d[2] * pad.dir[2];
      if (c < pad.cos) continue;
      // Levelled like real site preparation: blend the whole radius, not just the detail, to the site height.
      const metres = Math.acos(Math.min(1, c)) * base, k = Math.min(1, Math.max(0, (metres - pad.inner) / (pad.outer - pad.inner)));
      const target = pad.base + pad.detail, w = k * k * (3 - 2 * k);
      radius = target + (radius - target) * w;
    }
    return radius;
  }
}
