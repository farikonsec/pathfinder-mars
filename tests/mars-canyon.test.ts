import {test,expect} from 'bun:test';
import * as T from 'three';
import {MARS,marsInitial,type MarsState} from '../src/mars';
import {MolaHeights,MarsSurface,latLonToDir,bodyToInertial} from '../src/mars-geo';
import {FlightControl,advanceFlight,atmosphereVelocity,type FlightTelemetry} from '../src/mars-flight';
import {CANYON_START,CANYON_GATES} from '../src/mars-missions';
import {add,type V} from '../src/vector';

const mola = new MolaHeights(await Bun.file(new URL('../public/textures/mars-radius.img', import.meta.url)).arrayBuffer());
mola.setCanyon(await Bun.file(new URL('../public/textures/mars-canyon-radius.img', import.meta.url)).arrayBuffer());
const surface = new MarsSurface(mola);

function start() {
  const s: MarsState & {tele?: FlightTelemetry} = marsInitial(); s.heat = 0;
  const {lat, lon, agl, heading} = CANYON_START, dir = new T.Vector3(...latLonToDir(lat, lon));
  s.p = dir.clone().multiplyScalar((surface.radiusM(dir.toArray() as V, 3) + agl) / 1000).toArray() as V;
  const north = new T.Vector3(0, 1, 0).addScaledVector(dir, -dir.y).normalize(), east = new T.Vector3().crossVectors(north, dir).normalize();
  const h = heading * Math.PI / 180, flat = north.multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
  s.v = add(flat.clone().multiplyScalar(.26).toArray() as V, atmosphereVelocity(s.p));
  const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(flat.clone().cross(dir).normalize(), dir, flat.clone().negate()));
  return {s, q};
}
const gateKm = (i: number, t: number) => {
  const g = CANYON_GATES[i], dir = latLonToDir(g.lat, g.lon), r = (surface.radiusM(dir, 200) + g.agl) / 1000;
  return new T.Vector3(...bodyToInertial(dir.map(x => x * r) as V, t, MARS.rotation));
};

test('every canyon gate sits inside Coprates Chasma, well below the rims', () => {
  for (const g of CANYON_GATES) {
    const ground = surface.radiusM(latLonToDir(g.lat, g.lon), 3) - 3396000, alt = ground + g.agl;
    let rim = -Infinity;
    for (let d = .3; d <= 1.2; d += .05) rim = Math.max(rim, Math.min(...[g.lat + d, g.lat - d].map(la => surface.radiusM(latLonToDir(la, g.lon), 400) - 3396000)));
    expect(g.agl).toBeGreaterThan(700);
    expect(rim - alt).toBeGreaterThan(3000); // the lower rim; the higher one is 7–8 km up
  }
});

test('a simple autopilot flies all five canyon gates without touching the walls', () => {
  const {s, q} = start(), control = new FlightControl();
  let gate = 0, t = 0, minAgl = Infinity;
  const dt = 1 / 30;
  while (gate < CANYON_GATES.length && t < 900 && s.status === 'flying') {
    advanceFlight(s, 0, q, {throttle: 0, hover: 0, lateral: 0, surge: 0}, {surface, gear: false});
    const tele = s.tele!, here = new T.Vector3(...s.p), target = gateKm(gate, s.t);
    const up = new T.Vector3(...tele.up), to = target.clone().sub(here);
    if (to.length() * 1000 < 350) {gate++; continue;}
    // Aim at the gate, nose a little high to carry the ship's weight, wings level.
    const aim = to.normalize().addScaledVector(up, .12).normalize();
    const right = aim.clone().cross(up).normalize(), noseUp = right.clone().cross(aim).normalize();
    control.pointTo(new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(right, noseUp, aim.clone().negate())));
    control.update(q, new T.Vector3(), dt, {alpha: tele.alpha, beta: tele.beta, qbar: tele.dynamicPressure});
    const throttle = Math.max(0, Math.min(1, (320 - tele.airspeed) / 80 + .35));
    advanceFlight(s, dt, q, {throttle, hover: 0, lateral: 0, surge: 0}, {surface, gear: false});
    minAgl = Math.min(minAgl, s.tele!.agl); t += dt;
  }
  expect(s.status).toBe('flying');
  expect(gate).toBe(CANYON_GATES.length);
  expect(minAgl).toBeGreaterThan(300);
  expect(t).toBeLessThan(600);
});
