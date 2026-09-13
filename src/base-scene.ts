import * as T from 'three';
import type {V} from './vector';
import {publicAsset} from './assets';

/** World units: 1 unit = 1000 km. The ship sits at the origin and the universe moves around it. */
const SCALE = 1 / 1000;
const SKY_RADIUS = 450000;

function rng(seed = 1979) {return () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296;};}

/** Rough blackbody tint for a star temperature in kelvin (display colours, not photometry). */
function starColour(kelvin: number) {
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.7 * (t - 60) ** -.133;
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.1 : 288.1 * (t - 60) ** -.0755;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5 * Math.log(t - 10) - 305;
  return [r, g, b].map(x => Math.max(0, Math.min(255, x)) / 255);
}

/**
 * Renderer, sky, Sun, moons, labels, trajectory line and cockpit displays.
 * Destination scenes (Mars) extend this and own everything planet-specific.
 */
export class SpaceScene {
  renderer: T.WebGLRenderer;
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(64, 1, 1e-8, 1200000);
  cockpitScene = new T.Scene();
  cockpitCamera = new T.PerspectiveCamera(64, 1, .01, 20);
  cockpit = new T.Group();
  ship = new T.Group();
  planet = new T.Group();
  planetMap: T.Texture;
  moonMeshes: T.Mesh[] = [];
  labels: HTMLElement[] = [];
  line = new T.Line(new T.BufferGeometry(), new T.LineBasicMaterial({color: 0xffc46b, transparent: true, opacity: .75}));
  sun = new T.Mesh(new T.SphereGeometry(695700 * SCALE, 32, 24), new T.MeshBasicMaterial({color: 0xfff2d1}));
  light = new T.DirectionalLight(0xfff0db, 3.2);
  stars = new T.Group();
  private starLayers: T.Points[] = [];
  milkyWay: T.Points;
  starBoost = 1;
  mode = 0;
  trackedBody = -1;
  orbitAngle = 2.2;
  orbitPitch = .5;
  cameraZoom = 1;
  shipRadius = .25;
  shipFramed = false;
  cloudMapStatus = 'loading';
  renderErrors: string[] = [];
  onSteer: (dx: number, dy: number) => void = () => {};
  panelCanvas = document.createElement('canvas');
  panelTexture: T.CanvasTexture;
  sideDisplays: {canvas: HTMLCanvasElement; texture: T.CanvasTexture}[] = [];
  protected pointer: {x: number; y: number} | null = null;

  constructor(host: HTMLElement, texturePath: string, moonCount: number) {
    this.renderer = new T.WebGLRenderer({antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true, stencil: true});
    this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {this.renderErrors.push([gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].join(' / '));};
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x010205);
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    host.appendChild(this.renderer.domElement);
    this.scene.add(new T.AmbientLight(0x708598, .08), this.light, this.light.target, this.planet, this.sun, this.line, this.stars);

    this.planetMap = new T.TextureLoader().load(publicAsset(texturePath), () => {this.cloudMapStatus = 'Solar System Scope / NASA-derived · 8K';}, undefined, () => {this.cloudMapStatus = 'unavailable';});
    this.planetMap.colorSpace = T.SRGBColorSpace;
    this.planetMap.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
    this.planetMap.wrapS = T.RepeatWrapping;

    for (let i = 0; i < moonCount; i++) {
      const mesh = new T.Mesh(new T.SphereGeometry(.001, 16, 12), new T.MeshStandardMaterial({roughness: 1}));
      this.moonMeshes.push(mesh); this.scene.add(mesh);
      const el = document.createElement('div'); el.className = 'body-label'; el.style.display = 'none'; host.appendChild(el); this.labels.push(el);
    }

    // Star field: magnitude-weighted brightness and temperature colours, in three size classes.
    const random = rng();
    const classes = [{count: 7000, size: 1.1, mag: [4.5, 6.5]}, {count: 1400, size: 1.8, mag: [2.5, 4.5]}, {count: 160, size: 2.9, mag: [-1.4, 2.5]}];
    for (const cls of classes) {
      const pos: number[] = [], col: number[] = [];
      for (let i = 0; i < cls.count; i++) {
        const z = random() * 2 - 1, a = random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
        pos.push(r * Math.cos(a) * SKY_RADIUS, z * SKY_RADIUS, r * Math.sin(a) * SKY_RADIUS);
        const mag = cls.mag[0] + (cls.mag[1] - cls.mag[0]) * Math.sqrt(random());
        const brightness = Math.min(1.25, 2.512 ** (cls.mag[0] - mag) * (cls.size > 2 ? 1.2 : .95));
        const kelvin = 3200 + 9000 * random() ** 1.8;
        col.push(...starColour(kelvin).map(c => c * brightness));
      }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      const points = new T.Points(g, new T.PointsMaterial({size: cls.size, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false}));
      this.starLayers.push(points); this.stars.add(points);
    }
    // Milky Way: dense, faint band with a brighter bulge, tilted against the Mars equator.
    const mw: number[] = [], mwc: number[] = [];
    for (let i = 0; i < 42000; i++) {
      const a = random() * Math.PI * 2, bulge = Math.exp(-(((a - 4.6 + Math.PI) % (Math.PI * 2) - Math.PI) ** 2) / .6);
      const spread = .045 + .09 * bulge, lat = (random() + random() + random() - 1.5) * spread;
      const c = Math.cos(lat);
      mw.push(Math.cos(a) * c * SKY_RADIUS * .98, Math.sin(lat) * SKY_RADIUS * .98, Math.sin(a) * c * SKY_RADIUS * .98);
      const k = .08 + .22 * bulge * random() + .05 * random();
      mwc.push(k * 1.0, k * .93, k * .82);
    }
    const mg = new T.BufferGeometry(); mg.setAttribute('position', new T.Float32BufferAttribute(mw, 3)); mg.setAttribute('color', new T.Float32BufferAttribute(mwc, 3));
    this.milkyWay = new T.Points(mg, new T.PointsMaterial({size: 1.4, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false}));
    this.milkyWay.rotation.set(1.05, .4, .2);
    this.stars.add(this.milkyWay);
    this.line.frustumCulled = false;

    this.panelCanvas.width = 768; this.panelCanvas.height = 256;
    this.panelTexture = new T.CanvasTexture(this.panelCanvas); this.panelTexture.colorSpace = T.SRGBColorSpace;
    for (let i = 0; i < 2; i++) {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 160;
      const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
      this.sideDisplays.push({canvas, texture});
    }

    const canvas = this.renderer.domElement;
    canvas.addEventListener('wheel', e => {if (this.mode === 0 || this.mode === 3) return; e.preventDefault(); this.cameraZoom = T.MathUtils.clamp(this.cameraZoom * Math.exp(e.deltaY * .001), .6, 4);}, {passive: false});
    canvas.addEventListener('pointerdown', e => {if (e.button !== 0 || this.mode === 3) return; this.pointer = {x: e.clientX, y: e.clientY}; canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove', e => {
      if (!this.pointer) return;
      const dx = e.clientX - this.pointer.x, dy = e.clientY - this.pointer.y;
      if (this.mode === 2 || this.mode === 8) {this.orbitAngle -= dx * .008; this.orbitPitch = T.MathUtils.clamp(this.orbitPitch + dy * .005, -1.15, 1.15);} else this.onSteer(dx, dy);
      this.pointer = {x: e.clientX, y: e.clientY};
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) canvas.addEventListener(type, () => this.pointer = null);
    addEventListener('blur', () => this.pointer = null);
    addEventListener('resize', () => this.resize()); this.resize();
  }

  /** Overall star visibility, 0..1, before the user's star boost. */
  setStarVisibility(v: number) {
    const k = Math.max(0, Math.min(1.6, v * this.starBoost));
    this.starLayers.forEach(p => {(p.material as T.PointsMaterial).opacity = Math.min(1, k); p.visible = k > .01;});
    (this.milkyWay.material as T.PointsMaterial).opacity = Math.min(1, k * (this.starBoost > 1 ? 1 : .75));
    this.milkyWay.visible = k > .01;
  }

  resize() {
    this.camera.aspect = this.cockpitCamera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix(); this.cockpitCamera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight);
  }

  trajectory(points: V[]) {
    this.line.geometry.dispose();
    this.line.geometry = new T.BufferGeometry().setFromPoints(points.map(p => new T.Vector3(...p).multiplyScalar(SCALE)));
  }
}
