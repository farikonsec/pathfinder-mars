import * as T from 'three';
import type {V} from './vector';

/**
 * Mars weather for gameplay: prevailing wind with gusts, wandering dust devils, and dust storms.
 * Speeds are in the plausible range from lander records (tens of m/s in storms), tuned for feel.
 */
export type WeatherMode = 'calm' | 'breezy' | 'storm';
export const WEATHER_NAMES: Record<WeatherMode, string> = {calm: 'Calm', breezy: 'Breezy', storm: 'Dust storm'};
const BASE_WIND: Record<WeatherMode, number> = {calm: 3, breezy: 11, storm: 24};

function hash(x: number, y: number, s: number) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface Devil {x: number; z: number; radius: number; height: number; spin: number;}

export class Weather {
  mode: WeatherMode = 'calm';
  /** Smoothed storm amount 0..1 so switching modes fades rather than pops. */
  storm = 0;
  heading = .6; // radians, direction the wind blows toward, from east toward north

  update(dt: number) {this.storm += ((this.mode === 'storm' ? 1 : 0) - this.storm) * Math.min(1, dt * .6);}

  /** Wind in the local east/north frame (m/s) at simulation time t and height above ground. */
  windEN(t: number, agl: number) {
    const base = BASE_WIND[this.mode], gustAmp = base * (this.mode === 'storm' ? .6 : .45);
    const gust = Math.sin(t * .37) * .5 + Math.sin(t * 1.13 + 1.7) * .3 + Math.sin(t * 2.9 + .4) * .2;
    const veer = this.heading + Math.sin(t * .05) * .35 + Math.sin(t * .21) * .1 * (this.mode === 'storm' ? 2 : 1);
    const boundary = Math.min(1, .45 + Math.max(0, agl) / 400) * (agl > 30000 ? Math.max(0, 1 - (agl - 30000) / 20000) : 1);
    const speed = Math.max(0, base + gustAmp * gust) * boundary;
    return {e: Math.cos(veer) * speed, n: Math.sin(veer) * speed, gust: gust * gustAmp};
  }

  /** Dust devils near a map point (metres: x east, z north), deterministic from 6 km cells. */
  devils(x: number, z: number, t: number, daylight: number): Devil[] {
    if (this.mode === 'storm' || daylight < .5) return [];
    const cell = 6000, out: Devil[] = [], cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    const odds = this.mode === 'breezy' ? .75 : .45;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const gx = cx + i, gz = cz + j;
      if (hash(gx, gz, 1) > odds) continue;
      const wander = t * .002 * (.5 + hash(gx, gz, 2));
      const px = (gx + .5) * cell + Math.cos(wander + hash(gx, gz, 3) * 6) * cell * .35;
      const pz = (gz + .5) * cell + Math.sin(wander * 1.3 + hash(gx, gz, 4) * 6) * cell * .35;
      out.push({x: px, z: pz, radius: 18 + 40 * hash(gx, gz, 5), height: 250 + 650 * hash(gx, gz, 6), spin: hash(gx, gz, 7) > .5 ? 1 : -1});
    }
    return out;
  }

  /** Extra wind (east, up, north m/s) from any devil the ship is inside. */
  devilWind(devils: Devil[], x: number, z: number, agl: number) {
    let e = 0, up = 0, n = 0;
    for (const d of devils) {
      const dx = x - d.x, dz = z - d.z, r = Math.hypot(dx, dz), reach = d.radius * 3;
      if (r > reach || agl > d.height) continue;
      const k = (1 - r / reach) ** 1.5 * (1 - agl / d.height * .6);
      // Tangential swirl plus a core updraft.
      e += -dz / (r || 1) * 22 * k * d.spin; n += dx / (r || 1) * 22 * k * d.spin; up += 7 * k * (r < d.radius ? 1 : .3);
    }
    return {e, up, n};
  }
}

/** Swirling translucent columns for devils, drawn in the surface scene. */
export class DevilMeshes {
  group = new T.Group();
  private meshes: T.Mesh[] = [];
  material = new T.ShaderMaterial({
    transparent: true, depthWrite: false, side: T.DoubleSide,
    uniforms: {time: {value: 0}, colour: {value: new T.Color(.72, .54, .4)}, fogColor: {value: new T.Color()}, fogDensity: {value: 0}},
    vertexShader: `varying vec2 vUv; varying float vDepth;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main(){ vUv = uv; vec3 p = position; p.xz *= mix(.35, 1.6, uv.y * uv.y); p.x += sin(uv.y * 5.0 + position.y * .01) * 6.0 * uv.y;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `uniform float time; uniform vec3 colour; uniform vec3 fogColor; uniform float fogDensity; varying vec2 vUv; varying float vDepth;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main(){
        #include <logdepthbuf_fragment>
        float swirl = sin((vUv.x * 6.2832 * 3.0) + vUv.y * 22.0 - time * 3.0) * .5 + .5;
        float streak = sin((vUv.x * 6.2832 * 7.0) - vUv.y * 40.0 - time * 5.0) * .5 + .5;
        float a = (.18 + .3 * swirl * streak) * smoothstep(0., .08, vUv.y) * (1. - smoothstep(.55, 1., vUv.y)) * .55;
        float fog = 1. - exp(-fogDensity * fogDensity * vDepth * vDepth);
        gl_FragColor = vec4(mix(colour * (.8 + .3 * swirl), fogColor, fog), a * (1. - fog * .7));
      }`,
  });
  constructor() {
    for (let i = 0; i < 25; i++) {
      const m = new T.Mesh(new T.CylinderGeometry(1, 1, 1, 24, 12, true), this.material);
      m.frustumCulled = false; m.visible = false; m.renderOrder = 55; this.meshes.push(m); this.group.add(m);
    }
  }
  /** Place devils given a function mapping local (x, z) to group-local position and ground height. */
  set(devils: Devil[], place: (x: number, z: number) => {position: T.Vector3; up: T.Vector3}, time: number) {
    this.material.uniforms.time.value = time;
    this.meshes.forEach((m, i) => {
      const d = devils[i];
      m.visible = !!d;
      if (!d) return;
      const {position, up} = place(d.x, d.z);
      m.position.copy(position).addScaledVector(up, d.height / 2);
      m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), up);
      m.scale.set(d.radius, d.height, d.radius);
    });
  }
}

export const windToInertial = (e: number, up: number, n: number, basis: {east: V; up: V; north: V}): V => [
  basis.east[0] * e + basis.up[0] * up + basis.north[0] * n,
  basis.east[1] * e + basis.up[1] * up + basis.north[1] * n,
  basis.east[2] * e + basis.up[2] * up + basis.north[2] * n,
];
