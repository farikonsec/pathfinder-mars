import * as T from 'three';
import {drawStencil} from './rahimli-font';
import {latLonToDir, dirToLatLon} from './mars-geo';
import type {V} from './vector';

/**
 * JEZERO BASE: a fictional first human settlement, 2.5 km north-east of Perseverance's landing site.
 * Built in a local frame in metres: +X east, +Y up, -Z north (three.js convention after the prop is oriented).
 */
export const BASE = {lat: 18.462, lon: 77.472, flattenRadius: 420};
export const PADS = [
  {name: 'PAD 1', x: -210, z: 30},
  {name: 'PAD 2', x: -210, z: -120},
];
export const PAD_RADIUS = 32;

/** Body-fixed basis at the base: local +X east, +Y up, +Z south. */
export function baseBasis() {
  const up = new T.Vector3(...latLonToDir(BASE.lat, BASE.lon));
  const east = new T.Vector3(0, 1, 0).cross(up).normalize(), north = up.clone().cross(east).normalize();
  return {up, east, north, matrix: new T.Matrix4().makeBasis(east, up, north.clone().negate())};
}
/** Direction (body-fixed unit vector) of a point given in base-local metres. */
export function baseLocalDir(x: number, z: number): V {
  const {up, east, north} = baseBasis(), R = 3389500;
  return up.clone().multiplyScalar(R).addScaledVector(east, x).addScaledVector(north, -z).normalize().toArray() as V;
}
export const padLatLon = (i: number) => dirToLatLon(baseLocalDir(PADS[i].x, PADS[i].z));

const mat = (color: number, rough = .8, metal = 0, extra: Partial<T.MeshStandardMaterialParameters> = {}) => new T.MeshStandardMaterial({color, roughness: rough, metalness: metal, ...extra});
const regolith = mat(0x9a6e52, .95), sintered = mat(0x5f5550, .9), white = mat(0xe8e4dc, .55, .05), metal = mat(0x8c9095, .35, .85), dark = mat(0x2b2e33, .6, .3);
const solar = mat(0x1a2440, .25, .6, {emissive: 0x040712});
const glass = new T.MeshPhysicalMaterial({color: 0xd8f0e0, roughness: .15, metalness: 0, transmission: 0, transparent: true, opacity: .38, depthWrite: false, side: T.DoubleSide});
const windowLit = mat(0xffd9a0, .4, 0, {emissive: 0xffb865, emissiveIntensity: 0});
const growLight = mat(0xffffff, .5, 0, {emissive: 0xff5fd0, emissiveIntensity: 0});
const leaves = mat(0x4f8a3a, .8, 0, {emissive: 0x16300c, emissiveIntensity: .2});
const lamp = new T.MeshBasicMaterial({color: 0xffc070});
const redLamp = new T.MeshBasicMaterial({color: 0xff3a2a});

function add(parent: T.Object3D, g: T.BufferGeometry, m: T.Material, x = 0, y = 0, z = 0) {
  const o = new T.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o;
}
function tube(parent: T.Object3D, ax: number, az: number, bx: number, bz: number, radius: number, y: number, m: T.Material) {
  const a = new T.Vector3(ax, y, az), b = new T.Vector3(bx, y, bz), o = add(parent, new T.CylinderGeometry(radius, radius, a.distanceTo(b), 16), m);
  o.position.copy(a).add(b).multiplyScalar(.5); o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  // Regolith shielding over pressurised connectors (not pipes): a low, closed mound.
  if (radius >= 1) {
    const berm = add(parent, new T.CylinderGeometry(radius * 1.9, radius * 1.9, a.distanceTo(b), 14), regolith);
    berm.position.copy(o.position).setY(y - radius * .9); berm.quaternion.copy(o.quaternion); berm.scale.set(1, 1, .55);
  }
  return o;
}
function textPlane(text: string, width: number, height: number, color: string, background = 'rgba(0,0,0,0)') {
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * height / width);
  const k = c.getContext('2d')!; k.fillStyle = background; k.fillRect(0, 0, c.width, c.height);
  drawStencil(k, text, c.width / 2, c.height * .18, {size: c.height * .64, weight: 1.05, tracking: 1.4, color, align: 'center'});
  const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 8;
  return new T.Mesh(new T.PlaneGeometry(width, height), new T.MeshStandardMaterial({map: tex, transparent: true, roughness: .9, polygonOffset: true, polygonOffsetFactor: -4}));
}

function pad(parent: T.Object3D, name: string, x: number, z: number) {
  const g = new T.Group(); g.position.set(x, 0, z); parent.add(g);
  add(g, new T.CylinderGeometry(PAD_RADIUS, PAD_RADIUS + 2, .25, 64), sintered, 0, .05, 0);
  const ring = add(g, new T.RingGeometry(PAD_RADIUS - 4, PAD_RADIUS - 2.6, 64), mat(0xf2e9dc, .7)); ring.rotation.x = -Math.PI / 2; ring.position.y = .19;
  const inner = add(g, new T.RingGeometry(9, 10.2, 48), mat(0xffc46b, .7)); inner.rotation.x = -Math.PI / 2; inner.position.y = .19;
  const label = textPlane(name, 26, 6, '#f2e9dc'); label.rotation.x = -Math.PI / 2; label.position.set(0, .2, 17); g.add(label);
  const lights: T.Mesh[] = [];
  for (let i = 0; i < 16; i++) {const a = i / 16 * Math.PI * 2; const l = add(g, new T.SphereGeometry(.35, 8, 6), lamp, Math.cos(a) * (PAD_RADIUS + 1), .45, Math.sin(a) * (PAD_RADIUS + 1)); l.castShadow = false; lights.push(l);}
  // Blast deflector berm on the habitat side.
  const berm = add(g, new T.TorusGeometry(PAD_RADIUS + 10, 1.8, 6, 40, Math.PI * .6), regolith); berm.rotation.x = -Math.PI / 2; berm.rotation.z = -Math.PI * .3; berm.position.y = -.9; berm.scale.z = .6;
  g.userData.lights = lights;
  return g;
}

function dome(parent: T.Object3D, x: number, z: number, r: number) {
  const g = new T.Group(); g.position.set(x, 0, z); parent.add(g);
  add(g, new T.SphereGeometry(r, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), regolith);
  add(g, new T.SphereGeometry(r * .92, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), white).scale.set(1, 1.02, 1);
  const band = add(g, new T.CylinderGeometry(r * .97, r * 1.0, 1.3, 40, 1, true), windowLit, 0, r * .28, 0); band.castShadow = false;
  for (let i = 0; i < 6; i++) {const a = i / 6 * Math.PI * 2; add(g, new T.BoxGeometry(1.4, 2.2, .6), dark, Math.cos(a) * r * .99, r * .3, Math.sin(a) * r * .99).rotation.y = -a;}
  add(g, new T.CylinderGeometry(1.2, 1.2, 2, 12), metal, 0, r + .6, 0);
  return g;
}

function greenhouse(parent: T.Object3D, x: number, z: number, length: number) {
  const g = new T.Group(); g.position.set(x, 0, z); parent.add(g);
  const shell = add(g, new T.CylinderGeometry(6, 6, length, 32, 1, true, 0, Math.PI), glass); shell.rotation.z = Math.PI / 2; shell.rotation.x = Math.PI / 2; shell.castShadow = false;
  for (let i = 0; i <= length / 6; i++) {const rib = add(g, new T.TorusGeometry(6, .12, 6, 24, Math.PI), metal, 0, 0, -length / 2 + i * 6); rib.castShadow = false;}
  add(g, new T.BoxGeometry(11, .3, length), sintered, 0, .15, 0);
  const rows = new T.InstancedMesh(new T.BoxGeometry(.8, .7, 1.1), leaves, 4 * Math.floor(length / 1.4));
  const m = new T.Matrix4(); let n = 0;
  for (const rx of [-3.6, -1.2, 1.2, 3.6]) for (let k = 0; k < Math.floor(length / 1.4); k++) {m.makeScale(1, .7 + .6 * Math.abs(Math.sin(k * 1.7 + rx)), 1).setPosition(rx, .75, -length / 2 + .7 + k * 1.4); rows.setMatrixAt(n++, m);}
  g.add(rows);
  for (const rx of [-2.4, 2.4]) {const bar = add(g, new T.BoxGeometry(.25, .12, length - 2), growLight, rx, 4.3, 0); bar.castShadow = false;}
  g.userData.grow = true;
  return g;
}

export function createBase() {
  const base = new T.Group(); base.name = 'JEZERO BASE';
  const pads = PADS.map(p => pad(base, p.name, p.x, p.z));
  // Habitat cluster and connectors.
  const hub = add(base, new T.CylinderGeometry(7, 7, 6, 24), white, 40, 3, 0);
  add(base, new T.CylinderGeometry(7.4, 7.4, .6, 24), dark, 40, 6.2, 0);
  const domes = [[95, 36, 14], [95, -36, 14], [-5, 50, 11]];
  domes.forEach(([x, z, r]) => {dome(base, x, z, r); tube(base, 40, 0, x, z, 2.1, 2.2, white);});
  tube(base, 40, 0, -40, -10, 2.1, 2.2, white);                  // to the airlock and pad road
  add(base, new T.BoxGeometry(14, 7, 10), white, -46, 3.5, -10);  // suitport airlock / garage
  add(base, new T.BoxGeometry(6, 5, .4), dark, -53.2, 2.5, -10).rotation.y = Math.PI / 2;
  for (const dz of [-3, 3]) {                                    // pressurised rovers
    const rover = new T.Group(); rover.position.set(-70, 0, -14 + dz * 3); base.add(rover);
    add(rover, new T.BoxGeometry(3.4, 2.6, 7), white, 0, 2.1, 0);
    add(rover, new T.BoxGeometry(3, 1.1, 2.2), windowLit, 0, 2.6, -3.1).castShadow = false;
    for (const wx of [-1.8, 1.8]) for (const wz of [-2.4, 0, 2.4]) {const w = add(rover, new T.CylinderGeometry(.75, .75, .6, 16), dark, wx, .75, wz); w.rotation.z = Math.PI / 2;}
  }
  // Greenhouse farms, joined by a spine connector.
  const farms = [-60, -42, -24, -6].map((dz, i) => {tube(base, 40 + (i === 0 ? 0 : 0), 0, 150, dz * 2 - 30, 1.6, 1.8, white); return greenhouse(base, 180, dz * 2 - 30, 70);});
  // Solar field.
  const panels = new T.InstancedMesh(new T.BoxGeometry(10, .15, 4), solar, 60);
  const m = new T.Matrix4(); let n = 0;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 12; c++) {m.makeRotationX(-.45).setPosition(-40 + c * 12, 1.8, 120 + r * 9); panels.setMatrixAt(n++, m);}
  panels.castShadow = panels.receiveShadow = true; base.add(panels);
  // ISRU propellant plant: tanks, cold box and pipe run to the pads.
  for (let i = 0; i < 4; i++) {add(base, new T.SphereGeometry(5, 24, 16), white, -100 - i * 13, 5, -170); add(base, new T.CylinderGeometry(.6, .6, 5, 8), metal, -100 - i * 13, 2.2, -170);}
  add(base, new T.BoxGeometry(18, 8, 12), mat(0xb9b2a6, .7), -80, 4, -150);
  // Propellant lines stop at a hydrant on the pad apron instead of running under the ship.
  const feed = (ax: number, az: number, pad: {x: number; z: number}) => {
    const dx = ax - pad.x, dz = az - pad.z, d = Math.hypot(dx, dz), k = (PAD_RADIUS + 5) / d, ex = pad.x + dx * k, ez = pad.z + dz * k;
    tube(base, ax, az, ex, ez, .5, .6, metal);
    add(base, new T.CylinderGeometry(.9, 1.1, 1.6, 12), mat(0xd8a13a, .6, .3), ex, .8, ez);
  };
  feed(-120, -160, PADS[1]);
  feed(-80, -150, PADS[0]);
  // Fission surface power behind a berm, a sensible distance away.
  for (let i = 0; i < 4; i++) {add(base, new T.CylinderGeometry(1.2, 1.6, 6, 16), dark, 300 + i * 9, 3, -260); add(base, new T.ConeGeometry(4, 3, 12, 1, true), metal, 300 + i * 9, 7, -260);}
  const shield = add(base, new T.BoxGeometry(60, 6, 6), regolith, 314, 3, -240); void shield;
  // Comms mast with a blinking beacon and dish.
  add(base, new T.CylinderGeometry(.4, .8, 40, 10), metal, 10, 20, 70);
  const dish = add(base, new T.SphereGeometry(4, 24, 10, 0, Math.PI * 2, 0, 1.1), white, 10, 36, 74); dish.rotation.x = -1.1;
  const beacon = add(base, new T.SphereGeometry(.6, 10, 8), redLamp, 10, 40.8, 70); beacon.castShadow = false;
  // Name on the hub roof and a big ground marker readable from the air.
  const roof = textPlane('JEZERO BASE', 13, 3, '#2b2e33'); roof.rotation.x = -Math.PI / 2; roof.position.set(40, 6.55, 0); base.add(roof);
  const ground = textPlane('JEZERO', 90, 20, 'rgba(242,233,220,.85)'); ground.rotation.x = -Math.PI / 2; ground.position.set(-60, .15, 80); base.add(ground);

  const nightLights = [new T.PointLight(0xffc68a, 0, 140, 1.6), new T.PointLight(0xffc68a, 0, 140, 1.6), new T.PointLight(0xffd9a8, 0, 180, 1.6)];
  nightLights[0].position.set(PADS[0].x, 12, PADS[0].z); nightLights[1].position.set(PADS[1].x, 12, PADS[1].z); nightLights[2].position.set(60, 20, 0);
  nightLights.forEach(l => base.add(l));

  base.userData.update = (time: number, darkness: number) => {
    windowLit.emissiveIntensity = .15 + 1.6 * darkness;
    growLight.emissiveIntensity = .6 + 1.4 * darkness;
    nightLights.forEach(l => l.intensity = 900 * darkness);
    const blink = (time % 1.2) < .6;
    pads.forEach(p => (p.userData.lights as T.Mesh[]).forEach((l, i) => l.visible = darkness > .05 ? true : ((time * 2 + i / 16) % 1) < .5));
    beacon.visible = blink;
    void farms; void hub;
  };
  return base;
}
