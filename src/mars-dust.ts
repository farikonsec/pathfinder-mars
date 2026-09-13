import * as T from 'three';
import type {V} from './vector';

/**
 * Regolith kicked up by exhaust, touchdowns, crashes and low fast passes.
 * Particles live in a ground-fixed tangent frame (metres), so a cloud stays put while the ship flies away.
 */
const MAX = 2400;

export interface DustEmitter {
  /** Exhaust direction in the ground frame (unit), and its strength 0..1+. */
  dir: T.Vector3; power: number; reach: number;
}

function dustTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const k = c.getContext('2d')!, img = k.createImageData(128, 128);
  let seed = 7; const rand = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296;};
  const lumps = Array.from({length: 9}, () => [30 + rand() * 68, 30 + rand() * 68, 14 + rand() * 22]);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const r = Math.hypot(x - 64, y - 64) / 64;
    let a = Math.max(0, 1 - r) ** 1.6;
    let lump = 0; for (const [lx, ly, lr] of lumps) lump += Math.max(0, 1 - Math.hypot(x - lx, y - ly) / lr);
    a *= .45 + .55 * Math.min(1, lump);
    const i = (y * 128 + x) * 4, shade = 200 + 55 * Math.min(1, lump * .8) - 40 * r;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = shade; img.data[i + 3] = a * 255;
  }
  k.putImageData(img, 0, 0);
  const tex = new T.CanvasTexture(c); tex.colorSpace = T.NoColorSpace; return tex;
}

export class DustSystem {
  group = new T.Group();
  /** Ground frame: body-fixed origin (m) and axes; y is local up. */
  origin: V | null = null;
  axes = {east: new T.Vector3(1, 0, 0), up: new T.Vector3(0, 1, 0), north: new T.Vector3(0, 0, 1)};
  alive = 0;
  material: T.ShaderMaterial;
  private geometry: T.InstancedBufferGeometry;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private grow = new Float32Array(MAX);
  private spin = new Float32Array(MAX);
  private rot = new Float32Array(MAX);
  private opacity = new Float32Array(MAX);
  private offsetAttr: T.InstancedBufferAttribute;
  private dataAttr: T.InstancedBufferAttribute;
  private carry = 0;
  private seed = 99;
  wind = new T.Vector3(1.6, 0, .9);
  /** Ground marks: engine scorch and footpad prints, in the same ground frame. */
  decals: {x: number; y: number; z: number; size: number; strength: number; round: boolean}[] = [];
  private decalMesh: T.InstancedMesh;

  constructor() {
    const quad = new T.PlaneGeometry(1, 1);
    this.geometry = new T.InstancedBufferGeometry();
    this.geometry.index = quad.index; this.geometry.setAttribute('position', quad.getAttribute('position')); this.geometry.setAttribute('uv', quad.getAttribute('uv'));
    this.offsetAttr = new T.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(T.DynamicDrawUsage);
    this.dataAttr = new T.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(T.DynamicDrawUsage);
    this.geometry.setAttribute('offset', this.offsetAttr); this.geometry.setAttribute('data', this.dataAttr);
    this.geometry.instanceCount = 0;
    this.material = new T.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: {map: {value: dustTexture()}, lit: {value: new T.Color(.74, .55, .40)}, shade: {value: new T.Color(.30, .21, .16)}, fogColor: {value: new T.Color()}, fogDensity: {value: 0}, sunView: {value: new T.Vector3(0, 1, 0)}},
      vertexShader: `attribute vec3 offset; attribute vec4 data; varying vec2 vUv; varying float vAlpha; varying float vDepth; varying vec2 vCorner;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main(){
          vUv = uv; vAlpha = data.y;
          vec4 mv = modelViewMatrix * vec4(offset, 1.0);
          float c = cos(data.z), s = sin(data.z);
          vec2 corner = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
          vCorner = corner;
          mv.xy += corner * data.x;
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 lit; uniform vec3 shade; uniform vec3 fogColor; uniform float fogDensity; uniform vec3 sunView;
        varying vec2 vUv; varying float vAlpha; varying float vDepth; varying vec2 vCorner;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        void main(){
          #include <logdepthbuf_fragment>
          vec4 t = texture2D(map, vUv);
          float a = t.a * vAlpha;
          if (a < .004) discard;
          // Fake volume lighting: the half of the puff facing the Sun is brighter.
          float facing = clamp(.68 + .45 * dot(normalize(vec3(vCorner, .6)), sunView), 0., 1.);
          vec3 col = mix(shade, lit, facing * (.55 + .45 * t.r));
          float fog = 1. - exp(-fogDensity * fogDensity * vDepth * vDepth);
          gl_FragColor = vec4(mix(col, fogColor, fog), a);
        }`,
    });
    const mesh = new T.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false; mesh.renderOrder = 60;
    this.group.add(mesh);
    const mark = typeof document === 'undefined' ? null : (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128; const k = c.getContext('2d')!, g = k.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(0,0,0,.95)'); g.addColorStop(.45, 'rgba(0,0,0,.6)'); g.addColorStop(1, 'rgba(0,0,0,0)'); k.fillStyle = g; k.fillRect(0, 0, 128, 128);
      return new T.CanvasTexture(c);
    })();
    this.decalMesh = new T.InstancedMesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({map: mark, color: 0x1b1310, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6}), 96);
    this.decalMesh.count = 0; this.decalMesh.frustumCulled = false; this.decalMesh.renderOrder = 45; this.decalMesh.instanceColor = null;
    this.group.add(this.decalMesh);
  }

  private rand() {this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296;}

  /** Re-centre the ground frame. Existing particles are dropped when the ship has moved far away. */
  setOrigin(originBody: V) {
    this.origin = originBody;
    const up = new T.Vector3(...originBody).normalize(), pole = Math.abs(up.y) > .95 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0);
    this.axes.east.crossVectors(pole, up).normalize(); this.axes.north.crossVectors(up, this.axes.east); this.axes.up.copy(up);
    this.alive = 0; this.decals = [];
  }

  /** Darken the ground at (x, z), merging with a nearby mark. */
  mark(x: number, y: number, z: number, size: number, amount: number, round = true) {
    const near = this.decals.find(d => Math.hypot(d.x - x, d.z - z) < size * .5 && d.round === round);
    if (near) {near.strength = Math.min(.85, near.strength + amount); near.size = Math.max(near.size, size); return;}
    if (this.decals.length >= 96) this.decals.shift();
    this.decals.push({x, y, z, size, strength: Math.min(.85, amount), round});
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, opacity: number, grow: number) {
    if (this.alive >= MAX) return;
    const i = this.alive++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.size[i] = size; this.grow[i] = grow; this.life[i] = 0; this.maxLife[i] = life; this.opacity[i] = opacity;
    this.rot[i] = this.rand() * 6.28; this.spin[i] = (this.rand() - .5) * .6;
  }

  /** A radial blast of dust from ground point (x, z) at ground height y. */
  burst(x: number, y: number, z: number, count: number, speed: number, size: number, opacity = .7, life = 5) {
    for (let n = 0; n < count; n++) {
      const a = this.rand() * 6.28, s = speed * (.3 + .7 * this.rand());
      this.spawn(x + Math.cos(a) * size * .5, y + .5, z + Math.sin(a) * size * .5, Math.cos(a) * s, 1 + this.rand() * speed * .18, Math.sin(a) * s, size * (.5 + this.rand()), life * (.6 + .6 * this.rand()), opacity, size * .6);
    }
  }

  /**
   * shipLocal: ship position in the ground frame (m). groundY: ground height under the ship in that frame.
   * emitters: exhaust jets. lowPass: ground speed vector for a rooster tail when skimming.
   */
  update(dt: number, shipLocal: T.Vector3, groundAt: (x: number, z: number) => number, emitters: DustEmitter[], skim: {speed: number; agl: number; dir: T.Vector3} | null) {
    dt = Math.min(dt, .05);
    let rate = 0;
    const spawns: {x: number; y: number; z: number; out: T.Vector3; power: number}[] = [];
    for (const e of emitters) {
      if (e.power <= .01 || e.dir.y > -.08) continue;
      const g = groundAt(shipLocal.x, shipLocal.z), h = shipLocal.y - g, t = h / -e.dir.y;
      if (t <= 0 || t > e.reach) continue;
      const x = shipLocal.x + e.dir.x * t, z = shipLocal.z + e.dir.z * t, strength = e.power * (1 - t / e.reach) ** 1.5;
      const out = new T.Vector3(e.dir.x, 0, e.dir.z);
      spawns.push({x, y: groundAt(x, z), z, out, power: strength});
      if (strength > .35) this.mark(x, groundAt(x, z), z, 8 + 12 * Math.min(1, strength), strength * dt * .35);
      rate += strength;
    }
    this.carry += rate * 240 * dt;
    while (this.carry >= 1 && spawns.length) {
      this.carry -= 1;
      const s = spawns[Math.floor(this.rand() * spawns.length)];
      // Radial sheet, biased downstream of any horizontal exhaust component.
      const a = this.rand() * 6.28, dir = new T.Vector3(Math.cos(a), 0, Math.sin(a)).addScaledVector(s.out, 1.5).normalize();
      const speed = (10 + 34 * this.rand()) * (.35 + s.power);
      this.spawn(s.x + dir.x * 2, s.y + 1, s.z + dir.z * 2, dir.x * speed, 1.2 + this.rand() * 5 * s.power, dir.z * speed,
        2.4 + this.rand() * 3, 3 + this.rand() * 4 * (.5 + s.power), .34 + .38 * Math.min(1, s.power), 3.2 + 4 * s.power);
    }
    if (!spawns.length) this.carry = 0;
    if (skim && skim.agl < 28 && skim.speed > 35) {
      const k = (1 - skim.agl / 28) * Math.min(1, (skim.speed - 35) / 120);
      const n = Math.floor(k * 60 * dt + this.rand());
      for (let i = 0; i < n; i++) {
        const back = skim.dir.clone().multiplyScalar(-(4 + this.rand() * 18)), x = shipLocal.x + back.x + (this.rand() - .5) * 18, z = shipLocal.z + back.z + (this.rand() - .5) * 18;
        this.spawn(x, groundAt(x, z) + .3, z, skim.dir.x * skim.speed * .08, 1.5 + this.rand() * 3, skim.dir.z * skim.speed * .08, 3 + this.rand() * 4, 3 + this.rand() * 3, .32 * k + .08, 3.5);
      }
    }

    // Integrate: air drag, a little gravity for the heavy fraction, wind, growth and fade.
    const drag = Math.exp(-1.35 * dt);
    for (let i = 0; i < this.alive; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        const last = --this.alive;
        if (i !== last) {
          for (let k = 0; k < 3; k++) {this.pos[i * 3 + k] = this.pos[last * 3 + k]; this.vel[i * 3 + k] = this.vel[last * 3 + k];}
          this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last]; this.size[i] = this.size[last]; this.grow[i] = this.grow[last];
          this.rot[i] = this.rot[last]; this.spin[i] = this.spin[last]; this.opacity[i] = this.opacity[last];
          i--;
        }
        continue;
      }
      const j = i * 3;
      this.vel[j] = this.vel[j] * drag + this.wind.x * (1 - drag); this.vel[j + 2] = this.vel[j + 2] * drag + this.wind.z * (1 - drag);
      this.vel[j + 1] = this.vel[j + 1] * drag - .35 * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const floor = groundAt(this.pos[j], this.pos[j + 2]) + this.size[i] * .25;
      if (this.pos[j + 1] < floor) {this.pos[j + 1] = floor; this.vel[j + 1] = Math.abs(this.vel[j + 1]) * .2;}
      this.size[i] += this.grow[i] * dt * (1 - this.life[i] / this.maxLife[i]);
      this.rot[i] += this.spin[i] * dt;
    }

    // Upload in ground-frame axes: local = east·x + up·y + north·z.
    const {east, up, north} = this.axes, off = this.offsetAttr.array as Float32Array, data = this.dataAttr.array as Float32Array;
    for (let i = 0; i < this.alive; i++) {
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      off[i * 3] = east.x * x + up.x * y + north.x * z; off[i * 3 + 1] = east.y * x + up.y * y + north.y * z; off[i * 3 + 2] = east.z * x + up.z * y + north.z * z;
      const u = this.life[i] / this.maxLife[i], fade = Math.min(1, u * 6) * (1 - u) ** 1.4;
      data[i * 4] = this.size[i]; data[i * 4 + 1] = this.opacity[i] * fade; data[i * 4 + 2] = this.rot[i]; data[i * 4 + 3] = 0;
    }
    this.geometry.instanceCount = this.alive;
    const m = new T.Matrix4(), bx = new T.Vector3(), by = new T.Vector3(), bz = new T.Vector3();
    this.decals.forEach((d, i) => {
      bx.copy(east).multiplyScalar(d.size); by.copy(north).multiplyScalar(d.size * (d.round ? 1 : .55)); bz.copy(up);
      m.makeBasis(bx, by, bz).setPosition(east.x * d.x + up.x * (d.y + .05) + north.x * d.z, east.y * d.x + up.y * (d.y + .05) + north.y * d.z, east.z * d.x + up.z * (d.y + .05) + north.z * d.z);
      this.decalMesh.setMatrixAt(i, m);
    });
    this.decalMesh.count = this.decals.length; this.decalMesh.instanceMatrix.needsUpdate = true;
    (this.decalMesh.material as T.MeshBasicMaterial).opacity = this.decals.length ? Math.max(...this.decals.map(d => d.strength)) : 0;
    this.offsetAttr.needsUpdate = true; this.dataAttr.needsUpdate = true;
  }
}
