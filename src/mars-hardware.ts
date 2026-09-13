import * as T from 'three';

/**
 * Simplified, correctly sized stand-ins for the spacecraft that reached the surface.
 * Authored in metres with +Y up. Shapes follow each vehicle's silhouette, not its engineering detail.
 */
const white = new T.MeshStandardMaterial({color: 0xd9d6cf, roughness: .6, metalness: .1});
const dusty = new T.MeshStandardMaterial({color: 0xb8977a, roughness: .9});
const metal = new T.MeshStandardMaterial({color: 0x8b8f94, roughness: .35, metalness: .85});
const dark = new T.MeshStandardMaterial({color: 0x2a2c30, roughness: .6, metalness: .3});
const gold = new T.MeshStandardMaterial({color: 0xc59a45, roughness: .3, metalness: 1});
const solar = new T.MeshStandardMaterial({color: 0x1d2a4a, roughness: .25, metalness: .6, emissive: 0x050a18});
const wheel = new T.MeshStandardMaterial({color: 0x9a9aa0, roughness: .5, metalness: .7});

function mesh(g: T.BufferGeometry, m: T.Material, x = 0, y = 0, z = 0, parent?: T.Object3D) {
  const o = new T.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent?.add(o); return o;
}

function rover(kind: 'large' | 'mer' | 'zhurong' | 'sojourner') {
  const g = new T.Group();
  const s = kind === 'large' ? 1 : kind === 'zhurong' ? .85 : kind === 'mer' ? .55 : .2;
  const w = 2.7 * s, l = 3 * s, wr = .26 * s * (kind === 'large' ? 1 : 1.1);
  mesh(new T.BoxGeometry(w * .7, .55 * s, l * .75), kind === 'zhurong' ? new T.MeshStandardMaterial({color: 0x9aa8b8, roughness: .5, metalness: .4}) : white, 0, .95 * s, 0, g);
  for (const side of [-1, 1]) {
    mesh(new T.BoxGeometry(.08 * s, .08 * s, l * .95), metal, side * w * .42, .7 * s, 0, g);
    for (const z of [-l * .42, 0, l * .42]) {const tire = mesh(new T.CylinderGeometry(wr, wr, .4 * s, 18), wheel, side * w * .5, wr, z, g); tire.rotation.z = Math.PI / 2;}
  }
  if (kind === 'large') {
    const mast = mesh(new T.CylinderGeometry(.05, .06, 1.1, 8), metal, .5, 1.75, -1, g);
    mesh(new T.BoxGeometry(.5, .25, .3), white, .5, 2.35, -1.05, g); void mast;
    const rtg = mesh(new T.CylinderGeometry(.3, .3, .7, 12), dark, 0, 1.25, 1.45, g); rtg.rotation.x = .9;
    const arm = mesh(new T.BoxGeometry(.08, .08, 1.6), metal, -.6, 1.05, -1.9, g); arm.rotation.y = .3;
    const dish = mesh(new T.CylinderGeometry(.3, .3, .05, 20), metal, -.6, 1.4, .8, g); dish.rotation.x = .6;
  } else if (kind === 'mer') {
    mesh(new T.BoxGeometry(2.3, .04, 1.6), solar, 0, 1.25 * s + .1, 0, g);
    for (const side of [-1, 1]) {const wing = mesh(new T.BoxGeometry(.8, .04, 1.1), solar, side * 1.5, 1.2 * s + .1, .1, g); wing.rotation.z = side * -.08;}
    mesh(new T.CylinderGeometry(.03, .03, .9, 6), metal, .3, 1.7, -.6, g);
    mesh(new T.BoxGeometry(.35, .15, .15), white, .3, 2.15, -.62, g);
  } else if (kind === 'zhurong') {
    for (const [x, z, r] of [[-1.2, -.6, .5], [1.2, -.6, -.5], [-1.2, .6, -.5], [1.2, .6, .5]]) {const p = mesh(new T.BoxGeometry(1.2, .03, .8), solar, x, 1.5, z, g); p.rotation.z = r;}
    mesh(new T.CylinderGeometry(.04, .05, .9, 8), metal, 0, 1.8, -.9, g);
    mesh(new T.BoxGeometry(.4, .2, .2), white, 0, 2.3, -.95, g);
  } else {
    mesh(new T.BoxGeometry(.5, .02, .35), solar, 0, .33, 0, g);
  }
  return g;
}

function viking() {
  const g = new T.Group();
  mesh(new T.CylinderGeometry(.9, .9, .45, 6), white, 0, 1.1, 0, g);
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
    const leg = mesh(new T.CylinderGeometry(.05, .05, 1.3, 8), metal, x * 1.1, .55, z * 1.1, g); leg.rotation.set(z * .5, 0, -x * .5);
    mesh(new T.CylinderGeometry(.25, .3, .08, 14), metal, x * 1.35, .04, z * 1.35, g);
  }
  mesh(new T.CylinderGeometry(.08, .08, 1.2, 8), metal, .4, 1.9, .2, g);
  const dish = mesh(new T.SphereGeometry(.5, 20, 8, 0, Math.PI * 2, 0, .9), white, .4, 2.55, .2, g); dish.rotation.x = -.9;
  for (const side of [-1, 1]) mesh(new T.CylinderGeometry(.18, .18, .7, 12), dark, side * .7, 1.5, -.5, g);
  const arm = mesh(new T.BoxGeometry(.06, .06, 1.8), metal, -.4, 1.1, 1.3, g); arm.rotation.x = .3;
  return g;
}

function deckLander(kind: 'phoenix' | 'insight') {
  const g = new T.Group();
  mesh(new T.CylinderGeometry(.8, .8, .35, kind === 'phoenix' ? 10 : 24), white, 0, 1, 0, g);
  const r = kind === 'phoenix' ? 1.05 : 1.1;
  for (const side of [-1, 1]) {
    const panel = mesh(new T.CylinderGeometry(r, r, .04, kind === 'phoenix' ? 10 : 12), solar, side * 2, 1.05, 0, g);
    panel.userData.side = side;
  }
  for (let i = 0; i < 3; i++) {const a = i / 3 * Math.PI * 2 + .5; mesh(new T.CylinderGeometry(.05, .05, 1, 8), metal, Math.cos(a) * .7, .45, Math.sin(a) * .7, g); mesh(new T.CylinderGeometry(.2, .22, .06, 12), metal, Math.cos(a) * .75, .03, Math.sin(a) * .75, g);}
  if (kind === 'insight') {
    const dome = mesh(new T.SphereGeometry(.35, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), white, .2, 0, 1.8, g); void dome;
    const arm = mesh(new T.BoxGeometry(.06, .06, 1.6), metal, 0, 1.2, 1, g); arm.rotation.x = -.5;
  } else {
    const arm = mesh(new T.BoxGeometry(.06, .06, 2.2), metal, 0, 1.1, 1.3, g); arm.rotation.x = .25;
    mesh(new T.CylinderGeometry(.03, .03, 1.2, 6), metal, -.3, 1.7, 0, g);
  }
  return g;
}

function petalLander(kind: 'pathfinder' | 'beagle2' | 'mars3') {
  const g = new T.Group();
  if (kind === 'mars3') {
    mesh(new T.SphereGeometry(.6, 20, 14), white, 0, .6, 0, g);
    for (let i = 0; i < 4; i++) {const a = i / 4 * Math.PI * 2, p = mesh(new T.BoxGeometry(.9, .04, .5), metal, Math.cos(a) * .9, .1, Math.sin(a) * .9, g); p.rotation.y = -a;}
    return g;
  }
  if (kind === 'beagle2') {
    mesh(new T.CylinderGeometry(.45, .45, .2, 24), gold, 0, .12, 0, g);
    for (let i = 0; i < 4; i++) {const a = i / 4 * Math.PI * 2, p = mesh(new T.CylinderGeometry(.35, .35, .03, 14), solar, Math.cos(a) * .6, .2 + (i > 1 ? .2 : 0), Math.sin(a) * .6, g); p.rotation.x = i > 1 ? .8 : 0;}
    return g;
  }
  mesh(new T.CylinderGeometry(.35, .5, .6, 3), gold, 0, .3, 0, g);
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2, petal = mesh(new T.CylinderGeometry(.01, 1.1, .05, 3), solar, Math.cos(a) * 1.1, .03, Math.sin(a) * 1.1, g); petal.rotation.y = -a;
    mesh(new T.SphereGeometry(.35, 10, 8), dusty, Math.cos(a + .5) * 2.1, .2, Math.sin(a + .5) * 2.1, g);
  }
  mesh(new T.CylinderGeometry(.04, .04, 1, 6), metal, 0, 1, 0, g);
  const sojourner = rover('sojourner'); sojourner.position.set(2.4, 0, 1.2); g.add(sojourner);
  return g;
}

function crashScar() {
  const g = new T.Group();
  const scar = mesh(new T.CircleGeometry(12, 32), new T.MeshStandardMaterial({color: 0x2e2019, roughness: 1, transparent: true, opacity: .75, depthWrite: false}), 0, .08, 0, g);
  scar.rotation.x = -Math.PI / 2; scar.castShadow = false;
  for (let i = 0; i < 14; i++) {const d = mesh(new T.BoxGeometry(.3 + i % 3 * .2, .08, .4), i % 2 ? metal : white, Math.cos(i * 2.4) * (3 + i), .05, Math.sin(i * 2.4) * (3 + i), g); d.rotation.y = i;}
  return g;
}

function ingenuity() {
  const g = new T.Group();
  mesh(new T.BoxGeometry(.14, .14, .14), white, 0, .2, 0, g);
  for (const [i, y] of [[0, .38], [1, .44]]) {const blade = mesh(new T.BoxGeometry(1.2, .01, .08), dark, 0, y, 0, g); blade.rotation.y = i * 1.3;}
  mesh(new T.BoxGeometry(.4, .01, .25), solar, 0, .5, 0, g);
  for (let i = 0; i < 4; i++) mesh(new T.CylinderGeometry(.008, .008, .25, 4), metal, Math.cos(i * 1.57) * .12, .1, Math.sin(i * 1.57) * .12, g);
  return g;
}

export function createHardware(id: string): T.Group | null {
  switch (id) {
    case 'curiosity': return rover('large');
    case 'perseverance': {const g = rover('large'); const heli = ingenuity(); heli.position.set(9, 0, -6); g.add(heli); return g;}
    case 'spirit': case 'opportunity': return rover('mer');
    case 'zhurong': return rover('zhurong');
    case 'viking1': case 'viking2': return viking();
    case 'phoenix': return deckLander('phoenix');
    case 'insight': return deckLander('insight');
    case 'pathfinder': return petalLander('pathfinder');
    case 'beagle2': return petalLander('beagle2');
    case 'mars3': return petalLander('mars3');
    case 'schiaparelli-edm': return crashScar();
    default: return null;
  }
}
