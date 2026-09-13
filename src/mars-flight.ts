import * as T from 'three';
import {add,mul,len,dot,segmentHitsSphere,type V} from './vector';
import {MARS,MARS_MOONS,marsGravity,marsMoonState,type MarsState} from './mars';
import {MarsSurface,bodyToInertial,inertialToBody} from './mars-geo';

/**
 * Atmospheric and surface flight for the fictional PATHFINDER spaceplane.
 * Units follow mars.ts: km and km/s for state; aerodynamics are computed in SI and converted.
 */
export const VEHICLE = {
  mass: 42000,            // kg
  wingArea: 1100,         // m², fictional high-lift wing: real Mars air is too thin for a 38 m plane to turn
  mainThrust: 2 * 9.80665,   // m/s² at full throttle (fictional fusion drive)
  torchThrust: 30 * 9.80665, // m/s² torch mode: fictional, for interplanetary speeds
  maxDynamicPressure: 45000, // Pa before the airframe breaks up
  hoverThrust: .85 * 9.80665,// m/s² belly VTOL jets
  lateralThrust: .3 * 9.80665,
  gearClearance: 3.4,     // m, centre of mass above footpads with gear down
  bellyClearance: 2.1,
};
const G0 = 9.80665;

export function atmosphereDensity(altitudeM: number) {return .020 * Math.exp(-Math.max(-8000, altitudeM) / 11100);}

export interface FlightInput {
  throttle: number;          // 0..1 main drive along the nose
  hover: number;             // -1..1 belly jets (+ pushes up in body frame)
  lateral: number;           // -1..1 along body +X
  surge: number;             // -1..1 extra along nose (reverse RCS)
  torch?: boolean;           // main drive in torch mode
}
export interface FlightTelemetry {
  agl: number; verticalSpeed: number; groundSpeed: number; airspeed: number; mach: number;
  alpha: number; beta: number; dynamicPressure: number; gLoad: number; heatFlux: number;
  up: V; airVelocity: V; groundVelocity?: V; impactSpeed: number;
}
export interface FlightEnv {surface: MarsSurface; gear: boolean; /** Wind relative to the rotating ground, inertial km/s. */ wind?: V;}

export function localUp(p: V): V {const l = len(p); return [p[0] / l, p[1] / l, p[2] / l];}
export function atmosphereVelocity(p: V): V {const w = 2 * Math.PI / MARS.rotation; return [w * p[2], 0, -w * p[0]];}
export function surfaceRadiusKm(env: FlightEnv, p: V, t: number, minWave = 3) {
  return env.surface.radiusM(inertialToBody(p, t, MARS.rotation), minWave) / 1000;
}

function axes(q: T.Quaternion) {
  return {
    forward: new T.Vector3(0, 0, -1).applyQuaternion(q).toArray() as V,
    up: new T.Vector3(0, 1, 0).applyQuaternion(q).toArray() as V,
    right: new T.Vector3(1, 0, 0).applyQuaternion(q).toArray() as V,
  };
}

/** Aerodynamic acceleration (km/s²) plus flow angles for the given attitude. */
export function aerodynamics(p: V, v: V, q: T.Quaternion, altitudeM: number, wind?: V) {
  let air = add(v, mul(atmosphereVelocity(p), -1));
  if (wind) air = add(air, mul(wind, -1));
  const speed = len(air) * 1000;
  const rho = atmosphereDensity(altitudeM), qbar = .5 * rho * speed * speed;
  const {forward, up, right} = axes(q);
  if (speed < .5) return {accel: [0, 0, 0] as V, alpha: 0, beta: 0, qbar, speed, rho};
  const vh = mul(air, 1 / len(air));
  const alpha = Math.atan2(-dot(vh, up), dot(vh, forward));
  const beta = Math.atan2(dot(vh, right), dot(vh, forward));
  const cl = 2.1 * Math.sin(alpha) * Math.cos(alpha) * Math.cos(beta);
  const cd = .06 + 1.45 * Math.sin(alpha) ** 2 + .9 * Math.sin(beta) ** 2;
  const cy = -1.1 * Math.sin(beta) * Math.cos(beta);
  const liftDir = add(up, mul(vh, -dot(up, vh))), liftLen = len(liftDir) || 1;
  const sideDir = add(right, mul(vh, -dot(right, vh))), sideLen = len(sideDir) || 1;
  const k = qbar * VEHICLE.wingArea / VEHICLE.mass / 1000; // → km/s²
  const accel = add(add(mul(liftDir, cl * k / liftLen), mul(sideDir, cy * k / sideLen)), mul(vh, -cd * k));
  return {accel, alpha, beta, qbar, speed, rho};
}

/** Advance atmospheric flight with ground contact. Attitude is held fixed for the call. */
export function advanceFlight(s: MarsState & {tele?: FlightTelemetry}, seconds: number, q: T.Quaternion, input: FlightInput, env: FlightEnv) {
  const {forward, up, right} = axes(q);
  const initial = aerodynamics(s.p, s.v, q, (len(s.p) - MARS.radius) * 1000, env.wind);
  let left = seconds, gLoad = 0, heatFlux = 0, alpha = initial.alpha, beta = initial.beta, qbar = initial.qbar, impactSpeed = 0;
  const clearance = (env.gear ? VEHICLE.gearClearance : VEHICLE.bellyClearance) / 1000;

  if (s.status === 'landed') {
    const upL = localUp(s.p);
    const thrustUp = dot(add(add(mul(forward, input.throttle * (input.torch ? VEHICLE.torchThrust : VEHICLE.mainThrust)), mul(up, input.hover * VEHICLE.hoverThrust)), mul(forward, input.surge * VEHICLE.lateralThrust)), upL);
    if (thrustUp > MARS.mu / len(s.p) ** 2 * 1000 * 1.02) s.status = 'flying';
    else {
      s.v = atmosphereVelocity(s.p);
      s.p = bodyToInertial(inertialToBody(s.p, s.t, MARS.rotation), s.t + seconds, MARS.rotation);
      s.t += seconds; s.v = atmosphereVelocity(s.p);
      s.tele = telemetry(s, env, q, 0, 0, 0, 0, 0, 0);
      return;
    }
  }

  while (left > 1e-9 && s.status === 'flying') {
    const r = len(s.p), approxAlt = (r - MARS.radius) * 1000;
    const dt = Math.min(left, approxAlt < 30000 ? .02 : approxAlt < 150000 ? .1 : .5);
    const oldP = s.p, oldT = s.t;
    const drive = input.throttle * (input.torch ? VEHICLE.torchThrust : VEHICLE.mainThrust);
    const thrustMs2 = add(add(mul(forward, drive + input.surge * VEHICLE.lateralThrust), mul(up, input.hover * VEHICLE.hoverThrust)), mul(right, input.lateral * VEHICLE.lateralThrust));
    const fuelScale = s.fuel > 0 ? 1 : 0;
    const thrust = mul(thrustMs2, fuelScale / 1000);
    const accelAt = (p: V, v: V, time: number) => {
      const a = aerodynamics(p, v, q, (len(p) - MARS.radius) * 1000, env.wind);
      alpha = a.alpha; beta = a.beta; qbar = a.qbar;
      return {total: add(add(marsGravity(p, time), thrust), a.accel), aero: a.accel, speed: a.speed, rho: a.rho};
    };
    const a0 = accelAt(s.p, s.v, s.t);
    const next = add(add(s.p, mul(s.v, dt)), mul(a0.total, dt * dt * .5));
    const a1 = accelAt(next, add(s.v, mul(a0.total, dt)), s.t + dt);
    s.v = add(s.v, mul(add(a0.total, a1.total), dt * .5)); s.p = next; s.t += dt;
    s.fuel = Math.max(0, s.fuel - Math.max(0, len(thrustMs2) - drive) / G0 * dt * .02 - drive / G0 * dt * (input.torch ? .0015 : .02));
    gLoad = len(add(a1.aero, thrust)) * 1000 / G0;

    // Heating: Sutton-Graves-like √ρ·v³, shielded when the black belly faces the flow.
    const air = add(s.v, mul(atmosphereVelocity(s.p), -1)), airLen = len(air) || 1;
    const bellyFacing = Math.max(0, -dot(mul(air, 1 / airLen), up)); // moving belly-first into the flow
    const shield = .25 + .75 * (1 - Math.min(1, bellyFacing * 1.5));
    heatFlux = Math.sqrt(a1.rho / .02) * (a1.speed / 1000) ** 3 * .6 * shield;
    s.heat = Math.max(0, (s.heat ?? 0) + (heatFlux - .8) * dt);
    s.dynamicPressure = qbar;
    if ((s.heat ?? 0) >= 100) {s.status = 'impact'; s.body = 'Hull burned through during entry';}
    if (qbar > VEHICLE.maxDynamicPressure) {s.status = 'impact'; s.body = `Structural failure at ${(qbar / 1000).toFixed(0)} kPa dynamic pressure, ${(a1.speed / 1000).toFixed(2)} km/s`;}

    const surfaceKm = surfaceRadiusKm(env, s.p, s.t, 3);
    if (len(s.p) - clearance <= surfaceKm) {
      const upL = localUp(s.p), rel = add(s.v, mul(atmosphereVelocity(s.p), -1));
      const vn = dot(rel, upL) * 1000, vt = len(add(rel, mul(upL, -dot(rel, upL)))) * 1000;
      impactSpeed = len(rel) * 1000;
      const upright = dot(up, upL);
      if (env.gear && upright > .82 && -vn < 6 && vt < 5) {
        s.status = 'landed'; s.body = `Touchdown ${(-vn).toFixed(1)} m/s vertical`;
        s.p = mul(upL, surfaceKm + clearance); s.v = atmosphereVelocity(s.p);
      } else {
        s.status = 'impact';
        s.body = !env.gear && upright > .82 && -vn < 6 && vt < 5 ? 'Landing gear retracted' : upright <= .82 && impactSpeed < 12 ? 'Tipped over on touchdown' : `Surface impact at ${impactSpeed.toFixed(0)} m/s`;
        s.p = mul(upL, surfaceKm + clearance * .3);
      }
    }
    MARS_MOONS.forEach((m, i) => {
      if (segmentHitsSphere(add(oldP, mul(marsMoonState(i, oldT).p, -1)), add(s.p, mul(marsMoonState(i, s.t).p, -1)), m.radius)) {s.status = 'impact'; s.body = m.name;}
    });
    left -= dt;
  }
  s.tele = telemetry(s, env, q, alpha, beta, qbar, gLoad, heatFlux, impactSpeed);
}

function telemetry(s: MarsState, env: FlightEnv, q: T.Quaternion, alpha: number, beta: number, qbar: number, gLoad: number, heatFlux: number, impactSpeed: number): FlightTelemetry {
  // Co-rotating air only exists near Mars; far out, report motion relative to Mars' centre.
  const upL = localUp(s.p), air = len(s.p) - MARS.radius > 250 ? s.v : add(add(s.v, mul(atmosphereVelocity(s.p), -1)), mul(env.wind ?? [0, 0, 0], -1));
  const clearance = (env.gear ? VEHICLE.gearClearance : VEHICLE.bellyClearance) / 1000;
  const agl = (len(s.p) - clearance - surfaceRadiusKm(env, s.p, s.t, 3)) * 1000;
  // Vertical and ground speed are relative to the surface, not the wind: a parked ship reads zero in a gale.
  const ground = len(s.p) - MARS.radius > 250 ? s.v : add(s.v, mul(atmosphereVelocity(s.p), -1));
  const vs = dot(ground, upL) * 1000;
  return {agl, verticalSpeed: vs, groundSpeed: len(add(ground, mul(upL, -dot(ground, upL)))) * 1000, airspeed: len(air) * 1000, mach: len(air) * 1000 / 240,
    alpha, beta, dynamicPressure: qbar, gLoad, heatFlux, up: upL, airVelocity: air, groundVelocity: ground, impactSpeed};
}

/**
 * Fly-by-wire attitude: stick commands body rates, the controller chases them with a short time constant.
 * In air, pitch trims toward a gliding angle of attack and yaw weathervanes out sideslip, so banking turns the ship.
 */
export class FlightControl {
  angularVelocity = new T.Vector3();
  assisted = true;
  target: T.Quaternion | null = null;
  maxRate = new T.Vector3(.58, .36, .92);   // pitch, yaw, roll rad/s; precise by default
  reset() {this.angularVelocity.set(0, 0, 0); this.target = null;}
  pointTo(rotation: T.Quaternion) {this.target = rotation.clone();}
  update(rotation: T.Quaternion, stick: T.Vector3, seconds: number, flow?: {alpha: number; beta: number; qbar: number}) {
    if (stick.lengthSq() > 1e-4) this.target = null;
    let remaining = Math.max(0, Math.min(seconds, .25));
    const air = flow ? Math.min(1, flow.qbar / 250) : 0;
    while (remaining > 1e-9) {
      const dt = Math.min(remaining, 1 / 240);
      const command = new T.Vector3(stick.x * this.maxRate.x, stick.y * this.maxRate.y, stick.z * this.maxRate.z);
      if (flow && air > 0) {
        const trim = .16;
        if (Math.abs(stick.x) < .05) command.x += -Math.sin(flow.alpha - trim) * 1.1 * air;
        command.y -= Math.sin(flow.beta) * 1.6 * air;
      }
      let accel: T.Vector3;
      if (this.target) {
        const error = rotation.clone().invert().multiply(this.target);
        if (error.w < 0) error.set(-error.x, -error.y, -error.z, -error.w);
        const want = new T.Vector3(error.x, error.y, error.z).multiplyScalar(4.2).clampLength(0, .8);
        accel = want.sub(this.angularVelocity).multiplyScalar(5);
      } else if (this.assisted || air > .2) {
        accel = command.sub(this.angularVelocity).multiplyScalar(7.2);
      } else {
        accel = new T.Vector3(stick.x, stick.y, stick.z).multiplyScalar(1.6);
      }
      this.angularVelocity.addScaledVector(accel.clampLength(0, 4.5), dt);
      const speed = this.angularVelocity.length();
      if (speed > 1e-9) rotation.multiply(new T.Quaternion().setFromAxisAngle(this.angularVelocity.clone().divideScalar(speed), speed * dt)).normalize();
      remaining -= dt;
    }
  }
}

/**
 * Descent assist: hover jets and attitude bring the ship down gently over the current spot.
 * Returns the jet commands; the caller applies them as FlightInput and points the attitude controller.
 */
/** Attitude that presents the belly to the flow at the given angle of attack, wings level. */
export function entryAttitude(tele: FlightTelemetry, alphaDeg = 40) {
  const vh = new T.Vector3(...tele.airVelocity).normalize(), upL = new T.Vector3(...tele.up);
  const right = vh.clone().cross(upL).normalize(), liftUp = right.clone().cross(vh).normalize(), a = alphaDeg * Math.PI / 180;
  const fwd = vh.clone().multiplyScalar(Math.cos(a)).addScaledVector(liftUp, Math.sin(a)), up = liftUp.clone().multiplyScalar(Math.cos(a)).addScaledVector(vh, -Math.sin(a));
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(fwd.clone().cross(up).normalize(), up, fwd.clone().negate()));
}

export function descentAssist(s: MarsState, tele: FlightTelemetry, q: T.Quaternion) {
  const upL = new T.Vector3(...tele.up);
  const {forward, up, right} = axes(q);
  const g = MARS.mu / len(s.p) ** 2 * 1000;
  const targetVs = -T.MathUtils.clamp(tele.agl / 7, 1.2, 45);
  // Radar-referenced like a real landing system: track descent rate and null drift over the ground, so wind
  // cannot carry an assisted ship off the pad.
  const ground = new T.Vector3(...(tele.groundVelocity ?? tele.airVelocity)).multiplyScalar(1000);
  const horizontal = ground.clone().addScaledVector(upL, -ground.dot(upL));
  // Desired inertial acceleration (m/s²): cancel gravity, track descent rate, null drift.
  const want = upL.clone().multiplyScalar(g + (targetVs - tele.verticalSpeed) * 1.4).addScaledVector(horizontal, -.55);
  const hover = T.MathUtils.clamp(want.dot(new T.Vector3(...up)) / VEHICLE.hoverThrust, 0, 1);
  const lateral = T.MathUtils.clamp(want.dot(new T.Vector3(...right)) / VEHICLE.lateralThrust, -1, 1);
  const surge = T.MathUtils.clamp(want.dot(new T.Vector3(...forward)) / VEHICLE.lateralThrust, -1, 1);
  // Level the ship with the local horizon, keeping the current heading.
  const heading = new T.Vector3(...forward).addScaledVector(upL, -new T.Vector3(...forward).dot(upL));
  if (heading.lengthSq() < 1e-6) heading.set(...right).cross(upL);
  heading.normalize();
  const level = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(heading.clone().cross(upL).normalize(), upL, heading.clone().negate()));
  return {hover, lateral, surge, level, targetVs};
}
