import * as T from 'three';
import {SpaceScene} from './base-scene';
import {MARS,MARS_MOONS,marsMoonState,type MarsState} from './mars';
import {len,sunlightVisibility,type V} from './vector';
import {createMarsAtmosphere} from './mars-atmosphere';
import {MarsTerrain} from './mars-terrain';
import {MarsSurface,bodyToInertial,inertialToBody,latLonToDir} from './mars-geo';
import {SurfaceView,sunDirection} from './mars-surface';
import {createSpaceplane,fuselageShape,type ShipControls} from './spaceplane';
import type {FlightTelemetry} from './mars-flight';
import {PLACES,LANDING_SITES,type Place} from './mars-atlas';
import {BASE} from './mars-base';
import type {Weather} from './mars-weather';
import {publicAsset} from './assets';

const M = 1e-6; // world units per metre (1 world unit = 1000 km)
export const CAMERA_NAMES = ['COCKPIT','CHASE','ORBIT','TRACK TARGET','FRONT','STARBOARD','OVERHEAD','FLYBY','FULL SHIP','GROUND'];
const LANDMARKS = PLACES.filter(p => p.kind !== 'glyph');

export interface DrawInput {weather?: Weather; wind?: {e: number; n: number}; path?: V[] | null; state: MarsState; rotation: T.Quaternion; tele: FlightTelemetry | null; controls: Omit<ShipControls,'time'|'ambient'|'flow'>; dt: number; shake: number;}

export class MarsScene extends SpaceScene {
  mars: T.Mesh;
  surface: MarsSurface | null = null;
  surfaceView: SurfaceView | null = null;
  terrainStatus = 'loading';
  vehicleStatus = 'PATHFINDER MSV-01 · procedural';
  vehicleDimensions = new T.Vector3(29, 7, 40);
  onTerrainReady: () => void = () => {};
  private dust = createMarsAtmosphere();
  private vehicleScene = new T.Scene();
  private vehicleSun = new T.DirectionalLight(0xfff1dc, 3.2);
  private vehicleSky = new T.HemisphereLight(0xd9a77c, 0x3a2418, 0);
  private vehicleFill = new T.DirectionalLight(0x9fc3e6, .35);
  private shadowProxy: T.Group | null = null;
  private chase = new T.Quaternion();
  private chaseSet = false;
  private groundSpot: V | null = null;
  private wall = 0;
  surfaceCameraClearance = Infinity;
  private envSpace: T.Texture;
  private envMars: T.Texture;
  private landmarkLabels: HTMLElement[] = [];
  private debris: {mesh: T.Object3D; v: T.Vector3; spin: T.Vector3; life: number}[] = [];
  private flash = new T.PointLight(0xffa060, 0, 400 * M * 1e3, 2);
  explosionTime = -1;
  navPlace: Place | null = null;
  markings: 'essential' | 'full' | 'off' = 'essential';
  labelsMode: 'smart' | 'all' | 'off' = 'smart';
  private streaks: T.LineSegments;
  private streakSeeds: Float32Array;
  private cockpitSun = new T.DirectionalLight(0xfff1dc, 0);
  private cockpitSky = new T.HemisphereLight(0xd9a77c, 0x20150f, 0);
  private lastPath: V[] | null = null;

  constructor(host: HTMLElement) {
    super(host, '/textures/mars-8k.jpg', 2);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    const map = this.planetMap;
    this.planet.clear();
    this.mars = new T.Mesh(new T.SphereGeometry(MARS.radius / 1000, 160, 112), new T.MeshStandardMaterial({map, roughness: 1, emissive: 0x24100d, emissiveMap: map, emissiveIntensity: .16}));
    this.planet.add(this.mars); this.line.visible = false;
    Promise.all(['/textures/mars-radius.img', '/textures/mars-canyon-radius.img'].map(url => fetch(publicAsset(url)).then(r => {if (!r.ok) throw Error('MOLA download failed'); return r.arrayBuffer();})))
      .then(([global, canyon]) => {
        const terrain = new MarsTerrain(global); terrain.setCanyon(canyon);
        const old = this.mars.geometry; this.mars.geometry = terrain.geometry(); old.dispose();
        const globe = this.mars.material as T.MeshStandardMaterial;
        globe.normalMap = terrain.normalMap(); globe.normalScale.set(1, 1); globe.needsUpdate = true;
        this.planet.add(new T.Mesh(terrain.canyonGeometry(), this.mars.material));
        this.surface = new MarsSurface(terrain.heights);
        this.surface.flatten([...LANDING_SITES.map(p => ({dir: latLonToDir(p.lat, p.lon)})), {dir: latLonToDir(BASE.lat, BASE.lon), inner: BASE.flattenRadius, outer: BASE.flattenRadius + 180}]);
        this.surfaceView = new SurfaceView(this.surface, map);
        this.shadowProxy = createSpaceplane();
        const hidden = new T.MeshBasicMaterial({colorWrite: false, depthWrite: false});
        const hiddenSprite = new T.SpriteMaterial({colorWrite: false, depthWrite: false});
        // Exhaust, plasma and glow are light, not solid: they must not cast shadows on the ground.
        this.shadowProxy.traverse(o => {
          if (o instanceof T.Sprite) o.material = hiddenSprite;
          if (o instanceof T.Mesh) {o.castShadow = !(o.material instanceof T.ShaderMaterial) && !(o.material as T.Material).transparent; o.material = hidden;}
        });
        this.surfaceView.scene.add(this.shadowProxy);
        this.terrainStatus = 'MOLA 4 px/deg · 128 px/deg canyon · procedural detail to 2 m';
        this.onTerrainReady();
      })
      .catch(e => {this.terrainStatus = 'unavailable'; this.renderErrors.push(String(e));});

    this.moonMeshes.forEach((mesh, i) => {
      {mesh.geometry.dispose(); mesh.geometry = this.potato(MARS_MOONS[i].radius / 1000, 11 + i); mesh.material = new T.MeshStandardMaterial({color: i ? 0x9d9180 : 0x857666, roughness: 1, flatShading: true});}
    });
    this.labels.forEach((el, i) => {el.textContent = i < 2 ? MARS_MOONS[i].name.toUpperCase() : ''; el.style.display = 'none';});
    for (const place of LANDMARKS) {const el = document.createElement('div'); el.className = `body-label landmark kind-${place.kind}`; el.innerHTML = `<span>${place.kind === 'site' ? '▲' : place.kind === 'crash' ? '✕' : place.kind === 'base' ? '⬢' : '◇'}</span> ${place.name}`; el.title = place.note; el.style.display = 'none'; host.appendChild(el); this.landmarkLabels.push(el);}
    this.renderer.toneMappingExposure = 1.25;
    this.buildSpaceplaneCockpit();

    // Vehicle pass: its own lights and reflections so the ship looks right in orbit and under a dusty sky.
    const pmrem = new T.PMREMGenerator(this.renderer);
    this.envSpace = pmrem.fromScene(this.gradientRoom(new T.Color(0x05070b), new T.Color(0x131a24), new T.Color(0x040404))).texture;
    this.envMars = pmrem.fromScene(this.gradientRoom(new T.Color(0xc79c78), new T.Color(0xe3bf98), new T.Color(0x5a3a28))).texture;
    pmrem.dispose();
    this.vehicleScene.environment = this.envSpace;
    this.vehicleScene.add(new T.AmbientLight(0x8fa2b8, .08), this.vehicleSun, this.vehicleSun.target, this.vehicleSky, this.vehicleFill, this.flash);
    this.scene.remove(this.ship);
    this.ship = createSpaceplane();
    this.ship.scale.setScalar(M);
    this.vehicleScene.add(this.ship);
    this.shipRadius = 24 * M;
    this.onSteer = () => {};
    const count = 420, positions = new Float32Array(count * 6);
    this.streakSeeds = new Float32Array(count * 3).map(() => (Math.random() - .5) * 1600);
    const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(positions, 3).setUsage(T.DynamicDrawUsage));
    this.streaks = new T.LineSegments(sg, new T.LineBasicMaterial({color: 0xcfe0ff, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending}));
    this.streaks.frustumCulled = false; this.vehicleScene.add(this.streaks);
    (this.line.material as T.LineBasicMaterial).color.set(0xffc46b); (this.line.material as T.LineBasicMaterial).opacity = .75;
  }


  /** Flight deck seen from the pilot's eye, built from the same canopy geometry as the exterior hull. */
  private buildSpaceplaneCockpit() {
    this.cockpit.clear();
    this.cockpitScene.clear();
    this.cockpit.position.set(0, 0, 0);
    this.cockpitCamera.rotation.set(-.06, 0, 0); this.cockpitCamera.near = .02;
    this.cockpitScene.add(this.cockpit, this.cockpitSun, this.cockpitSun.target, this.cockpitSky, new T.AmbientLight(0x9fb4c4, .12));
    const eye = new T.Vector3(0, 2.05, -9.6);
    const frame = new T.MeshStandardMaterial({color: 0x2b2f34, roughness: .55, metalness: .5});
    const trim = new T.MeshStandardMaterial({color: 0x15181b, roughness: .85});
    const leather = new T.MeshStandardMaterial({color: 0x1d2024, roughness: .95});
    const canopyPoint = (z: number, a: number, inset = .06) => {
      const sh = fuselageShape(z), c = Math.cos(a);
      return new T.Vector3(sh.w * Math.sign(c) * Math.abs(c) ** (2 / 2.4) * (1 - inset * .3), sh.yc + sh.top * Math.abs(Math.sin(a)) ** (2 / 2.4) - inset, z).sub(eye);
    };
    for (const z of [-12.6, -9.9]) {
      const pts = Array.from({length: 17}, (_, j) => canopyPoint(z, Math.PI * (.19 + .62 * j / 16)));
      this.cockpit.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 40, .035, 8), frame));
    }
    for (const side of [-1, 1]) {
      const sill = Array.from({length: 14}, (_, i) => canopyPoint(-13.4 + i * .75, side < 0 ? Math.PI * .81 : Math.PI * .19, .02));
      this.cockpit.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(sill), 40, .05, 8), frame));
      // Side consoles below the sill line.
      const wall = new T.Mesh(new T.BoxGeometry(.5, .9, 2.8), trim); wall.position.set(side * 1.15, -1.05, -.2); wall.rotation.z = side * .25; this.cockpit.add(wall);
      const armrest = new T.Mesh(new T.BoxGeometry(.18, .08, .9), leather); armrest.position.set(side * .62, -.62, .25); this.cockpit.add(armrest);
      const grip = new T.Mesh(new T.CylinderGeometry(.025, .03, .16, 12), leather); grip.position.set(side * .62, -.52, .05); grip.rotation.x = -.25; this.cockpit.add(grip);
    }
    // Curved glare shield and panel.
    const shape = new T.Shape();
    shape.moveTo(-1.1, -1.0); shape.lineTo(-1.1, -.62); shape.quadraticCurveTo(0, -.48, 1.1, -.62); shape.lineTo(1.1, -1.0); shape.closePath();
    const panel = new T.Mesh(new T.ExtrudeGeometry(shape, {depth: .08, bevelEnabled: true, bevelSize: .02, bevelThickness: .02, bevelSegments: 2}), trim);
    panel.position.set(0, 0, -1.12); panel.rotation.x = -.2; this.cockpit.add(panel);
    
    const screen = (tex: T.Texture, w: number, h: number, x: number, y: number, yaw: number) => {
      const bezel = new T.Mesh(new T.BoxGeometry(w + .05, h + .05, .03), new T.MeshStandardMaterial({color: 0x0b0d0f, roughness: .4}));
      const glassMesh = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({map: tex, toneMapped: false}));
      const g = new T.Group(); g.add(bezel, glassMesh); glassMesh.position.z = .017;
      g.position.set(x, y, -.95); g.rotation.set(-.38, yaw, 0); this.cockpit.add(g);
      for (let i = 0; i < 5; i++) for (const sy of [-1, 1]) {const b = new T.Mesh(new T.BoxGeometry(.03, .016, .012), new T.MeshStandardMaterial({color: 0x3a3f44, emissive: 0x1a2a22})); b.position.set(-w / 2 + .05 + i * (w - .1) / 4, sy * (h / 2 + .04), .02); g.add(b);}
    };
    screen(this.panelTexture, .62, .21, 0, -.66, 0);
    this.sideDisplays.forEach(({texture}, i) => screen(texture, .34, .17, (i ? 1 : -1) * .56, -.7, (i ? -1 : 1) * .3));
  }

  private potato(radius: number, seed: number) {
    const g = new T.IcosahedronGeometry(radius, 4), p = g.getAttribute('position');
    let s = seed; const rand = () => {s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296;};
    const dents = Array.from({length: 26}, () => [new T.Vector3(rand() - .5, rand() - .5, rand() - .5).normalize(), .05 + rand() * .25, .08 + rand() * .12] as const);
    for (let i = 0; i < p.count; i++) {
      const v = new T.Vector3().fromBufferAttribute(p, i), d = v.clone().normalize();
      let r = 1 + .08 * Math.sin(d.x * 3 + seed) * Math.cos(d.y * 2);
      for (const [axis, size, depth] of dents) {const a = Math.acos(Math.min(1, d.dot(axis))); if (a < size) r -= depth * (1 - (a / size) ** 2) * .5;}
      d.multiplyScalar(r * radius); d.x *= 1.25; d.z *= .9;
      p.setXYZ(i, d.x, d.y, d.z);
    }
    g.computeVertexNormals(); return g;
  }

  private gradientRoom(top: T.Color, horizon: T.Color, bottom: T.Color) {
    const room = new T.Scene();
    room.add(new T.Mesh(new T.SphereGeometry(10, 32, 16), new T.ShaderMaterial({
      side: T.BackSide, uniforms: {top: {value: top}, horizon: {value: horizon}, bottom: {value: bottom}},
      vertexShader: 'varying vec3 p; void main(){p=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 p; void main(){gl_FragColor=vec4(p.y>0.?mix(horizon,top,pow(p.y,.6)):mix(horizon,bottom,pow(-p.y,.4)),1.);}',
    })));
    return room;
  }

  /** Place the ground camera on the surface beside or ahead of the ship. */
  private placeGroundSpot(s: MarsState, tele: FlightTelemetry | null) {
    if (!this.surface) return;
    const body = inertialToBody(s.p.map(x => x * 1000) as V, s.t, MARS.rotation);
    const up = new T.Vector3(...body).normalize();
    let offset = new T.Vector3(0, 0, 1).cross(up).normalize();
    if (tele && tele.groundSpeed > 20 && tele.agl > 30) {
      const air = new T.Vector3(...inertialToBody(tele.airVelocity, s.t, MARS.rotation)).normalize();
      const ahead = air.addScaledVector(up, -air.dot(up)).normalize();
      offset = ahead.multiplyScalar(Math.min(4000, tele.groundSpeed * 9)).add(ahead.clone().cross(up).normalize().multiplyScalar(90));
    } else offset = offset.clone().multiplyScalar(48).add(new T.Vector3().crossVectors(up, offset).normalize().multiplyScalar(-26));
    const spot = up.clone().multiplyScalar(up.dot(new T.Vector3(...body))).add(offset);
    const r = this.surface.radiusM(spot.toArray() as V, 2) + 1.7;
    this.groundSpot = spot.normalize().multiplyScalar(r).toArray() as V;
  }

  /** No oxygen on Mars: a brief propellant flash, tumbling debris, and the dust does the rest. */
  explode() {
    this.explosionTime = 0;
    const colors = [0x2a2a2a, 0xe9e6df, 0x16171a, 0x8d9197];
    const flash = new T.Sprite(new T.SpriteMaterial({map: this.flashMap(), color: 0xfff1d8, transparent: true, depthWrite: false, blending: T.AdditiveBlending}));
    flash.scale.setScalar(60 * M); flash.name = 'flash';
    this.debris.push({mesh: flash, v: new T.Vector3(), spin: new T.Vector3(), life: .45});
    this.vehicleScene.add(flash);
    for (let i = 0; i < 70; i++) {
      const size = .3 + Math.random() * 2.4;
      const mesh = new T.Mesh(new T.BoxGeometry(size, size * .2, size * .8), new T.MeshStandardMaterial({color: colors[i % colors.length], roughness: .7}));
      mesh.scale.setScalar(M);
      const v = new T.Vector3(Math.random() - .5, Math.random() * .8, Math.random() - .5).normalize().multiplyScalar(20 + Math.random() * 55);
      this.debris.push({mesh, v, spin: new T.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(6), life: 7});
      this.vehicleScene.add(mesh);
    }
  }
  private flashTexture: T.Texture | null = null;
  private flashMap() {
    if (this.flashTexture) return this.flashTexture;
    const c = document.createElement('canvas'); c.width = c.height = 128; const k = c.getContext('2d')!, g = k.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,245,1)'); g.addColorStop(.2, 'rgba(255,220,170,.8)'); g.addColorStop(1, 'rgba(255,160,90,0)'); k.fillStyle = g; k.fillRect(0, 0, 128, 128);
    return this.flashTexture = new T.CanvasTexture(c);
  }
  clearExplosion() {for (const d of this.debris) this.vehicleScene.remove(d.mesh); this.debris = []; this.explosionTime = -1; this.flash.intensity = 0;}

  private cameraRig(input: DrawInput, up: T.Vector3, air: number) {
    const {rotation, dt, state: s} = input;
    const cam = this.camera, zoom = this.cameraZoom;
    cam.up.set(0, 1, 0);
    if (!this.chaseSet) {this.chase.copy(rotation); this.chaseSet = true;}
    this.chase.slerp(rotation, 1 - Math.exp(-dt * 3.2));
    const shipUp = new T.Vector3(0, 1, 0).applyQuaternion(this.chase);
    const levelUp = shipUp.clone().lerp(up, air * .65).normalize();
    const at = (x: number, y: number, z: number, q: T.Quaternion) => new T.Vector3(x, y, z).multiplyScalar(M * zoom).applyQuaternion(q);
    switch (this.mode) {
      case 0: cam.position.copy(new T.Vector3(0, 2.05, -9.6).multiplyScalar(M).applyQuaternion(rotation)); cam.quaternion.copy(rotation); cam.rotateX(-.06); break;
      case 1: cam.position.copy(at(0, 13, 72, this.chase)); cam.up.copy(levelUp); cam.lookAt(new T.Vector3(0, 4 * M, 0).applyQuaternion(this.chase)); break;
      case 2: {
        if (!this.pointerActive()) this.orbitAngle += dt * .06;
        cam.position.set(Math.sin(this.orbitAngle) * Math.cos(this.orbitPitch), Math.sin(this.orbitPitch), Math.cos(this.orbitAngle) * Math.cos(this.orbitPitch)).multiplyScalar(170 * M * zoom);
        cam.up.copy(up); cam.lookAt(0, 0, 0); break;
      }
      case 3: {
        cam.position.set(0, 0, 0);
        const target = this.navPlace ? this.placePosition(this.navPlace, s.t).sub(new T.Vector3(...s.p)).multiplyScalar(.001) : this.trackedBody < 0 ? this.planet.position.clone() : new T.Vector3(...marsMoonState(this.trackedBody, s.t).p).multiplyScalar(.001).sub(new T.Vector3(...s.p).multiplyScalar(.001));
        cam.up.copy(up); cam.lookAt(target); break;
      }
      case 4: cam.position.copy(at(9, 6, -62, rotation)); cam.up.copy(new T.Vector3(0, 1, 0).applyQuaternion(rotation)); cam.lookAt(0, 0, 0); break;
      case 5: cam.position.copy(at(66, 7, 2, rotation)); cam.up.copy(new T.Vector3(0, 1, 0).applyQuaternion(rotation)); cam.lookAt(0, 0, 0); break;
      case 6: cam.position.copy(at(0, 85, 4, rotation)); cam.up.copy(new T.Vector3(0, 0, -1).applyQuaternion(rotation)); cam.lookAt(0, 0, 0); break;
      case 7: {const a = this.wall * .25; cam.position.copy(at(Math.sin(a) * 60, 10 + Math.sin(a * .7) * 8, Math.cos(a) * 60, rotation)); cam.up.copy(levelUp); cam.lookAt(0, 0, 0); break;}
      case 8: {
        const sphere = new T.Box3().setFromObject(this.ship).getBoundingSphere(new T.Sphere());
        const vf = T.MathUtils.degToRad(cam.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * cam.aspect);
        const distance = Math.max(62 * M, sphere.radius / Math.sin(Math.min(vf, hf) / 2) * 1.18) * zoom;
        cam.position.set(Math.sin(this.orbitAngle) * Math.cos(this.orbitPitch), Math.sin(this.orbitPitch), Math.cos(this.orbitAngle) * Math.cos(this.orbitPitch)).multiplyScalar(distance).applyQuaternion(rotation);
        cam.up.copy(new T.Vector3(0, 1, 0).applyQuaternion(rotation)); cam.lookAt(0, 0, 0); break;
      }
      case 9: {
        // Near a selected lander, stand beside the hardware like a rover's mast camera would.
        if (this.navPlace && this.surface && (this.navPlace.kind === 'site' || this.navPlace.kind === 'crash')) {
          const siteDir = this.placePosition(this.navPlace, s.t).normalize(), siteBody = inertialToBody(siteDir.toArray() as V, s.t, MARS.rotation);
          const site = siteDir.multiplyScalar(this.surface.radiusM(siteBody, 2)), ship = new T.Vector3(...s.p).multiplyScalar(1000);
          if (site.distanceTo(ship) < 3000) {
            // Stand on the sunward side so the hardware is front-lit.
            const up = site.clone().normalize(), sunFlat = sunDirection().addScaledVector(up, -sunDirection().dot(up));
            const side = sunFlat.lengthSq() > 1e-6 ? sunFlat.normalize() : new T.Vector3(0, 1, 0).cross(up).normalize();
            const spotDir = site.clone().addScaledVector(side, 8).addScaledVector(side.clone().cross(up), 4).normalize();
            const body = inertialToBody(spotDir.toArray() as V, s.t, MARS.rotation), r = this.surface.radiusM(body, 2) + 2.2;
            cam.position.copy(spotDir.multiplyScalar(r).sub(ship).multiplyScalar(M));
            cam.up.copy(up); cam.lookAt(site.clone().addScaledVector(up, .9).sub(ship).multiplyScalar(M));
            break;
          }
        }
        if (!this.groundSpot) this.placeGroundSpot(s, input.tele);
        const spot = this.groundSpot ? new T.Vector3(...bodyToInertial(this.groundSpot, s.t, MARS.rotation)) : null;
        const ship = new T.Vector3(...s.p).multiplyScalar(1000);
        if (!spot || spot.distanceTo(ship) > 9000) {this.placeGroundSpot(s, input.tele); break;}
        cam.position.copy(spot.sub(ship).multiplyScalar(M)); cam.up.copy(up); cam.lookAt(0, 0, 0); break;
      }
    }
    if (s.status === 'impact' && this.mode !== 9) {
      // Once contact is terminal, stop following the vehicle's tumbling body frame. A surface-relative
      // camera keeps the horizon level and cannot swing through terrain or nearby base structures.
      let forward = new T.Vector3(0, 0, -1).applyQuaternion(rotation);
      forward.addScaledVector(up, -forward.dot(up));
      if (forward.lengthSq() < 1e-5) forward = new T.Vector3(0, 1, 0).cross(up);
      forward.normalize();
      cam.position.copy(up).multiplyScalar(12).addScaledVector(forward, -34).multiplyScalar(M);
      cam.up.copy(up); cam.lookAt(up.clone().multiplyScalar(2 * M));
    }
    // External cameras can swing below the terrain when the ship tumbles or embeds during a crash.
    // Clamp the actual render camera to the same detailed surface used by collision physics.
    this.surfaceCameraClearance = Infinity;
    // Use radar altitude against measured terrain here. Comparing with Mars's mean radius
    // fails by kilometres in elevated regions and lets a chase camera pass under the mesh.
    if (this.surface && (input.tele?.agl ?? (len(s.p) - MARS.radius) * 1000) < 20000) {
      const shipM = new T.Vector3(...s.p).multiplyScalar(1000);
      const inertial = cam.position.clone().divideScalar(M).add(shipM);
      const body = new T.Vector3(...inertialToBody(inertial.toArray() as V, s.t, MARS.rotation));
      const distance = body.length();
      if (distance > 1) {
        const dir = body.clone().divideScalar(distance), radius = this.surface.radiusM(dir.toArray() as V, 2);
        this.surfaceCameraClearance = distance - radius;
        const minimum = this.mode === 9 ? 1.8 : 4;
        if (this.surfaceCameraClearance < minimum) {
          body.copy(dir).multiplyScalar(radius + minimum);
          const safe = new T.Vector3(...bodyToInertial(body.toArray() as V, s.t, MARS.rotation));
          cam.position.copy(safe.sub(shipM).multiplyScalar(M));
          this.surfaceCameraClearance = minimum;
        }
      }
    }
    if (input.shake > 0 && this.mode !== 2 && this.mode !== 8) {
      const k = input.shake * .004;
      cam.rotateX((Math.random() - .5) * k); cam.rotateY((Math.random() - .5) * k); cam.rotateZ((Math.random() - .5) * k * .6);
    }
    cam.updateMatrixWorld(true);
  }
  /** Leave footpad prints where the gear touched down. */
  markGearOnGround(rotation: T.Quaternion) {
    const pads = [new T.Vector3(0, -3.4, -11), new T.Vector3(-2.9, -3.4, 5), new T.Vector3(2.9, -3.4, 5)].map(p => p.applyQuaternion(rotation));
    this.surfaceView?.markPrints(pads);
  }
  /** Inertial position of a surface place, km. */
  placePosition(place: Place, t: number) {
    const dir = latLonToDir(place.lat, place.lon), r = ((this.surface ? this.surface.radiusM(dir, 200) : MARS.radius * 1000) + (place.agl ?? 0)) / 1000;
    return new T.Vector3(...bodyToInertial(dir.map(x => x * r) as V, t, MARS.rotation));
  }
  private pointerActive() {return this.pointer != null;}
  resetCameraState() {this.chaseSet = false; this.groundSpot = null;}

  draw(input: DrawInput) {
    const {state: s, rotation, tele, dt} = input;
    this.wall += dt;
    const p = new T.Vector3(...s.p).multiplyScalar(.001);
    this.planet.position.copy(p).negate();
    this.planet.rotation.y = s.t / MARS.rotation * Math.PI * 2;
    const up = new T.Vector3(...(tele?.up ?? s.p.map(x => x / len(s.p)) as V));
    const agl = tele?.agl ?? (len(s.p) - MARS.radius) * 1000;
    const air = Math.exp(-Math.max(0, agl) / 14000);
    this.cameraRig(input, up, air);

    const sunDir = sunDirection(), sun = sunDir.clone().multiplyScalar(1.524 * 149597.8707).sub(p);
    this.sun.position.copy(sun); this.light.position.copy(sun); this.light.target.position.copy(this.planet.position);
    this.stars.position.copy(this.camera.position);

    // Moons and labels.
    const camForward = this.camera.getWorldDirection(new T.Vector3());
    const occluded = (target: T.Vector3) => {
      const ray = new T.Ray(this.camera.position, target.clone().sub(this.camera.position).normalize());
      const hit = ray.intersectSphere(new T.Sphere(this.planet.position, MARS.radius / 1000 * .999), new T.Vector3());
      return !!hit && hit.distanceTo(this.camera.position) < target.distanceTo(this.camera.position) - 1e-4;
    };
    const label = (el: HTMLElement, target: T.Vector3, show: boolean) => {
      const projected = target.clone().project(this.camera), front = target.clone().sub(this.camera.position).dot(camForward) > 0;
      const visible = show && front && Math.abs(projected.x) < .92 && Math.abs(projected.y) < .8 && !occluded(target);
      el.style.display = visible ? 'block' : 'none';
      if (visible) {el.style.left = `${(projected.x * .5 + .5) * innerWidth}px`; el.style.top = `${(-projected.y * .5 + .5) * innerHeight}px`;}
    };
    const skyOpacity = this.surfaceView?.skyOpacity() ?? 0, skyGlow = Math.max(this.surfaceView?.skyBrightness() ?? 0, (this.surfaceView?.storm ?? 0) * skyOpacity * 1.5);
    for (let i = 0; i < 2; i++) {
      const position = new T.Vector3(...marsMoonState(i, s.t).p).multiplyScalar(.001).sub(p);
      this.moonMeshes[i].position.copy(position);
      this.moonMeshes[i].rotation.y = s.t * 2 * Math.PI / marsMoonState(i, 0).period;
      label(this.labels[i], position, this.labelsMode !== 'off' && skyOpacity < .6);
    }
    const planetRotation = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), this.planet.rotation.y);
    const shipDist = len(s.p);
    const occupied: {x:number;y:number}[] = [];
    LANDMARKS.forEach((place, i) => {
      const point = new T.Vector3(...latLonToDir(place.lat, place.lon)).multiplyScalar(MARS.radius / 1000 * 1.002).applyQuaternion(planetRotation).add(this.planet.position);
      const rangeKm = point.length() * 1000;
      // From orbit show major features; low down show whatever is within a few hundred km. Sites always matter to pilots.
      const major = place.kind !== 'site' && place.kind !== 'crash' && place.kind !== 'base';
      const selected = this.navPlace?.id === place.id;
      let show = this.labelsMode !== 'off' && ((agl > 60000 && shipDist < 60000 && (major || shipDist < 12000)) || (agl <= 60000 && rangeKm < (major ? 700 : 250)) || selected);
      if (show && this.labelsMode === 'smart' && !selected) {
        const q = point.clone().project(this.camera), x = (q.x * .5 + .5) * innerWidth, y = (-q.y * .5 + .5) * innerHeight;
        const priority = (major && rangeKm < 450) || ((place.kind === 'site' || place.kind === 'base') && rangeKm < 100);
        show = priority && occupied.length < 8 && !occupied.some(a => Math.abs(a.x - x) < 170 && Math.abs(a.y - y) < 28);
        if (show) occupied.push({x,y});
      }
      label(this.landmarkLabels[i], point, show);
      this.landmarkLabels[i].classList.toggle('selected', this.navPlace?.id === place.id);
    });

    // Space pass.
    const view = this.surfaceView;
    const cameraOffsetM = this.camera.position.clone().divideScalar(M);
    const speedMs = tele ? tele.groundSpeed : 0;
    const surfaceActive = !!view && view.update(s.p, s.t, this.camera, cameraOffsetM, speedMs);
    // Stars show in space; a sunlit dusty sky washes them out.
    this.setStarVisibility(1 - Math.min(1, Math.max(skyGlow, view?.starWash() ?? 0) * 1.6));
    if (input.path && input.path.length > 1) {
      if (input.path !== this.lastPath) {this.trajectory(input.path); this.lastPath = input.path;}
      this.line.position.copy(this.planet.position);
      this.line.visible = this.markings === 'full' && agl > 90000 && this.mode !== 0 && !document.body.classList.contains('clean-view');
    } else {this.line.visible = false; this.lastPath = null;}
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.camera);

    this.dust.material.uniforms.sunDirection.value.copy(sun).normalize();
    this.dust.material.uniforms.eye.value.copy(this.camera.position).multiplyScalar(1000).add(new T.Vector3(...s.p));
    this.dust.material.uniforms.inverseProjection.value.copy(this.camera.projectionMatrixInverse);
    this.dust.material.uniforms.cameraRotation.value.copy(this.camera.matrixWorld);
    this.dust.material.uniforms.fade.value = 1 - T.MathUtils.smoothstep(skyOpacity, .02, .25);
    this.renderer.autoClear = false;
    this.renderer.render(this.dust.scene, this.dust.camera);

    if (surfaceActive && view) {
      if (this.shadowProxy) {
        this.shadowProxy.quaternion.copy(rotation);
        (this.shadowProxy.userData.update as (c: ShipControls) => void)({...input.controls, time: this.wall, ambient: 1, flow: null});
        this.shadowProxy.visible = this.explosionTime < 0;
      }
      const shipUp = new T.Vector3(0, 1, 0).applyQuaternion(rotation), shipBack = new T.Vector3(0, 0, 1).applyQuaternion(rotation);
      const main = input.controls.throttle * (input.controls.torch ? 3 : 1);
      const skimDir = tele ? new T.Vector3(...tele.airVelocity) : null;
      if (input.weather) view.stepWeather(input.weather, s.t);
      view.setLandingLights(rotation, input.controls.gear > .9);
      view.stepDust(dt, [
        {dir: shipUp.clone().negate(), power: input.controls.hover, reach: 70},
        {dir: shipBack, power: main, reach: 110 * (input.controls.torch ? 3 : 1)},
      ], tele && skimDir && this.explosionTime < 0 ? {speed: tele.groundSpeed, dir: skimDir} : null, input.wind);
      view.renderSky(this.renderer);
      view.renderTerrain(this.renderer);
    }

    // Vehicle pass.
    const sunlight = sunlightVisibility(s.p, sunDir.clone().multiplyScalar(1.524 * 149597870.7).toArray() as V, [0, 0, 0], MARS.radius);
    const day = T.MathUtils.smoothstep(sunDir.dot(up), -.12, .1);
    const lit = surfaceActive ? Math.max(sunlight * .0 + day, 0) : sunlight;
    this.vehicleSun.position.copy(sunDir); this.vehicleSun.target.position.set(0, 0, 0);
    this.vehicleSun.intensity = 3.3 * lit;
    const planetshine = Math.min(1, (MARS.radius / len(s.p)) ** 2) * (1 - skyOpacity) * (.35 + .65 * Math.max(0, sunDir.dot(up)));
    this.vehicleSky.color.set(skyOpacity > .15 ? 0xd9a77c : 0x2a3240); this.vehicleSky.groundColor.set(0x8a4a2a);
    this.vehicleSky.intensity = 1.1 * skyOpacity * (.3 + .7 * day) + 1.6 * planetshine;
    this.vehicleSky.position.copy(up);
    this.vehicleFill.position.copy(this.camera.position).normalize();
    this.vehicleFill.intensity = this.mode === 8 ? 1.2 : .25;
    this.vehicleScene.environment = skyOpacity > .15 ? this.envMars : this.envSpace;
    this.vehicleScene.environmentIntensity = skyOpacity > .15 ? .35 + .5 * day : .6;
    const flowLocal = tele ? new T.Vector3(...tele.airVelocity).applyQuaternion(rotation.clone().invert()) : null;
    this.ship.quaternion.copy(rotation);
    (this.ship.userData.update as (c: ShipControls) => void)({...input.controls, time: this.wall, ambient: Math.min(1, air * 3), flow: flowLocal});
    this.ship.visible = this.mode !== 0 && this.mode !== 3 && this.explosionTime < 0;
    if (this.explosionTime >= 0) {
      this.explosionTime += dt;
      this.flash.intensity = Math.max(0, 12 * (1 - this.explosionTime / .5));
      for (const d of this.debris) {
        d.life -= dt; d.v.addScaledVector(up, -3.7 * dt);
        d.mesh.position.addScaledVector(d.v, dt * M);
        d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt;
        const m = (d.mesh as T.Mesh).material as T.MeshBasicMaterial;
        if (m.blending === T.AdditiveBlending) {m.opacity = Math.max(0, d.life / .45); d.mesh.scale.multiplyScalar(1 + dt * 3);}
        d.mesh.visible = d.life > 0;
      }
    }
    this.shipFramed = true;
    if (this.mode === 8) {
      const bounds = new T.Box3().setFromObject(this.ship);
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {const v = new T.Vector3(x, y, z).project(this.camera); if (Math.abs(v.x) > .98 || Math.abs(v.y) > .98) this.shipFramed = false;}
    }
    // Speed streaks: drifting motes that stretch along your motion, so high velocity reads as speed.
    const vel = new T.Vector3(...(tele?.airVelocity ?? s.v)).multiplyScalar(1000), speed = vel.length();
    const streakPos = this.streaks.geometry.getAttribute('position') as T.BufferAttribute;
    const streakAlpha = (this.markings === 'full' ? 1 : 0) * T.MathUtils.smoothstep(speed, 3500, 20000) * .36 * (1 - skyOpacity) * (this.mode === 0 || this.mode === 1 ? 1 : .5);
    (this.streaks.material as T.LineBasicMaterial).opacity = streakAlpha * .7;
    this.streaks.visible = streakAlpha > .01;
    if (this.streaks.visible) {
      const dir = vel.clone().normalize(), shift = Math.min(speed * dt * 12, 1500), stretch = Math.min(260, speed * .018);
      for (let i = 0; i < this.streakSeeds.length / 3; i++) {
        for (let k = 0; k < 3; k++) {let v = this.streakSeeds[i * 3 + k] - dir.getComponent(k) * shift; v = ((v + 800) % 1600 + 1600) % 1600 - 800; this.streakSeeds[i * 3 + k] = v;}
        const x = this.streakSeeds[i * 3], y = this.streakSeeds[i * 3 + 1], z = this.streakSeeds[i * 3 + 2];
        streakPos.setXYZ(i * 2, x * M, y * M, z * M);
        streakPos.setXYZ(i * 2 + 1, (x + dir.x * stretch) * M, (y + dir.y * stretch) * M, (z + dir.z * stretch) * M);
      }
      streakPos.needsUpdate = true;
    }
    this.renderer.clearDepth();
    this.renderer.render(this.vehicleScene, this.camera);

    if (this.mode === 0) {
      const inv = rotation.clone().invert();
      this.cockpitSun.position.copy(sunDir).applyQuaternion(inv); this.cockpitSun.intensity = 2.2 * lit;
      this.cockpitSky.position.copy(up).applyQuaternion(inv); this.cockpitSky.intensity = this.vehicleSky.intensity * .8 + .15;
      const c = this.panelCanvas.getContext('2d')!;
      c.fillStyle = '#10232c'; c.fillRect(0, 0, 768, 256); c.fillStyle = '#9ff5c8'; c.font = '24px monospace';
      c.fillText('PATHFINDER / FLIGHT', 26, 42); c.font = '46px monospace';
      c.fillText(`${(tele?.airspeed ?? len(s.v) * 1000).toFixed(0)} M/S`, 26, 110);
      c.font = '25px monospace';
      c.fillText(`AGL ${agl > 99999 ? (agl / 1000).toFixed(0) + ' KM' : agl.toFixed(0) + ' M'}`, 26, 160);
      c.fillText(`THR ${Math.round(input.controls.throttle * 100)}%  JETS ${Math.round(input.controls.hover * 100)}%  FUEL ${s.fuel.toFixed(0)}%`, 26, 210);
      this.panelTexture.needsUpdate = true;
      this.sideDisplays.forEach(({canvas, texture}, i) => {const k = canvas.getContext('2d')!; k.fillStyle = '#10232c'; k.fillRect(0, 0, 320, 160); k.fillStyle = '#ffd08a'; k.font = '20px monospace'; k.fillText(i ? 'HULL TEMP' : 'GEAR', 18, 38); k.font = '34px monospace'; k.fillText(i ? `${(s.heat ?? 0).toFixed(0)}%` : input.controls.gear > .95 ? 'DOWN' : input.controls.gear < .05 ? 'UP' : 'MOVING', 18, 100); texture.needsUpdate = true;});
      this.renderer.clearDepth();
      this.renderer.render(this.cockpitScene, this.cockpitCamera);
    }
  }
}
