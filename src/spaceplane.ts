import * as T from 'three';
import {drawStencil} from './rahimli-font';

/**
 * PATHFINDER MSV-01: a 38 m blended-wing Mars spaceplane, authored in metres, nose toward -Z.
 * Everything is procedural so it ships without third-party assets.
 */
export const SHIP_LENGTH = 38;

function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, srgb = true) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new T.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = T.SRGBColorSpace;
  tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.anisotropy = 8;
  return tex;
}
function rng(seed: number) {return () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296;};}

function hullTextures() {
  const r = rng(9);
  const ceramic = canvasTexture(1024, 1024, c => {
    c.fillStyle = '#e9e6df'; c.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 90; i++) {c.fillStyle = `rgba(${150 + r() * 60},${145 + r() * 55},${140 + r() * 50},${.05 + r() * .09})`; c.fillRect(Math.floor(r() * 16) * 64, Math.floor(r() * 16) * 64, 64 * (1 + Math.floor(r() * 3)), 64 * (1 + Math.floor(r() * 2)));}
    c.strokeStyle = 'rgba(70,72,76,.55)'; c.lineWidth = 2;
    for (let x = 0; x <= 1024; x += 128) {c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 1024); c.stroke();}
    for (let y = 0; y <= 1024; y += 96) {c.beginPath(); c.moveTo(0, y); c.lineTo(1024, y); c.stroke();}
    c.strokeStyle = 'rgba(70,72,76,.25)'; c.lineWidth = 1;
    for (let x = 64; x < 1024; x += 128) {c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 1024); c.stroke();}
    c.fillStyle = 'rgba(60,60,60,.5)';
    for (let x = 6; x < 1024; x += 128) for (let y = 6; y < 1024; y += 96) {c.fillRect(x, y, 3, 3); c.fillRect(x + 114, y, 3, 3);}
    // Streaks from dust and exhaust.
    for (let i = 0; i < 40; i++) {const g = c.createLinearGradient(0, 0, 0, 200); g.addColorStop(0, 'rgba(120,90,70,.12)'); g.addColorStop(1, 'rgba(120,90,70,0)'); c.fillStyle = g; c.fillRect(r() * 1024, r() * 1024, 4 + r() * 20, 200);}
  });
  const tiles = canvasTexture(1024, 1024, c => {
    c.fillStyle = '#16171a'; c.fillRect(0, 0, 1024, 1024);
    for (let y = 0; y < 1024; y += 40) for (let x = (y / 40) % 2 ? 20 : 0; x < 1024; x += 40) {
      const v = 22 + r() * 22; c.fillStyle = `rgb(${v},${v - 1},${v - 2})`; c.fillRect(x + 1.5, y + 1.5, 37, 37);
    }
    for (let i = 0; i < 70; i++) {c.fillStyle = `rgba(200,190,170,${.03 + r() * .05})`; c.fillRect(Math.floor(r() * 25) * 40, Math.floor(r() * 25) * 40, 40, 40);}
  });
  const rough = canvasTexture(512, 512, c => {
    c.fillStyle = '#9a9a9a'; c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 600; i++) {const v = 110 + r() * 110; c.fillStyle = `rgba(${v},${v},${v},.25)`; c.beginPath(); c.arc(r() * 512, r() * 512, 2 + r() * 14, 0, 7); c.fill();}
  }, false);
  return {ceramic, tiles, rough};
}

/** Hull lettering in the RAHIMLI STENCIL face. */
function decal(text: string, sub: string, w = 1024, h = 256) {
  return canvasTexture(w, h, c => {
    c.clearRect(0, 0, w, h);
    drawStencil(c, text, 24, h * .1, {size: h * .5, weight: 1, tracking: 1.3, color: 'rgba(28,32,38,.94)'});
    c.fillStyle = '#c4492f'; c.fillRect(24, h * .74, w * .24, h * .07);
    drawStencil(c, sub, 24 + w * .27, h * .68, {size: h * .19, weight: 1.05, tracking: 1.6, color: 'rgba(28,32,38,.9)'});
  });
}

// ------------------------------------------------------------------ geometry helpers

/** Loft closed cross-sections (arrays of Vector3 rings) into a smooth skin; group 0 top, group 1 belly. */
function loft(rings: T.Vector3[][], uScale: number, vScale: number, bellyTest?: (p: T.Vector3, i: number, j: number) => boolean) {
  const M = rings[0].length, pos: number[] = [], uv: number[] = [];
  rings.forEach((ring, i) => ring.forEach((p, j) => {pos.push(p.x, p.y, p.z); uv.push(j / M * uScale, p.z / vScale);}));
  const top: number[] = [], belly: number[] = [];
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < M; j++) {
    const a = i * M + j, b = i * M + (j + 1) % M, c = a + M, d = b + M;
    const target = bellyTest && bellyTest(rings[i][j], i, j) ? belly : top;
    target.push(a, b, c, b, d, c);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex([...top, ...belly]);
  g.addGroup(0, top.length, 0); g.addGroup(top.length, belly.length, 1);
  g.computeVertexNormals();
  return g;
}

function superellipse(w: number, top: number, bottom: number, yc: number, z: number, M: number, eTop = 2.4, eBottom = 4.2) {
  const ring: T.Vector3[] = [];
  for (let j = 0; j < M; j++) {
    const a = j / M * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), e = s >= 0 ? eTop : eBottom;
    ring.push(new T.Vector3(w * Math.sign(c) * Math.abs(c) ** (2 / e), yc + (s >= 0 ? top : bottom) * Math.sign(s) * Math.abs(s) ** (2 / e), z));
  }
  return ring;
}

const smooth = (a: number, b: number, x: number) => {const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t);};
const ogive = (t: number) => Math.sqrt(Math.max(0, 1 - (1 - Math.min(1, t)) ** 2));

export function fuselageShape(z: number) {
  const t = (z + 19) / 38;
  const nose = ogive(t / .34);
  const w = 3.35 * nose + .95 * smooth(.34, .62, t) - .35 * smooth(.9, 1, t);
  const top = 1.95 * ogive(t / .3) + .7 * Math.exp(-(((t - .235) / .055) ** 2)) + .25 * smooth(.3, .55, t) - .55 * smooth(.7, 1, t);
  const bottom = 1.45 * ogive(t / .22);
  const yc = -.55 * (1 - Math.min(1, t / .3)) ** 2;
  return {w: Math.max(.02, w), top: Math.max(.02, top), bottom: Math.max(.02, bottom), yc};
}

function airfoilWing(root: {x: number; y: number; lead: number; trail: number; thick: number}, tip: {x: number; y: number; lead: number; trail: number; thick: number}, spans = 14, chord = 22) {
  const rings: T.Vector3[][] = [];
  for (let s = 0; s <= spans; s++) {
    const k = s / spans, lerp = (a: number, b: number) => a + (b - a) * k;
    const x = lerp(root.x, tip.x), y = lerp(root.y, tip.y), lead = lerp(root.lead, tip.lead), trail = lerp(root.trail, tip.trail), thick = lerp(root.thick, tip.thick);
    const c = trail - lead, ring: T.Vector3[] = [];
    const section = (u: number) => 5 * (thick / c) * (.2969 * Math.sqrt(u) - .126 * u - .3516 * u * u + .2843 * u ** 3 - .1036 * u ** 4) * c;
    for (let i = 0; i < chord; i++) {const u = (1 - Math.cos(Math.PI * i / chord)) / 2; ring.push(new T.Vector3(x, y + section(u), lead + u * c));}
    for (let i = chord; i > 0; i--) {const u = (1 - Math.cos(Math.PI * i / chord)) / 2; ring.push(new T.Vector3(x, y - section(u), lead + u * c));}
    rings.push(ring);
  }
  return rings;
}

function plumeMaterial(color: T.Color, core: T.Color) {
  return new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
    uniforms: {power: {value: 0}, time: {value: 0}, expansion: {value: 1}, color: {value: color}, core: {value: core}},
    vertexShader: `uniform float expansion; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main(){ vUv=uv; vec3 p=position; float along=1.-uv.y; p.xz*=1.+along*along*(expansion-1.);
        vec4 mv=modelViewMatrix*vec4(p,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv;
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `uniform float power; uniform float time; uniform vec3 color; uniform vec3 core; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main(){
      #include <logdepthbuf_fragment>
        float along=1.-vUv.y;
        // Side-on the centre line is brightest; the open far end fades out so no bright end discs appear.
        float rim=abs(dot(vN,vV));
        float body=pow(rim,1.6)*pow(1.-along,1.6)*smoothstep(0.,.08,along);
        float diamonds=.8+.2*sin(along*30.-time*6.)*(1.-along);
        float flicker=.9+.1*sin(time*57.);
        vec3 c=mix(color,core,pow(rim,6.)*(1.-along));
        float a=body*diamonds*flicker*power;
        gl_FragColor=vec4(c*a*1.6,a);
      }`
  });
}

let glowMap: T.Texture | null = null;
function glowTexture() {
  if (glowMap || typeof document === 'undefined') return glowMap;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const k = c.getContext('2d')!, g = k.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.18, 'rgba(235,240,255,.85)'); g.addColorStop(.45, 'rgba(160,185,255,.28)'); g.addColorStop(1, 'rgba(120,140,255,0)');
  k.fillStyle = g; k.fillRect(0, 0, 128, 128);
  return glowMap = new T.CanvasTexture(c);
}

export interface ShipControls {torch?: boolean; throttle: number; hover: number; pitch: number; roll: number; gear: number; heat: number; flow: T.Vector3 | null; time: number; ambient: number;}

export function createSpaceplane() {
  const ship = new T.Group(); ship.name = 'PATHFINDER MSV-01';
  const {ceramic, tiles, rough} = hullTextures();
  const white = new T.MeshStandardMaterial({color: 0xffffff, map: ceramic, roughnessMap: rough, roughness: .55, metalness: .05, envMapIntensity: .8});
  const black = new T.MeshStandardMaterial({color: 0xffffff, map: tiles, roughness: .9, metalness: 0, envMapIntensity: .3});
  const carbon = new T.MeshStandardMaterial({color: 0x2b2d31, roughness: .45, metalness: .3});
  const metal = new T.MeshStandardMaterial({color: 0x8d9197, roughness: .32, metalness: .9});
  const darkMetal = new T.MeshStandardMaterial({color: 0x3c3f44, roughness: .4, metalness: .85});
  const gold = new T.MeshStandardMaterial({color: 0xc9953c, roughness: .28, metalness: 1, emissive: 0x3a2500, emissiveIntensity: .15});
  const glass = new T.MeshPhysicalMaterial({color: 0x0b1116, roughness: .06, metalness: .2, clearcoat: 1, clearcoatRoughness: .03, envMapIntensity: 1.8, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2});
  const orange = new T.MeshStandardMaterial({color: 0xc4492f, roughness: .6});
  const add = (name: string, geometry: T.BufferGeometry, material: T.Material | T.Material[], parent: T.Object3D = ship) => {const m = new T.Mesh(geometry, material); m.name = name; m.castShadow = m.receiveShadow = true; parent.add(m); return m;};

  // --- Fuselage
  const M = 56, rings: T.Vector3[][] = [];
  for (let i = 0; i <= 84; i++) {
    const t = (1 - Math.cos(Math.PI * i / 84)) / 2, z = -19 + t * 37.2, s = fuselageShape(z);
    rings.push(superellipse(s.w, s.top, s.bottom, s.yc, z, M));
  }
  add('fuselage', loft(rings, 3, 5.5, p => p.y < fuselageShape(p.z).yc - .15), [white, black]);
  const tail = rings[rings.length - 1], tailCap = new T.Shape(tail.map(p => new T.Vector2(p.x, p.y)));
  add('aft bulkhead', new T.ShapeGeometry(tailCap), darkMetal).position.z = 18.2;

  // --- Canopy glazing: a slightly proud copy of the hull skin over the crew deck
  const canopyRings: T.Vector3[][] = [];
  for (let i = 0; i <= 18; i++) {
    const z = -12.6 + i * .42, s = fuselageShape(z), ring: T.Vector3[] = [];
    for (let j = 0; j <= 16; j++) {
      const a = Math.PI * (.2 + .6 * j / 16), c = Math.cos(a), sn = Math.sin(a);
      ring.push(new T.Vector3(s.w * 1.012 * Math.sign(c) * Math.abs(c) ** (2 / 2.4), s.yc + s.top * Math.abs(sn) ** (2 / 2.4) + .09, z));
    }
    canopyRings.push(ring);
  }
  const cg = new T.BufferGeometry(), cp: number[] = [], ci: number[] = [];
  canopyRings.forEach(r => r.forEach(p => cp.push(p.x, p.y, p.z)));
  for (let i = 0; i < 18; i++) for (let j = 0; j < 16; j++) {const a = i * 17 + j, b = a + 1, c = a + 17, d = c + 1; ci.push(a, c, b, b, c, d);}
  cg.setAttribute('position', new T.Float32BufferAttribute(cp, 3)); cg.setIndex(ci); cg.computeVertexNormals();
  add('canopy', cg, glass);
  for (const zf of [-12.6, -10.4, -8.2, -5.05]) {
    const s = fuselageShape(zf), pts: T.Vector3[] = [];
    for (let j = 0; j <= 16; j++) {const a = Math.PI * (.19 + .62 * j / 16), c = Math.cos(a); pts.push(new T.Vector3(s.w * Math.sign(c) * Math.abs(c) ** (2 / 2.4), s.yc + s.top * Math.abs(Math.sin(a)) ** (2 / 2.4) + .07, zf));}
    add('canopy frame', new T.TubeGeometry(new T.CatmullRomCurve3(pts), 24, .07, 6), carbon);
  }
  for (const x of [-.02]) {
    const pts: T.Vector3[] = []; for (let i = 0; i <= 12; i++) {const z = -12.6 + i * .63, s = fuselageShape(z); pts.push(new T.Vector3(x, s.yc + s.top + .08, z));}
    add('canopy spine', new T.TubeGeometry(new T.CatmullRomCurve3(pts), 24, .08, 6), carbon);
  }

  // --- Wings, winglets, canards
  const moving: {elevons: T.Object3D[]; canards: T.Object3D[]; legs: {pivot: T.Object3D; strut: T.Object3D; side: number; nose: boolean}[]; doors: {mesh: T.Object3D; side: number}[]} = {elevons: [], canards: [], legs: [], doors: []};
  for (const side of [-1, 1]) {
    const wing = airfoilWing({x: 2.8 * side, y: -.55, lead: -4.5, trail: 16.2, thick: 1.05}, {x: 14.2 * side, y: .25, lead: 10.8, trail: 15.4, thick: .22});
    const chord = 22;
    add('wing', loft(side < 0 ? wing.map(r => [...r].reverse()) : wing, 2, 6, (_p, _i, j) => (side < 0 ? 2 * chord - 1 - j : j) >= chord), [white, black]);
    // Reinforced carbon leading edge
    const le: T.Vector3[] = []; for (let s = 0; s <= 14; s++) le.push(wing[s][0].clone());
    add('leading edge', new T.TubeGeometry(new T.CatmullRomCurve3(le), 32, .16, 8), carbon);
    // Elevons hinge on the trailing edge
    const hinge = new T.Group(); hinge.position.set(side * 8.6, -.28, 15.9); ship.add(hinge);
    const elevon = add('elevon', new T.BoxGeometry(8.6, .16, 1.5), white, hinge); elevon.position.z = .75; elevon.rotation.z = side * -.07;
    hinge.userData.side = side; moving.elevons.push(hinge);
    // Winglet
    const fin = airfoilWing({x: 0, y: 0, lead: 0, trail: 4.6, thick: .3}, {x: 4.4, y: 0, lead: 3.1, trail: 5.4, thick: .12}, 6, 14);
    const finGroup = new T.Group(); finGroup.position.set(side * 14.1, .2, 10.8); finGroup.rotation.z = -side * .32; ship.add(finGroup);
    const finMaterial = white.clone(); finMaterial.side = T.DoubleSide;
    add('winglet', loft(fin.map(r => r.map(p => new T.Vector3(p.y, p.x, p.z))), 1, 4), finMaterial, finGroup);
    add('winglet stripe', new T.BoxGeometry(.3, .45, 3.6), orange, finGroup).position.set(0, 1.5, 2.9);
    const light = new T.Mesh(new T.SphereGeometry(.14, 12, 8), new T.MeshBasicMaterial({color: side < 0 ? 0xff2a2a : 0x2aff6a}));
    light.position.set(0, 4.35, 4.8); light.name = side < 0 ? 'nav port' : 'nav starboard'; finGroup.add(light);
    // Canards
    const pivot = new T.Group(); pivot.position.set(side * 2.9, .25, -9.5); ship.add(pivot);
    const canard = airfoilWing({x: 0, y: 0, lead: -1.1, trail: 1.5, thick: .22}, {x: 3.8 * side, y: .35, lead: .4, trail: 1.5, thick: .08}, 5, 12);
    add('canard', loft(side < 0 ? canard.map(r => [...r].reverse()) : canard, 1, 2), white, pivot);
    moving.canards.push(pivot);
    // Wing root fairing strakes
    const strake = add('chine strake', new T.BoxGeometry(.18, .3, 11), carbon); strake.position.set(side * 3.25, -.25, -9); strake.rotation.y = side * -.07;
    // RCS quads
    for (const [z, y] of [[-14.2, .3], [13.5, 1.4]]) {
      const s = fuselageShape(z), block = add('rcs quad', new T.BoxGeometry(.45, .7, .9), darkMetal); block.position.set(side * (s.w * .96), y, z);
      for (const dy of [-.2, .2]) {const n = add('rcs nozzle', new T.CylinderGeometry(.08, .12, .22, 10, 1, true), metal); n.rotation.z = Math.PI / 2; n.position.set(side * (s.w * .96 + .3), y + dy, z);}
      const chevron = add('hazard chevron', new T.PlaneGeometry(1.4, .22), orange); chevron.position.set(side * (s.w * .97 + .02), y + .6, z); chevron.rotation.y = side * Math.PI / 2;
    }
  }
  const wingText = new T.MeshStandardMaterial({map: decal('PATHFINDER', 'MSV-01 · MARS'), transparent: true, roughness: .6, polygonOffset: true, polygonOffsetFactor: -4});
  const flankText = new T.MeshStandardMaterial({map: decal('RAHIMLI', 'EXPEDITION · 01', 1024, 256), transparent: true, roughness: .6, polygonOffset: true, polygonOffsetFactor: -4, side: T.DoubleSide});
  for (const side of [-1, 1]) {
    const s0 = fuselageShape(1.5), flank = add('flank marking', new T.PlaneGeometry(9, 2.25), flankText);
    flank.position.set(side * (s0.w + .04), s0.yc + .35, 1.5); flank.rotation.y = side * Math.PI / 2; flank.castShadow = false;
  }
  for (const side of [-1, 1]) {const plate = add('wing marking', new T.PlaneGeometry(8, 2), wingText); plate.rotation.set(-Math.PI / 2, 0, side < 0 ? Math.PI / 2 : -Math.PI / 2); plate.position.set(side * 8.4, .22, 9.4); plate.castShadow = false;}

  // --- Dorsal: radiator panels, dish, sensor mast, docking port
  for (const side of [-1, 1]) {
    const panel = add('radiator', new T.BoxGeometry(2.4, .08, 12), new T.MeshStandardMaterial({color: 0xd9dde2, roughness: .25, metalness: .6, map: canvasTexture(64, 256, c => {c.fillStyle = '#dde1e5'; c.fillRect(0, 0, 64, 256); c.fillStyle = '#9ba2a9'; for (let y = 0; y < 256; y += 8) c.fillRect(0, y, 64, 2);})}));
    panel.position.set(side * 1.45, 2.05, 6); panel.rotation.z = side * -.18;
  }
  const dish = add('high gain antenna', new T.SphereGeometry(1.1, 24, 10, 0, Math.PI * 2, 0, 1.1), new T.MeshStandardMaterial({color: 0xe4e2dc, roughness: .5, side: T.DoubleSide}));
  dish.position.set(0, 2.9, 13.5); dish.rotation.x = -1.1;
  add('dish mast', new T.CylinderGeometry(.08, .1, 1.2, 8), metal).position.set(0, 2.2, 13.5);
  add('docking collar', new T.CylinderGeometry(1, 1, .35, 28), darkMetal).position.set(0, 2.5, -1.5);
  add('docking ring', new T.TorusGeometry(.95, .08, 8, 28), gold).rotation.x = Math.PI / 2;
  ship.children[ship.children.length - 1].position.set(0, 2.7, -1.5);
  const mast = add('sensor mast', new T.CylinderGeometry(.05, .07, 1.6, 8), metal); mast.position.set(.9, 2.6, -4.2); mast.rotation.z = -.2;
  const strobe = new T.Mesh(new T.SphereGeometry(.12, 10, 8), new T.MeshBasicMaterial({color: 0xffffff})); strobe.position.set(0, 3.35, 13.5); strobe.name = 'strobe'; ship.add(strobe);

  // --- Aft engine block and three main bells
  const block = add('thrust structure', new T.BoxGeometry(6.6, 2.7, 2.6), darkMetal); block.position.set(0, .1, 19.3);
  for (let i = 0; i < 10; i++) {const rib = add('thrust rib', new T.BoxGeometry(.12, 2.8, 2.5), metal); rib.position.set(-3 + i * .66, .1, 19.3);}
  const bellProfile = (rt: number, re: number, length: number) => {const pts: T.Vector2[] = []; for (let i = 0; i <= 20; i++) {const u = i / 20; pts.push(new T.Vector2(rt + (re - rt) * Math.sqrt(u) * (1 - .15 * (1 - u)), u * length));} return pts;};
  const bellMaterial = new T.MeshStandardMaterial({color: 0x5b5a58, roughness: .45, metalness: .9, side: T.DoubleSide, emissive: new T.Color(0x9a3a12), emissiveIntensity: 0});
  const plumes: T.Mesh[] = [], glows: T.Sprite[] = [];
  const plumeMat = plumeMaterial(new T.Color(.35, .5, 1.0), new T.Color(1, .95, .9));
  for (const [x, y, re, len] of [[0, .55, 1.45, 3.2], [-2.35, -.35, 1.1, 2.6], [2.35, -.35, 1.1, 2.6]]) {
    const bell = add('engine bell', new T.LatheGeometry(bellProfile(re * .38, re, len), 40), bellMaterial); bell.rotation.x = Math.PI / 2; bell.position.set(x, y, 20.5);
    const throat = new T.Mesh(new T.CircleGeometry(re * .75, 24), new T.MeshBasicMaterial({color: 0x9fc4ff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide})); throat.position.set(x, y, 20.5 + len * .6); throat.rotation.y = Math.PI; throat.name = 'throat'; ship.add(throat);
    add('gimbal ring', new T.TorusGeometry(re * .42, .09, 8, 24), gold).position.set(x, y, 20.5);
    const plume = new T.Mesh(new T.CylinderGeometry(re * .1, re * .9, 26, 32, 12, true), plumeMat); plume.rotation.x = -Math.PI / 2; plume.position.set(x, y, 20.5 + len + 13); plume.name = 'plume'; plume.userData.len = len; plume.visible = false; ship.add(plume); plumes.push(plume);
    // Camera-facing glow at the nozzle exit: the part of the exhaust you see when looking straight up the plume.
    const glow = new T.Sprite(new T.SpriteMaterial({map: glowTexture(), color: 0x7f9dff, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0}));
    glow.name = 'exhaust glow'; glow.position.set(x, y, 20.5 + len + .6); glow.userData.re = re; glow.visible = false; ship.add(glow); glows.push(glow);
  }
  const hoverMat = plumeMaterial(new T.Color(.45, .55, 1), new T.Color(1, .98, .95));
  const hoverPlumes: T.Mesh[] = [];
  for (const [x, z] of [[-1.6, -10.5], [1.6, -10.5], [-3.4, 9], [3.4, 9]]) {
    const s = fuselageShape(z), y = s.yc - s.bottom + .05;
    const grille = add('hover jet', new T.CylinderGeometry(.7, .7, .2, 20), darkMetal); grille.position.set(x, y, z);
    const plume = new T.Mesh(new T.CylinderGeometry(.08, .75, 9, 20, 6, true), hoverMat); plume.position.set(x, y - 4.6, z); plume.visible = false; plume.name = 'hover plume'; ship.add(plume); hoverPlumes.push(plume);
  }

  // --- Landing gear: nose leg and two main legs that swing out of belly bays
  const legSpecs = [{x: 0, z: -11, nose: true}, {x: -3.2, z: 5, nose: false}, {x: 3.2, z: 5, nose: false}];
  for (const spec of legSpecs) {
    const s = fuselageShape(spec.z), belly = s.yc - s.bottom * .96;
    const pivot = new T.Group(); pivot.position.set(spec.x * (spec.nose ? 1 : .9), belly + .2, spec.z); ship.add(pivot);
    const strut = new T.Group(); pivot.add(strut);
    const reach = -(belly + .2) + 3.4 - .25;
    const upper = add('gear strut', new T.CylinderGeometry(.17, .2, reach * .6, 12), metal, strut); upper.position.y = -reach * .3;
    const lower = add('gear piston', new T.CylinderGeometry(.11, .11, reach * .5, 10), new T.MeshStandardMaterial({color: 0xd8dce0, metalness: 1, roughness: .15}), strut); lower.position.y = -reach * .72;
    const pad = add('footpad', new T.CylinderGeometry(.55, .7, .2, 20), darkMetal, strut); pad.position.y = -reach + .1;
    const brace = add('gear brace', new T.CylinderGeometry(.06, .06, reach * .55, 8), carbon, strut); brace.position.set(0, -reach * .35, .45); brace.rotation.x = .35;
    moving.legs.push({pivot, strut, side: Math.sign(spec.x), nose: spec.nose});
    for (const d of [-1, 1]) {
      const door = add('gear door', new T.BoxGeometry(.9, .06, 2.4), black); door.position.set(spec.x * (spec.nose ? 1 : .9) + d * .5, belly + .02, spec.z);
      moving.doors.push({mesh: door, side: d});
    }
  }

  // --- Entry plasma sheath
  const sheathProfile = Array.from({length: 24}, (_, i) => {const u = i / 23; return new T.Vector2(Math.sqrt(u) * 1.0 + .001, u * 1.6 - .25);});
  const sheath = new T.Mesh(new T.LatheGeometry(sheathProfile, 48), new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
    uniforms: {intensity: {value: 0}, time: {value: 0}},
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main(){vP=position; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv;
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `uniform float intensity; uniform float time; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main(){
      #include <logdepthbuf_fragment>
        float along=clamp((vP.y+.25)/1.6,0.,1.);
        float fres=pow(1.-abs(dot(vN,vV)),1.2);
        float angle=atan(vP.z,vP.x);
        float streak=.55+.45*sin(angle*14.+time*9.+along*6.)*sin(angle*5.-time*4.);
        vec3 c=mix(vec3(1.,.82,.95),vec3(1.,.36,.1),along);
        float a=intensity*1.8*(1.-along)*(.35+fres*.9)*streak;
        gl_FragColor=vec4(c*a,a);
      }`
  }));
  sheath.name = 'plasma'; sheath.visible = false; ship.add(sheath);

  ship.userData.update = (c: ShipControls) => {
    for (const hinge of moving.elevons) hinge.rotation.x = T.MathUtils.clamp(-c.pitch * .35 + c.roll * .3 * hinge.userData.side, -.45, .45);
    for (const pivot of moving.canards) pivot.rotation.x = T.MathUtils.clamp(c.pitch * .3, -.35, .35);
    const g = T.MathUtils.smoothstep(c.gear, 0, 1), doors = T.MathUtils.smoothstep(c.gear, 0, .35), legs = T.MathUtils.smoothstep(c.gear, .25, 1);
    for (const door of moving.doors) door.mesh.rotation.z = door.side * doors * 1.35;
    for (const leg of moving.legs) {
      leg.pivot.rotation.x = (1 - legs) * (leg.nose ? -Math.PI / 2 : Math.PI / 2);
      leg.pivot.rotation.z = leg.nose ? 0 : leg.side * -.12 * legs;
      leg.strut.visible = g > .02;
    }
    const uniforms = (m: T.Mesh) => (m.material as T.ShaderMaterial).uniforms as Record<string, T.IUniform> | undefined;
    for (const p of plumes) {p.visible = c.throttle > .01; const u = uniforms(p); if (u) {u.power.value = c.throttle * (c.torch ? 1.8 : 1); u.time.value = c.time; u.expansion.value = 1 + 2.5 * (1 - c.ambient); (u.color.value as T.Color).set(c.torch ? 0x9a70ff : 0x5980ff);} p.scale.set(c.torch ? 1.35 : 1, (.4 + .6 * c.throttle) * (c.torch ? 3.2 : 1), c.torch ? 1.35 : 1); p.position.z = 20.5 + (p.userData.len ?? 3) + 13 * p.scale.y;}
    for (const g of glows) {
      g.visible = c.throttle > .01;
      const k = c.torch ? 1 : .55 + .45 * (1 - c.ambient), m = g.material as T.SpriteMaterial;
      m.opacity = Math.min(1, c.throttle * (c.torch ? 1.2 : .8)) * k; m.color.set(c.torch ? 0xa98cff : 0x7f9dff);
      g.scale.setScalar(g.userData.re * (c.torch ? 7 : 3.2) * (.6 + .4 * c.throttle));
    }
    bellMaterial.emissiveIntensity = c.throttle * (c.torch ? .9 : .18);
    ship.children.forEach(o => {if (o.name === 'throat') {o.visible = c.throttle > .02; ((o as T.Mesh).material as T.MeshBasicMaterial).opacity = c.throttle;}});
    for (const p of hoverPlumes) {p.visible = c.hover > .02; const u = uniforms(p); if (u) {u.power.value = c.hover; u.time.value = c.time;}}
    strobe.visible = (c.time % 1.4) < .08;
    const port = ship.getObjectByName('nav port')!, star = ship.getObjectByName('nav starboard')!;
    port.visible = star.visible = (c.time % 2) < 1.6;
    sheath.visible = c.heat > .02 && !!c.flow;
    const su = uniforms(sheath);
    if (sheath.visible && c.flow && su) {
      su.intensity.value = Math.min(1.4, c.heat);
      su.time.value = c.time;
      // Flow is expressed in ship-local axes; stretch the sheath downstream.
      // Lathe axis +Y points downstream; the cup's nose sits just ahead of the hull in the travel direction.
      const travel = c.flow.clone().normalize();
      sheath.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), travel.clone().negate());
      sheath.scale.set(15, 28, 15); sheath.position.copy(travel.multiplyScalar(-1.5));
    }
  };
  return ship;
}
