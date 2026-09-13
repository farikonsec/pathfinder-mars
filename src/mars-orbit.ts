import {add,mul,len,dot,type V} from './vector';
import {MARS} from './mars';

const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Mars sphere of influence against the Sun, km. */
export const MARS_SOI = 577000;
export const ENTRY_INTERFACE = 120; // km above mean radius

export type OrbitStatus = 'impact' | 'entry' | 'orbit' | 'escape';
export interface Orbit {
  e: number; a: number; periapsis: number; apoapsis: number; energy: number;
  timeToPeriapsis: number; approaching: boolean; period: number; status: OrbitStatus;
  vPeriapsis: number; captureDeltaV: number; circulariseDeltaV: number;
}

/** Two-body conic about Mars (km, km/s). Altitudes are above the mean radius. */
export function orbitOf(p: V, v: V, mu = MARS.mu): Orbit {
  const r = len(p), speed2 = dot(v, v), h = cross(p, v);
  const eVec = add(mul(cross(v, h), 1 / mu), mul(p, -1 / r)), e = len(eVec);
  const energy = speed2 / 2 - mu / r, a = -mu / (2 * energy);
  const rp = len(h) ** 2 / mu / (1 + e);
  const ra = e < 1 ? a * (1 + e) : Infinity;
  const radial = dot(p, v), approaching = radial < 0;
  let timeToPeriapsis = Infinity, period = Infinity;
  if (e < 1) {
    const n = Math.sqrt(mu / a ** 3); period = 2 * Math.PI / n;
    const E = Math.acos(Math.max(-1, Math.min(1, (1 - r / a) / e))), M = E - e * Math.sin(E);
    timeToPeriapsis = (approaching ? M : 2 * Math.PI - M) / n;
  } else if (approaching) {
    const n = Math.sqrt(mu / (-a) ** 3), F = Math.acosh(Math.max(1, (1 - r / a) / e));
    timeToPeriapsis = (e * Math.sinh(F) - F) / n;
  }
  const vp = Math.sqrt(mu * (2 / rp - 1 / a));
  const targetApo = MARS.radius + 20000, aCapture = (rp + targetApo) / 2;
  const captureDeltaV = Math.max(0, vp - Math.sqrt(mu * (2 / rp - 1 / aCapture)));
  const circulariseDeltaV = Math.max(0, vp - Math.sqrt(mu / rp));
  const periapsis = rp - MARS.radius, apoapsis = ra - MARS.radius;
  const status: OrbitStatus = periapsis < 0 ? 'impact' : periapsis < ENTRY_INTERFACE ? 'entry' : e < 1 && ra < MARS_SOI ? 'orbit' : 'escape';
  return {e, a, periapsis, apoapsis, energy, timeToPeriapsis, approaching, period, status, vPeriapsis: vp, captureDeltaV, circulariseDeltaV};
}

/** Two-body path samples (km) for the trajectory line. Stops at the surface or far beyond Mars. */
export function predictPath(p: V, v: V, points = 360, mu = MARS.mu) {
  const o = orbitOf(p, v, mu), out: V[] = [p];
  const horizon = o.e < 1 ? o.period * 1.02 : Math.max(3600, (o.approaching ? o.timeToPeriapsis : 0) * 2.2 + 3600);
  let x = p, u = v, t = 0;
  const step = horizon / points;
  while (t < horizon && out.length < points * 4) {
    const r = len(x), dt = Math.min(step, .02 * r / Math.max(len(u), 1e-6)) , sub = Math.max(1, Math.ceil(dt / 60));
    for (let i = 0; i < sub; i++) {
      const h = dt / sub, a0 = mul(x, -mu / len(x) ** 3);
      u = add(u, mul(a0, h / 2)); x = add(x, mul(u, h)); u = add(u, mul(x, -mu / len(x) ** 3 * h / 2));
    }
    t += dt;
    if (out.length === 1 || len(add(x, mul(out[out.length - 1], -1))) > r * .01 || t >= horizon) out.push(x);
    if (len(x) < MARS.radius || len(x) > MARS_SOI) {out.push(x); break;}
  }
  return {path: out, orbit: o};
}

/**
 * A hyperbolic arrival that reaches the requested periapsis. Built by starting at periapsis and
 * integrating two-body motion backwards until the ship is `distance` km out, so the aim is exact.
 */
export function arrivalState(periapsisAltitude: number, vInfinity: number, distance: number, inclination = .35, mu = MARS.mu) {
  const rp = MARS.radius + periapsisAltitude, vp = Math.sqrt(vInfinity ** 2 + 2 * mu / rp);
  // Periapsis on the sunward side so the approach looks at a lit crescent growing into a full disc.
  const c = Math.cos(inclination), s = Math.sin(inclination);
  let x: V = [rp * .8, rp * .1, -rp * .6];
  const xl = len(x); x = mul(x, rp / xl);
  const north: V = [0, 1, 0], tangent0 = cross(north, x), t0 = mul(tangent0, 1 / len(tangent0));
  const inPlaneUp = cross(mul(x, 1 / rp), t0);
  let u: V = mul(add(mul(t0, c), mul(inPlaneUp, s)), vp);
  let t = 0;
  while (len(x) < distance && t < 3e7) {
    const dt = -Math.min(600, .01 * len(x) / len(u));
    u = add(u, mul(x, -mu / len(x) ** 3 * dt / 2)); x = add(x, mul(u, dt)); u = add(u, mul(x, -mu / len(x) ** 3 * dt / 2));
    t += dt;
  }
  return {p: x, v: u, secondsToPeriapsis: -t};
}
