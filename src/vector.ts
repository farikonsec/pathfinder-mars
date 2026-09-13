// Kilometres, seconds. Plain 3-vectors in double precision; render scale never enters physics.
export type V = [number, number, number];
export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: V) => Math.hypot(...a);
export const unit = (a: V): V => mul(a, 1 / (len(a) || 1));
export const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Does the segment start→end pass within `radius` of the origin? Catches fast bodies between integration steps. */
export function segmentHitsSphere(start: V, end: V, radius: number) {
  const delta = add(end, mul(start, -1)), t = Math.max(0, Math.min(1, -dot(start, delta) / (dot(delta, delta) || 1)));
  return len(add(start, mul(delta, t))) <= radius;
}

/** Soft occlusion of the Sun (finite angular radius) by a sphere; 1 = fully lit. Positions in km. */
export function sunlightVisibility(point: V, sun: V, occluder: V, radius: number, sunRadius = 695700) {
  const toSun = add(sun, mul(point, -1)), distance = len(toSun), axis = mul(toSun, 1 / distance);
  const delta = add(occluder, mul(point, -1)), along = dot(delta, axis);
  if (along <= 0 || along >= distance) return 1;
  const off = len(add(delta, mul(axis, -along))), penumbra = along * sunRadius / distance;
  const x = Math.max(0, Math.min(1, (off - radius + penumbra) / (2 * penumbra || 1e-9)));
  return x * x * (3 - 2 * x);
}
