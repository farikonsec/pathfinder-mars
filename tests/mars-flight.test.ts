import {test,expect} from 'bun:test';
import * as T from 'three';
import {MARS,marsInitial,type MarsState} from '../src/mars';
import {MolaHeights,MarsSurface,latLonToDir,inertialToBody} from '../src/mars-geo';
import {FlightControl,advanceFlight,descentAssist,entryAttitude,atmosphereVelocity,localUp,VEHICLE,type FlightInput,type FlightTelemetry} from '../src/mars-flight';
import {SurfaceView} from '../src/mars-surface';
import {add,len,mul,dot,type V} from '../src/vector';

const mola = new MolaHeights(await Bun.file(new URL('../public/textures/mars-radius.img', import.meta.url)).arrayBuffer());
mola.setCanyon(await Bun.file(new URL('../public/textures/mars-canyon-radius.img', import.meta.url)).arrayBuffer());
const surface = new MarsSurface(mola);
type S = MarsState & {tele?: FlightTelemetry};

function place(lat: number, lon: number, agl: number, heading: number, speed: number, gamma: number, alpha: number) {
  const s: S = marsInitial(); s.heat = 0;
  const dir = new T.Vector3(...latLonToDir(lat, lon)), ground = surface.radiusM(dir.toArray() as V, 3);
  s.p = dir.clone().multiplyScalar((ground + agl) / 1000).toArray() as V;
  const north = new T.Vector3(0, 1, 0).addScaledVector(dir, -dir.y).normalize(), east = new T.Vector3().crossVectors(north, dir).normalize();
  const h = heading * Math.PI / 180, g = gamma * Math.PI / 180, a = alpha * Math.PI / 180;
  const flat = north.clone().multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
  const vel = flat.clone().multiplyScalar(Math.cos(g)).addScaledVector(dir, Math.sin(g));
  s.v = add(vel.clone().multiplyScalar(speed / 1000).toArray() as V, atmosphereVelocity(s.p));
  const right = flat.clone().cross(dir).normalize(), liftUp = right.clone().cross(vel).normalize();
  const fwd = vel.clone().multiplyScalar(Math.cos(a)).addScaledVector(liftUp, Math.sin(a)), up = liftUp.clone().multiplyScalar(Math.cos(a)).addScaledVector(vel, -Math.sin(a));
  const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(fwd.clone().cross(up).normalize(), up, fwd.clone().negate()));
  return {s, q};
}
const noInput = (): FlightInput => ({throttle: 0, hover: 0, lateral: 0, surge: 0});
function fly(s: S, q: T.Quaternion, seconds: number, each: (t: number, s: S) => {stick?: T.Vector3; input?: Partial<FlightInput>; gear?: boolean; assist?: boolean; entry?: boolean} = () => ({}), dt = 1 / 60) {
  const c = new FlightControl();
  for (let t = 0; t < seconds && (s.status === 'flying' || s.status === 'landed'); t += dt) {
    advanceFlight(s, 0, q, noInput(), {surface, gear: false});
    const cmd = each(t, s), input = {...noInput(), ...cmd.input};
    const tele = s.tele!;
    if (cmd.entry) c.pointTo(entryAttitude(tele));
    if (cmd.assist) {const a = descentAssist(s, tele, q); input.hover = a.hover; input.lateral = a.lateral; input.surge = a.surge; c.pointTo(a.level);}
    if (s.status === 'flying') c.update(q, cmd.stick ?? new T.Vector3(), dt, {alpha: tele.alpha, beta: tele.beta, qbar: tele.dynamicPressure});
    advanceFlight(s, dt, q, input, {surface, gear: cmd.gear ?? false});
  }
  return s;
}
const heading = (s: S) => {const up = new T.Vector3(...s.tele!.up), air = new T.Vector3(...s.tele!.airVelocity); return air.addScaledVector(up, -air.dot(up)).normalize();};

test('hands-off glide with light thrust holds a trimmed angle of attack', () => {
  const {s, q} = place(18.2, 77.4, 6000, 45, 270, 0, 10);
  fly(s, q, 40, () => ({input: {throttle: .12}}));
  expect(s.status).toBe('flying');
  expect(Math.abs(s.tele!.alpha * 180 / Math.PI - 9.2)).toBeLessThan(4);
  expect(Math.abs(s.tele!.beta)).toBeLessThan(.05);
  expect(s.tele!.agl).toBeGreaterThan(3500);
});

test('banking turns the flight path like an aircraft', () => {
  const {s, q} = place(18.2, 77.4, 6000, 45, 280, 0, 10);
  advanceFlight(s, 0, q, noInput(), {surface, gear: false});
  const before = heading(s);
  fly(s, q, 25, t => ({stick: new T.Vector3(t < 25 ? .25 : 0, 0, t < .9 ? -1 : 0), input: {throttle: .35}}));
  expect(s.status).toBe('flying');
  const turned = Math.acos(Math.min(1, before.dot(heading(s)))) * 180 / Math.PI;
  expect(turned).toBeGreaterThan(15); // ~0.75°/s: honest for 280 m/s in Mars gravity
});

test('descent assist lands softly on gear from 900 m', () => {
  const {s, q} = place(18.38, 77.58, 900, 20, 35, -30, 0);
  fly(s, q, 240, (_t, st) => ({assist: true, gear: st.tele!.agl < 400}));
  expect(s.status).toBe('landed');
  expect(s.body).toContain('Touchdown');
});

test('a steep unpowered dive impacts and reports the speed', () => {
  const {s, q} = place(18.38, 77.58, 1500, 0, 250, -40, 0);
  fly(s, q, 60);
  expect(s.status).toBe('impact');
  expect(s.body).toMatch(/Surface impact at \d+ m\/s/);
});

test('a landed ship stays put on the rotating surface and lifts off with the hover jets', () => {
  const {s, q} = place(18.38, 77.58, VEHICLE.gearClearance, 0, 0, 0, 0);
  s.status = 'landed';
  const startBody = inertialToBody(s.p, s.t, MARS.rotation);
  fly(s, q, 30, () => ({gear: true}));
  expect(s.status).toBe('landed');
  const endBody = inertialToBody(s.p, s.t, MARS.rotation);
  expect(len(add(endBody, startBody.map(x => -x) as V)) * 1000).toBeLessThan(.5);
  fly(s, q, 4, () => ({gear: true, input: {hover: 1}}));
  expect(s.status).toBe('flying');
  expect(s.tele!.agl).toBeGreaterThan(1);
});

test('belly-first entry heats far less than nose-first entry', () => {
  const run = (entry: boolean) => {const {s, q} = place(10, 60, 45000, 60, 3400, -6, entry ? 40 : 0); fly(s, q, 40, () => ({entry, stick: entry ? undefined : new T.Vector3(-.4, 0, 0)}), 1 / 30); return s.heat ?? 0;};
  const belly = run(true), nose = run(false);
  expect(belly).toBeLessThan(nose * .7);
  expect(nose).toBeGreaterThan(20);
});

test('rendered terrain rings sit on the same surface the physics collides with', () => {
  const view = new SurfaceView(surface, null);
  const {s} = place(18.38, 77.58, 40, 0, 0, 0, 0);
  const cam = new T.PerspectiveCamera(64, 1.6, .4, 8e6);
  for (let i = 0; i < 40; i++) view.update(s.p, s.t, cam, new T.Vector3(), 0);
  const finest = [...view.rings.values()].sort((a, b) => a.cell - b.cell)[0];
  expect(finest.cell).toBeLessThanOrEqual(4);
  const pos = finest.mesh.geometry.getAttribute('position');
  const planet = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), s.t / MARS.rotation * Math.PI * 2);
  const ship = new T.Vector3(...s.p).multiplyScalar(1000);
  for (const k of [0, 4704, 9408, 3000]) {
    const world = new T.Vector3().fromBufferAttribute(pos, k).applyQuaternion(planet).add(finest.mesh.position).add(ship);
    const body = inertialToBody(world.toArray() as V, s.t, MARS.rotation);
    const physics = surface.radiusM(body, Math.max(2, finest.cell * 2));
    expect(Math.abs(Math.hypot(...body) - physics)).toBeLessThan(.05);
  }
});

test('sideslip weathervanes out instead of growing', () => {
  const {s, q} = place(18.2, 77.4, 6000, 45, 270, 0, 8);
  q.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), .18));
  advanceFlight(s, 0, q, noInput(), {surface, gear: false});
  const start = Math.abs(s.tele!.beta);
  fly(s, q, 8, () => ({input: {throttle: .15}}));
  expect(start).toBeGreaterThan(.15);
  expect(Math.abs(s.tele!.beta)).toBeLessThan(.03);
});

test('arrival coasts past Mars but a retrograde capture burn at periapsis enters orbit', async () => {
  const {arrivalState, orbitOf} = await import('../src/mars-orbit');
  const run = (burn: boolean) => {
    const a = arrivalState(300, 2.65, 150000), s: S = marsInitial(); s.p = a.p; s.v = a.v; s.heat = 0;
    const q = new T.Quaternion(), env = {surface, gear: false};
    advanceFlight(s, a.secondsToPeriapsis - 60, q, noInput(), env);
    if (burn) {
      q.setFromUnitVectors(new T.Vector3(0, 0, -1), new T.Vector3(...s.v).normalize().negate());
      const need = orbitOf(s.p, s.v).captureDeltaV;
      advanceFlight(s, need * 1000 / VEHICLE.torchThrust, q, {...noInput(), throttle: 1, torch: true}, env);
    }
    advanceFlight(s, 7200, new T.Quaternion(), noInput(), env);
    return {s, o: orbitOf(s.p, s.v)};
  };
  const coast = run(false), capture = run(true);
  expect(coast.s.status).toBe('flying'); expect(coast.o.status).toBe('escape');
  expect(capture.s.status).toBe('flying'); expect(capture.o.status).toBe('orbit');
  expect(capture.o.periapsis).toBeGreaterThan(150);
});

test('torch drive in dense air breaks the airframe instead of reaching orbital speed', () => {
  const {s, q} = place(18.2, 77.4, 3000, 45, 300, 0, 2);
  fly(s, q, 30, () => ({input: {throttle: 1, torch: true}}));
  expect(s.status).toBe('impact');
  expect(s.body).toMatch(/Structural failure|Hull burned through/);
});

test('wind pushes a ship downwind, but the radar descent assist holds its ground track', () => {
  const run = (wind: V | undefined, assisted: boolean) => {
    const {s, q} = place(18.38, 77.58, 60, 0, 0, 0, 0);
    const start = inertialToBody(s.p, s.t, MARS.rotation);
    const c = new FlightControl();
    for (let i = 0; i < 600; i++) {
      advanceFlight(s, 0, q, noInput(), {surface, gear: false, wind});
      const a = descentAssist(s, s.tele!, q);
      const hold = assisted ? a : {hover: a.hover, lateral: 0, surge: 0};
      advanceFlight(s, 1 / 60, q, {throttle: 0, hover: Math.min(1, hold.hover + .02), lateral: hold.lateral, surge: hold.surge}, {surface, gear: false, wind});
      c.update(q, new T.Vector3(), 1 / 60);
    }
    const end = inertialToBody(s.p, s.t, MARS.rotation);
    const d = add(end, start.map(x => -x) as V), up = localUp(start);
    return len(add(d, mul(up, -dot(d, up)))) * 1000; // horizontal drift, metres
  };
  // 25 m/s wind along the local east direction.
  const {s} = place(18.38, 77.58, 60, 0, 0, 0, 0), up = localUp(s.p), east = new T.Vector3(0, 1, 0).cross(new T.Vector3(...up)).normalize();
  const wind = east.multiplyScalar(.025).toArray() as V;
  const free = run(wind, false), calm = run(undefined, false), held = run(wind, true);
  expect(free).toBeGreaterThan(calm + 10);
  expect(held).toBeLessThan(free / 2);
});
