import * as T from 'three';
import type {V} from './vector';
import {MARS} from './mars';
import {MarsSurface,bodyToInertial,dirToLatLon,inertialToBody,latLonToDir} from './mars-geo';
import {LANDING_SITES,placeById,type Place} from './mars-atlas';
import {createHardware} from './mars-hardware';
import {createBase,baseBasis,BASE} from './mars-base';
import {drawStencil} from './rahimli-font';
import {DustSystem} from './mars-dust';
import {DevilMeshes,type Devil,type Weather} from './mars-weather';

/**
 * Close-range Mars: nested terrain rings in metres around the ship, a dusty sky and scattered rocks.
 * Heights come from the same MarsSurface the physics collides with.
 *
 * Each ring owns its own tangent anchor, so rebasing never invalidates rings that are already on screen.
 * Rings overlap; a stencil test lets the finest ring win wherever it drew, which also hides cracks.
 */
const N = 96;
// Preserve sub-metre float precision without a visible repeat across orbital-scale views.
const PERIOD = 1048576;
const ACTIVE_ALTITUDE = 900000;

interface Anchor {dir: V; east: V; north: V; radius: number;}
interface Ring {cell: number; mesh: T.Mesh; anchor: Anchor | null; ce: number; cn: number; dirty: boolean; hole: string;}
interface Prop {place: Place; dir: V; object: T.Group; body: V | null;}

export function sunDirection(): T.Vector3 {return new T.Vector3(.8, .1, -.6).normalize();}

function makeAnchor(surface: MarsSurface, bodyP: V): Anchor {
  const l = Math.hypot(...bodyP), dir: V = [bodyP[0] / l, bodyP[1] / l, bodyP[2] / l];
  const pole = Math.abs(dir[1]) > .95 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0);
  const d = new T.Vector3(...dir), east = new T.Vector3().crossVectors(pole, d).normalize(), north = new T.Vector3().crossVectors(d, east);
  return {dir, east: east.toArray() as V, north: north.toArray() as V, radius: surface.radiusM(dir, 4096)};
}
function planeCoords(a: Anchor, bodyP: V) {
  const k = a.radius / (bodyP[0] * a.dir[0] + bodyP[1] * a.dir[1] + bodyP[2] * a.dir[2]);
  const t = [bodyP[0] * k, bodyP[1] * k, bodyP[2] * k];
  return {e: t[0] * a.east[0] + t[1] * a.east[1] + t[2] * a.east[2], n: t[0] * a.north[0] + t[1] * a.north[1] + t[2] * a.north[2]};
}

function terrainMaterial(map: T.Texture | null, cell: number) {
  // A restrained regolith self-fill stands in for multiple-scattered skylight. It prevents
  // a sunlit surface from collapsing to black under the thin, dusty Martian atmosphere.
  const m = new T.MeshStandardMaterial({map, roughness: .96, metalness: 0, side: T.DoubleSide});
  // Detail tiers: near rings get every octave, far rings (large footprint anyway) skip the fine ones.
  const detail = cell <= 4 ? 3 : cell <= 32 ? 2 : 1;
  m.defines = {DETAIL: detail};
  const ref = 24 - Math.round(Math.log2(cell));
  Object.assign(m, {stencilWrite: true, stencilRef: ref, stencilFunc: T.GreaterEqualStencilFunc, stencilZPass: T.ReplaceStencilOp, stencilFail: T.KeepStencilOp, stencilZFail: T.KeepStencilOp});
  m.onBeforeCompile = shader => {
    shader.uniforms.bodySun = {value: new T.Vector3(.8,.1,-.6).normalize()};
    shader.uniforms.surfaceFill = {value: .2};
    m.userData.terrainShader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 bodyMod;\nattribute float slope;\nattribute float elev;\nvarying vec3 vBody;\nvarying float vSlope;\nvarying float vElev;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBody = bodyMod;\nvSlope = slope;\nvElev = elev;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBody; varying float vSlope; varying float vElev; uniform vec3 bodySun; uniform float surfaceFill;
        float h3(vec3 p){p=mod(p,${PERIOD}.);return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
        float vnoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
          return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z)*2.-1.;}
        float octave(vec3 p,float wl,float footprint){
          float fade=1.-smoothstep(wl*.25,wl*.9,footprint);
          if(fade<=0.) return 0.;
          vec3 q=mat3(.8,.36,-.48,-.6,.48,-.64,0.,.8,.6)*(p/wl);
        #if DETAIL >= 2
          q+=.35*vec3(vnoise(q*.5+11.),vnoise(q*.5+23.),vnoise(q*.5+37.));
        #endif
          return vnoise(q)*fade;
        }`)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 orbital = texture2D(map, vMapUv);
        #else
          vec4 orbital = vec4(.62,.40,.27,1.);
        #endif
        // Orbital maps are saturated; rover true-colour ground reads butterscotch and brown.
        float luma = dot(orbital.rgb, vec3(.3,.55,.15));
        float lift = clamp(pow(luma / .07, .45), .55, 1.6);
        vec3 ground = vec3(.36,.21,.115) * lift;
        ground = mix(ground, orbital.rgb * (ground.g / max(orbital.g, .001)), .22);
        float footprint = length(fwidth(vBody));
        // The 8K orbital colour map resolves roughly 2.6 km per texel. Procedural, band-limited
        // albedo below that scale keeps the 0.5-10 km approach from becoming a blurred brown sheet.
        float macro=0.,basin=0.,n1=0.,n2=0.,n3=0.,n4=0.,n5=0.;
        #if DETAIL >= 1
          macro=octave(vBody,2600.,footprint); basin=octave(vBody,720.,footprint);
          n1=octave(vBody,180.,footprint); n2=octave(vBody,34.,footprint);
        #endif
        #if DETAIL >= 2
          n3 = octave(vBody, 6.5, footprint);
        #endif
        #if DETAIL >= 3
          n4 = octave(vBody, 1.3, footprint); n5 = octave(vBody, .32, footprint);
        #endif
        ground *= .86 + .24*macro + .16*basin;
        float steep = sqrt(max(0.,2.*vSlope));
        float rock = smoothstep(.16, .48, steep + basin*.08 + n1*.16 + n2*.1);
        float bright = smoothstep(.25,.7,n2*.6+n1*.5);
        vec3 dust = ground*mix(vec3(.95,.88,.8), vec3(1.12,1.0,.88), bright);
        vec3 bedrock = vec3(.15,.11,.09) * lift;
        // Layered bedrock: sedimentary strata banded by elevation, like Gale's Mount Sharp and canyon walls.
        float strata = sin(vElev * .42 + n1 * 2.5) * .5 + .5, strata2 = sin(vElev * 1.9 + n2 * 1.5) * .5 + .5;
        bedrock *= mix(.78, 1.22, strata * .7 + strata2 * .3);
        bedrock = mix(bedrock, bedrock * vec3(1.12, .98, .86), smoothstep(.55, .9, strata));
        float basalt = smoothstep(.38,.82,-macro*.45+basin*.28+steep*.9);
        bedrock = mix(bedrock, vec3(.105,.085,.075)*lift, basalt*.6);
        vec3 surface = mix(dust, bedrock, rock);
        surface *= .78 + .20*macro + .14*basin + .14*n1 + .12*n2 + .12*n3 + .1*n4 + .06*n5;
        // Olympus Mons: MOLA supplies the real shield and relief. A warped regional mask adds
        // restrained albedo variation without drawing geometric rings or regular radial spokes.
        float du=mod(vMapUv.x-.128333+.5,1.)-.5;
        vec2 ol=vec2(du*20180000.,(vMapUv.y-.603611)*10648450.);
        float regionNoise=vnoise(vec3(ol/92000.,13.7));
        float fineRegion=vnoise(vec3(ol/37000.,29.1));
        float warpedR=length(ol)+regionNoise*24000.+fineRegion*7000.;
        float olympus=1.-smoothstep(320000.,410000.,warpedR);
        if(olympus>.001){
          float deposits=smoothstep(-.35,.72,regionNoise*.7+fineRegion*.45);
          float summit=1.-smoothstep(65000.,155000.,warpedR);
          float brokenEdge=smoothstep(275000.,310000.,warpedR)*(1.-smoothstep(310000.,372000.,warpedR));
          surface=mix(surface,surface*vec3(.91,.87,.81),summit*(.18+.12*deposits));
          surface=mix(surface,surface*vec3(.91,.86,.79),olympus*(.06+.06*deposits));
          surface=mix(surface,surface*vec3(.72,.66,.60),brokenEdge*(.12+.12*deposits));
        }
        // Broad wind-scoured streaks and dust mantles break up the otherwise uniform orbital texels.
        float windBand = sin(dot(vBody,normalize(vec3(.83,.12,.55)))/310.+basin*2.1)*.5+.5;
        float windFade=1.-smoothstep(90.,620.,footprint);
        float mantle = smoothstep(.22,.78,windBand)*windFade*(1.-smoothstep(.035,.22,steep))*(1.-rock);
        surface *= mix(vec3(.91,.86,.82),vec3(1.08,1.025,.94),mantle*.42);
        // Wind ripples in loose sand on flat ground; they fade out before they can shimmer.
        float ripplePhase = dot(vBody, normalize(vec3(.83, .12, .55))) / 3.1 + n2 * 1.6 + n3 * .35;
        // Patchy, not everywhere: ripples gather in sand hollows, so the ground never reads as corrugated sheet.
        float ripplePatch = smoothstep(-.15, .45, basin * .6 + n1 * .5);
        float ripple = (abs(fract(ripplePhase) - .5) * 2.) * ripplePatch * (1. - rock) * (1. - smoothstep(.08, .3, steep)) * (1. - smoothstep(.4, 2.2, footprint));
        surface *= 1. - .045 * ripple * (1. - bright);
        // Lift dark orbital-map values into a photographic display range while retaining
        // all procedural albedo, bedrock, and slope variation for sunlight to model.
        // Noise may darken bedrock, but never erase the underlying regolith response.
        surface=max(surface,ground*vec3(.75,.72,.68));
        surface=pow(clamp(surface,0.,1.),vec3(.72))*1.05;
        // From high up, each pixel covers kilometres: converge on the measured orbital colours so the
        // terrain matches the globe it replaces instead of flattening into a pale procedural sheet.
        float far=smoothstep(60.,700.,footprint);
        surface=mix(surface,orbital.rgb*1.08,far);
        // Surface already contains the orbital map. Assign it directly so the source texture
        // is not multiplied a second time into near-black values.
        diffuseColor.rgb = clamp(surface, 0., 1.);
        totalEmissiveRadiance += surface*surfaceFill*(1.-.6*far);
        detailHeight = macro*10.+basin*3.5+n1*.8+n2*.9+n3*.22+n4*.05+n5*.012+rock*n3*.3+ripple*.06;
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
          float hx = dFdx(detailHeight), hy = dFdy(detailHeight);
          vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
          float det = dot(dpdx, r1);
          vec3 grad = sign(det) * (hx * r1 + hy * r2);
          normal = normalize(abs(det) * normal - grad * .7);
        }
      `)
      .replace('void main() {', 'void main() {\n float detailHeight = 0.;');
  };
  m.customProgramCacheKey = () => `mars-terrain-v17-${detail}`;
  return m;
}

function rockGeometry(seed: number) {
  const g = new T.IcosahedronGeometry(1, 2), p = g.getAttribute('position');
  let s = seed;
  const rand = () => {s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296;};
  const bumps = Array.from({length: 7}, () => [new T.Vector3(rand() - .5, rand() - .5, rand() - .5).normalize(), .15 + rand() * .3]);
  for (let i = 0; i < p.count; i++) {
    const v = new T.Vector3().fromBufferAttribute(p, i), d = v.clone().normalize();
    let r = 1;
    for (const [axis, amount] of bumps as [T.Vector3, number][]) r -= Math.max(0, d.dot(axis) - .55) * amount * 2.2;
    v.copy(d).multiplyScalar(r);
    v.y *= .62;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const flat = g.toNonIndexed(); flat.computeVertexNormals(); g.dispose();
  return flat;
}

export class SurfaceView {
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(64, 1, .4, 8e6);
  sun = new T.DirectionalLight(0xfff1dc, 2.6);
  sky = new T.HemisphereLight(0xc99e78, 0x3b2519, .75);
  ambient = new T.AmbientLight(0xb27a60, .3);
  rings = new Map<number, Ring>();
  shadowCaster = new T.Group();
  active = false;
  agl = Infinity;
  generationMs = 0;
  private anchor: Anchor | null = null;
  private map: T.Texture | null = null;
  private skyScene = new T.Scene();
  private skyCamera = new T.Camera();
  skyMaterial: T.ShaderMaterial;
  private rockMeshes: T.InstancedMesh[] = [];
  private rockAnchor: Anchor | null = null;
  private rockCentre = {e: Infinity, n: Infinity};
  private fog = new T.FogExp2(0xb08866, 0);
  private underlay = new T.Mesh(
    new T.SphereGeometry(MARS.radius * 1000 - 15000, 96, 64),
    new T.MeshBasicMaterial({color: 0x71442d, side: T.DoubleSide, fog: false})
  );
  props: Prop[] = [];
  dust = new DustSystem();
  landingLight = new T.SpotLight(0xfff0dc, 0, 1400, .42, .55, 1.4);
  devilMeshes = new DevilMeshes();
  devilsNow: Devil[] = [];
  shipMap = {x: 0, z: 0};
  storm = 0;
  private dustHeights: Float32Array | null = null;
  private lastBody: V = [0, 0, 0];
  private lastT = 0;
  private glyph: {mesh: T.Mesh; body: V; dir: V} | null = null;
  base: {group: T.Group; body: V; basis: T.Quaternion} | null = null;
  private beaconMap = (() => {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas'); c.width = c.height = 64; const k = c.getContext('2d')!, g = k.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,245,220,1)'); g.addColorStop(.25, 'rgba(255,190,110,.6)'); g.addColorStop(1, 'rgba(255,150,60,0)'); k.fillStyle = g; k.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
  })();

  constructor(private surface: MarsSurface, map: T.Texture | null) {
    this.map = map;
    const underlayMaterial = this.underlay.material as T.MeshBasicMaterial;
    underlayMaterial.map = map;
    underlayMaterial.color.set(0xffffff);
    underlayMaterial.needsUpdate = true;
    this.scene.fog = this.fog;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.normalBias = .6;
    // A solid shell below the measured terrain catches any transient LOD hole or extreme camera angle.
    this.underlay.renderOrder = -100;
    this.scene.add(this.underlay, this.sun, this.sun.target, this.sky, this.ambient, this.shadowCaster);
    const rockMaterial = new T.MeshStandardMaterial({color: 0x6a5244, roughness: .9, flatShading: true});
    for (let i = 0; i < 3; i++) {
      const mesh = new T.InstancedMesh(rockGeometry(17 + i * 31), rockMaterial, 5000);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = true;
      this.rockMeshes.push(mesh); this.scene.add(mesh);
    }
    this.skyMaterial = new T.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: {storm: {value: 0}, up: {value: new T.Vector3(0, 1, 0)}, sunDir: {value: sunDirection()}, altitude: {value: 0}, inverseProjection: {value: new T.Matrix4()}, cameraRotation: {value: new T.Matrix4()}},
      vertexShader: `varying vec2 screenUV;void main(){screenUV=uv;gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader: `precision highp float;
        varying vec2 screenUV; uniform float storm; uniform vec3 up; uniform vec3 sunDir; uniform float altitude; uniform mat4 inverseProjection; uniform mat4 cameraRotation;
        void main(){
          vec4 view=inverseProjection*vec4(screenUV*2.-1.,1.,1.);
          vec3 ray=normalize(mat3(cameraRotation)*view.xyz);
          float h=max(altitude,0.), thick=exp(-h/11100.);
          float dip=-sqrt(clamp(2.*h/3389500.,0.,1.));
          float mu=dot(ray,up), t=clamp((mu-dip)/(1.-dip),0.,1.);
          float airmass=1./(t+.04);
          float sunEl=dot(sunDir,up), cosS=dot(ray,sunDir);
          float day=smoothstep(-.28,.10,sunEl);
          vec3 zenith=vec3(.72,.55,.41), horizon=vec3(.90,.75,.60), blue=vec3(.50,.66,.88);
          vec3 base=mix(horizon,zenith,pow(t,.5));
          // Forward-scattering dust gives Mars a blue aureole around the Sun, dominant at sunset.
          float aureole=pow(max(cosS,0.),mix(10.,4.,1.-smoothstep(0.,.3,sunEl)));
          base=mix(base,blue,clamp(aureole*(.25+.75*(1.-smoothstep(0.,.45,sunEl))),0.,.85));
          float lum=day*(.5+.5*smoothstep(0.,.5,sunEl))+aureole*smoothstep(-.25,.05,sunEl)*.55;
          // Dusk: zenith and the anti-sun sky fade first; the blue glow around the Sun lingers.
          float dusk=1.-smoothstep(-.05,.35,sunEl);
          vec3 col=base*lum*1.08*mix(1.,.45+.55*aureole,dusk*.8);
          float tau=3.2*thick*min(airmass,14.);
          // A dark night sky is still thick but no longer bright, so stars and the moons show through.
          float entry=1.-smoothstep(45000.,130000.,h);
          // The real upper atmosphere is extremely thin; exaggerate its forward-scattered veil just enough
          // to make the orbital-to-atmospheric transition readable at game scale without changing physics.
          float alpha=max((1.-exp(-tau))*clamp(lum*1.6+.03,0.,1.),entry*day*(.060+.18*pow(1.-t,2.)));
          float disc=smoothstep(cos(.0062),cos(.0036),cosS);
          float glow=pow(max(cosS,0.),900.)*.8*thick;
          // Dust storm: a thick, dim, brown veil that swallows the sky and most of the Sun.
          vec3 stormCol=vec3(.46,.31,.21)*(.25+.75*day)*(1.+.25*pow(max(cosS,0.),4.));
          col=mix(col,stormCol,storm*.9); alpha=max(alpha,storm*clamp(thick*4.,0.,1.));
          col+=vec3(1.,.96,.88)*(disc*4.+glow)*(1.-storm*.85); alpha=max(alpha,disc*(1.-storm*.8));
          gl_FragColor=vec4(col,clamp(alpha+glow,0.,1.));
        }`
    });
    this.skyScene.add(new T.Mesh(new T.PlaneGeometry(2, 2), this.skyMaterial));
    this.scene.add(this.dust.group, this.devilMeshes.group, this.landingLight, this.landingLight.target);
    for (const place of LANDING_SITES) {
      const object = new T.Group(), model = createHardware(place.id);
      if (model) object.add(model);
      const beacon = new T.Sprite(new T.SpriteMaterial({map: this.beaconMap, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false}));
      beacon.name = 'beacon'; beacon.position.y = 6; object.add(beacon);
      object.visible = false; this.scene.add(object);
      this.props.push({place, dir: latLonToDir(place.lat, place.lon), object, body: null});
    }
  }

  /** The fictional Rahimli inscription, draped over the Olympus Mons caldera floor. */
  private buildGlyph() {
    const place = placeById('rahimli-glyph')!, dir = latLonToDir(place.lat, place.lon);
    const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 560;
    const k = canvas.getContext('2d')!;
    drawStencil(k, 'RAHIMLI', 1024, 40, {size: 330, weight: 1.05, tracking: 1.4, color: 'rgba(246,226,198,.95)', align: 'center'});
    drawStencil(k, 'OLYMPUS MONS', 1024, 420, {size: 100, weight: 1.1, tracking: 2, color: 'rgba(246,226,198,.8)', align: 'center'});
    const map = new T.CanvasTexture(canvas); map.colorSpace = T.SRGBColorSpace; map.anisotropy = 8;
    const anchor = makeAnchor(this.surface, dir), origin = anchor.dir.map(x => x * anchor.radius);
    const W = 32000, H = 8750, NX = 160, NY = 44, pos: number[] = [], uv: number[] = [], index: number[] = [];
    for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
      const e = (i / NX - .5) * W, n = (.5 - j / NY) * H;
      const q = [origin[0] + anchor.east[0] * e + anchor.north[0] * n, origin[1] + anchor.east[1] * e + anchor.north[1] * n, origin[2] + anchor.east[2] * e + anchor.north[2] * n];
      const l = Math.hypot(q[0], q[1], q[2]), d: V = [q[0] / l, q[1] / l, q[2] / l], r = this.surface.radiusM(d, 600) + 40;
      pos.push(d[0] * r - origin[0], d[1] * r - origin[1], d[2] * r - origin[2]); uv.push(i / NX, 1 - j / NY);
    }
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; index.push(a, b, c, b, d, c);}
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(index); g.computeVertexNormals();
    const mesh = new T.Mesh(g, new T.MeshStandardMaterial({map, transparent: true, depthWrite: false, roughness: 1, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8}));
    mesh.renderOrder = 50; mesh.frustumCulled = false; mesh.receiveShadow = true; this.scene.add(mesh);
    this.glyph = {mesh, body: origin as V, dir};
  }

  /** Clear footprint geometry when a new flight starts far away. */
  reset() {
    for (const ring of this.rings.values()) {this.scene.remove(ring.mesh); ring.mesh.geometry.dispose(); (ring.mesh.material as T.Material).dispose();}
    this.rings.clear(); this.anchor = null; this.rockAnchor = null; this.rockCentre = {e: Infinity, n: Infinity};
    this.rockMeshes.forEach(m => m.count = 0);
    this.dust.origin = null; this.dust.alive = 0; this.dustHeights = null;
  }

  private createRing(cell: number): Ring {
    const count = (N + 1) * (N + 1), g = new T.BufferGeometry();
    g.setIndex(new T.BufferAttribute(new Uint16Array(N * N * 6), 1).setUsage(T.DynamicDrawUsage));
    for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['bodyMod', 3], ['slope', 1], ['elev', 1]] as const) g.setAttribute(name, new T.BufferAttribute(new Float32Array(count * size), size).setUsage(T.DynamicDrawUsage));
    const mesh = new T.Mesh(g, terrainMaterial(this.map, cell));
    mesh.frustumCulled = false; mesh.renderOrder = Math.log2(cell); mesh.visible = false;
    mesh.receiveShadow = true; mesh.castShadow = cell <= 64;
    this.scene.add(mesh);
    const ring = {cell, mesh, anchor: null, ce: NaN, cn: NaN, dirty: true, hole: ''};
    this.writeIndex(ring, null);
    return ring;
  }

  /**
   * Triangles, skipping the cells covered by the next finer ring. With a logarithmic depth buffer the GPU
   * cannot reject hidden fragments early, so overlapping rings would each run the full ground shader.
   */
  private writeIndex(ring: Ring, hole: {i0: number; i1: number; j0: number; j1: number} | null) {
    const index = ring.mesh.geometry.index!, data = index.array as Uint16Array;
    let n = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (hole && i >= hole.i0 && i < hole.i1 && j >= hole.j0 && j < hole.j1) continue;
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      data[n++] = a; data[n++] = b; data[n++] = c; data[n++] = b; data[n++] = d; data[n++] = c;
    }
    ring.mesh.geometry.setDrawRange(0, n);
    index.needsUpdate = true;
  }
  private updateHoles(wanted: number[]) {
    for (const cell of wanted) {
      const ring = this.rings.get(cell)!, finer = this.rings.get(cell / 2);
      let key = '', hole = null;
      if (ring.anchor && !ring.dirty && finer && finer.anchor && !finer.dirty && finer.mesh.visible) {
        const f = finer.anchor, o = f.dir.map(x => x * f.radius);
        const centre: V = [o[0] + f.east[0] * finer.ce + f.north[0] * finer.cn, o[1] + f.east[1] * finer.ce + f.north[1] * finer.cn, o[2] + f.east[2] * finer.ce + f.north[2] * finer.cn];
        const {e, n} = planeCoords(ring.anchor, centre), half = (N / 2 - 2) * finer.cell;
        const i0 = Math.ceil((e - half - ring.ce) / ring.cell + N / 2), i1 = Math.floor((e + half - ring.ce) / ring.cell + N / 2);
        const j0 = Math.ceil((n - half - ring.cn) / ring.cell + N / 2), j1 = Math.floor((n + half - ring.cn) / ring.cell + N / 2);
        if (i1 > i0 && j1 > j0) {hole = {i0: Math.max(0, i0), i1: Math.min(N, i1), j0: Math.max(0, j0), j1: Math.min(N, j1)}; key = `${hole.i0},${hole.i1},${hole.j0},${hole.j1}`;}
      }
      if (key !== ring.hole) {ring.hole = key; this.writeIndex(ring, hole);}
    }
  }

  private generate(ring: Ring, anchor: Anchor, ce: number, cn: number) {
    const g = ring.mesh.geometry, pos = g.getAttribute('position') as T.BufferAttribute, uv = g.getAttribute('uv') as T.BufferAttribute;
    const mod = g.getAttribute('bodyMod') as T.BufferAttribute, slope = g.getAttribute('slope') as T.BufferAttribute, nor = g.getAttribute('normal') as T.BufferAttribute, elev = g.getAttribute('elev') as T.BufferAttribute;
    const s = ring.cell, a = anchor, origin = [a.dir[0] * a.radius, a.dir[1] * a.radius, a.dir[2] * a.radius];
    const wrap = origin.map(x => Math.round(x / PERIOD) * PERIOD);
    const anchorLon = dirToLatLon(a.dir).lon;
    const px = new Float64Array((N + 1) ** 2 * 3), dirs = new Float64Array((N + 1) ** 2 * 3);
    const minWave = Math.max(2, s * 2);
    for (let j = 0, k = 0; j <= N; j++) for (let i = 0; i <= N; i++, k++) {
      const e = ce + (i - N / 2) * s, n = cn + (j - N / 2) * s;
      let x = origin[0] + a.east[0] * e + a.north[0] * n, y = origin[1] + a.east[1] * e + a.north[1] * n, z = origin[2] + a.east[2] * e + a.north[2] * n;
      const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
      const r = this.surface.radiusM([x, y, z], minWave);
      px[k * 3] = x * r; px[k * 3 + 1] = y * r; px[k * 3 + 2] = z * r;
      dirs[k * 3] = x; dirs[k * 3 + 1] = y; dirs[k * 3 + 2] = z;
      pos.setXYZ(k, px[k * 3] - origin[0], px[k * 3 + 1] - origin[1], px[k * 3 + 2] - origin[2]);
      elev.setX(k, r - 3389500);
      mod.setXYZ(k, px[k * 3] - wrap[0], px[k * 3 + 1] - wrap[1], px[k * 3 + 2] - wrap[2]);
      const ll = dirToLatLon([x, y, z]);
      let du = (ll.lon - anchorLon); du -= Math.round(du / 360) * 360;
      uv.setXY(k, .5 + (anchorLon + du) / 360, .5 + ll.lat / 180);
    }
    const P = (i: number, j: number) => {i = Math.max(0, Math.min(N, i)); j = Math.max(0, Math.min(N, j)); return (j * (N + 1) + i) * 3;};
    const u = new T.Vector3(), v = new T.Vector3(), nrm = new T.Vector3();
    for (let j = 0, k = 0; j <= N; j++) for (let i = 0; i <= N; i++, k++) {
      const r1 = P(i + 1, j), l1 = P(i - 1, j), t1 = P(i, j + 1), b1 = P(i, j - 1);
      u.set(px[r1] - px[l1], px[r1 + 1] - px[l1 + 1], px[r1 + 2] - px[l1 + 2]);
      v.set(px[t1] - px[b1], px[t1 + 1] - px[b1 + 1], px[t1 + 2] - px[b1 + 2]);
      nrm.crossVectors(v, u).normalize();
      if (nrm.x * dirs[k * 3] + nrm.y * dirs[k * 3 + 1] + nrm.z * dirs[k * 3 + 2] < 0) nrm.negate();
      nor.setXYZ(k, nrm.x, nrm.y, nrm.z);
      slope.setX(k, 1 - (nrm.x * dirs[k * 3] + nrm.y * dirs[k * 3 + 1] + nrm.z * dirs[k * 3 + 2]));
    }
    for (const attr of [pos, uv, mod, slope, nor, elev]) attr.needsUpdate = true;
    ring.anchor = anchor; ring.ce = ce; ring.cn = cn; ring.dirty = false; ring.mesh.visible = true;
  }

  private placeRocks(anchor: Anchor, shipBody: V) {
    const {e, n} = planeCoords(anchor, shipBody), cell = 3.2, radius = 300;
    const origin = anchor.dir.map(x => x * anchor.radius);
    const counts = [0, 0, 0], matrix = new T.Matrix4(), q = new T.Quaternion(), scale = new T.Vector3();
    const hash = (x: number, y: number, s: number) => {let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(s, 0x9e3779b1); h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;};
    const x0 = Math.floor((e - radius) / cell), x1 = Math.floor((e + radius) / cell), y0 = Math.floor((n - radius) / cell), y1 = Math.floor((n + radius) / cell);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (hash(x, y, 1) > .16) continue;
      const re = (x + hash(x, y, 2)) * cell, rn = (y + hash(x, y, 3)) * cell;
      if ((re - e) ** 2 + (rn - n) ** 2 > radius * radius) continue;
      const kind = Math.floor(hash(x, y, 4) * 3), mesh = this.rockMeshes[kind];
      if (counts[kind] >= mesh.instanceMatrix.count) continue;
      const size = .16 * Math.pow(1 / (1 - hash(x, y, 5) * .992), .6);
      const p = [origin[0] + anchor.east[0] * re + anchor.north[0] * rn, origin[1] + anchor.east[1] * re + anchor.north[1] * rn, origin[2] + anchor.east[2] * re + anchor.north[2] * rn];
      const l = Math.hypot(p[0], p[1], p[2]), d: V = [p[0] / l, p[1] / l, p[2] / l];
      if (this.surface.flatWeight(d) < .98) continue; // cleared sites and the base
      const r = this.surface.radiusM(d, 2) - size * .3;
      const up = new T.Vector3(...d);
      q.setFromUnitVectors(new T.Vector3(0, 1, 0), up).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), hash(x, y, 6) * 6.28));
      scale.set(size * (.8 + hash(x, y, 7) * .6), size, size * (.8 + hash(x, y, 8) * .6));
      matrix.compose(new T.Vector3(d[0] * r - origin[0], d[1] * r - origin[1], d[2] * r - origin[2]), q, scale);
      mesh.setMatrixAt(counts[kind]++, matrix);
    }
    this.rockMeshes.forEach((m, i) => {m.count = counts[i]; m.instanceMatrix.needsUpdate = true;});
    this.rockAnchor = anchor; this.rockCentre = {e, n};
  }

  /**
   * shipKm: inertial ship position (km). cameraOffsetM: camera position relative to the ship (inertial metres).
   * Returns false when the ship is too high for close-range rendering.
   */
  update(shipKm: V, t: number, camera: T.PerspectiveCamera, cameraOffsetM: T.Vector3, speedMs: number) {
    const inertialM: V = [shipKm[0] * 1000, shipKm[1] * 1000, shipKm[2] * 1000];
    const body = inertialToBody(inertialM, t, MARS.rotation), l = Math.hypot(...body);
    this.lastBody = body; this.lastT = t;
    const dirBody: V = [body[0] / l, body[1] / l, body[2] / l];
    this.agl = l - this.surface.radiusM(dirBody, 8);
    this.active = this.agl < ACTIVE_ALTITUDE;
    if (!this.active) return false;
    this.underlay.position.set(-shipKm[0] * 1000, -shipKm[1] * 1000, -shipKm[2] * 1000);

    if (!this.anchor || Math.abs(planeCoords(this.anchor, body).e) > 30000 || Math.abs(planeCoords(this.anchor, body).n) > 30000) this.anchor = makeAnchor(this.surface, body);
    const anchor = this.anchor, {e, n} = planeCoords(anchor, body);
    const horizon = Math.sqrt(2 * MARS.radius * 1000 * Math.max(this.agl, 1)) + 160000;
    const finest = 2 ** Math.round(Math.log2(Math.min(2048, Math.max(1, this.agl / 18, speedMs * .04))));
    const wanted: number[] = [];
    for (let cell = finest; wanted.length < 14; cell *= 2) {wanted.push(cell); if (cell * N / 2 > horizon) break;}

    for (const cell of wanted) if (!this.rings.has(cell)) this.rings.set(cell, this.createRing(cell));
    for (const cell of wanted) {
      const ring = this.rings.get(cell)!, step = ring.cell * 12;
      const own = ring.anchor ? planeCoords(ring.anchor, body) : {e, n};
      if (!ring.anchor || ring.dirty || Math.abs(own.e - ring.ce) > step * 1.01 || Math.abs(own.n - ring.cn) > step * 1.01) ring.dirty = true;
    }
    const started = performance.now();
    for (const cell of wanted) {
      const ring = this.rings.get(cell)!;
      if (!ring.dirty) continue;
      const step = ring.cell * 12;
      this.generate(ring, anchor, Math.round(e / step) * step, Math.round(n / step) * step);
      if (performance.now() - started > 14) break;
    }
    this.generationMs = performance.now() - started;
    this.updateHoles(wanted);
    const allReady = wanted.every(c => !this.rings.get(c)!.dirty);
    for (const [cell, ring] of this.rings) if (!wanted.includes(cell) && (allReady || cell > wanted[wanted.length - 1] * 2)) {
      this.scene.remove(ring.mesh); ring.mesh.geometry.dispose(); (ring.mesh.material as T.Material).dispose(); this.rings.delete(cell);
    }

    // Place every ring by its own anchor: body-fixed metres relative to the ship, rotated into the inertial frame.
    const planet = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), t / MARS.rotation * Math.PI * 2);
    this.underlay.quaternion.copy(planet);
    const place = (object: T.Object3D, a: Anchor) => {
      const delta: V = [a.dir[0] * a.radius - body[0], a.dir[1] * a.radius - body[1], a.dir[2] * a.radius - body[2]];
      object.position.set(...bodyToInertial(delta, t, MARS.rotation));
      object.quaternion.copy(planet);
    };
    for (const ring of this.rings.values()) if (ring.anchor) place(ring.mesh, ring.anchor);

    const rocksWanted = this.agl < 1800;
    if (rocksWanted) {
      const moved = this.rockAnchor ? planeCoords(this.rockAnchor, body) : null;
      if (!moved || Math.hypot(moved.e - this.rockCentre.e, moved.n - this.rockCentre.n) > 90) this.placeRocks(anchor, body);
      if (this.rockAnchor) this.rockMeshes.forEach(m => place(m, this.rockAnchor!));
    }
    this.rockMeshes.forEach(m => m.visible = rocksWanted);

    const bodyQ = new T.Quaternion();
    for (const prop of this.props) {
      const far = (prop.dir[0] * body[0] + prop.dir[1] * body[1] + prop.dir[2] * body[2]) / l < Math.cos(80 / 3389.5);
      if (far) {prop.object.visible = false; continue;}
      prop.body ??= prop.dir.map(x => x * this.surface.radiusM(prop.dir, 2)) as V;
      const delta: V = [prop.body[0] - body[0], prop.body[1] - body[1], prop.body[2] - body[2]], distance = Math.hypot(...delta);
      prop.object.visible = distance < 60000;
      if (!prop.object.visible) continue;
      prop.object.position.set(...bodyToInertial(delta, t, MARS.rotation));
      prop.object.quaternion.copy(planet).multiply(bodyQ.setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(...prop.dir)));
      const beacon = prop.object.getObjectByName('beacon')!;
      beacon.scale.setScalar(Math.max(1.5, distance * .009)); beacon.visible = distance > 250 && (performance.now() % 1600) < 900;
    }
    const baseDir = latLonToDir(BASE.lat, BASE.lon);
    const baseNear = (baseDir[0] * body[0] + baseDir[1] * body[1] + baseDir[2] * body[2]) / l > Math.cos(160 / 3389.5);
    if (baseNear && !this.base && typeof document !== 'undefined') {
      const group = createBase(), r = this.surface.radiusM(baseDir, 2);
      const beacon = new T.Sprite(new T.SpriteMaterial({map: this.beaconMap, color: 0xff6a50, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false}));
      beacon.name = 'base-beacon'; beacon.position.set(10, 42, 70); group.add(beacon);
      this.scene.add(group);
      this.base = {group, body: baseDir.map(x => x * r) as V, basis: new T.Quaternion().setFromRotationMatrix(baseBasis().matrix)};
    }
    if (this.base) {
      this.base.group.visible = baseNear;
      if (baseNear) {
        const b = this.base.body, delta: V = [b[0] - body[0], b[1] - body[1], b[2] - body[2]];
        this.base.group.position.set(...bodyToInertial(delta, t, MARS.rotation));
        this.base.group.quaternion.copy(planet).multiply(this.base.basis);
        (this.base.group.userData.update as (time: number, darkness: number) => void)(performance.now() / 1000, 1 - this.daylight);
        const beacon = this.base.group.getObjectByName('base-beacon')!, range = Math.hypot(...delta);
        beacon.scale.setScalar(Math.max(4, range * .03)); beacon.visible = range > 600 && (performance.now() % 1400) < 700;
      }
    }
    const glyphPlace = placeById('rahimli-glyph')!, glyphDir = latLonToDir(glyphPlace.lat, glyphPlace.lon);
    const glyphNear = (glyphDir[0] * body[0] + glyphDir[1] * body[1] + glyphDir[2] * body[2]) / l > Math.cos(900 / 3389.5);
    if (glyphNear && !this.glyph) this.buildGlyph();
    if (this.glyph) {this.glyph.mesh.visible = glyphNear; if (glyphNear) place(this.glyph.mesh, {dir: this.glyph.dir, east: [0, 0, 0], north: [0, 0, 0], radius: Math.hypot(...this.glyph.body)});}
    const up = new T.Vector3(...bodyToInertial(dirBody, t, MARS.rotation));
    const sun = sunDirection();
    const bodySun = new T.Vector3(...inertialToBody(sun.toArray() as V, t, MARS.rotation)).normalize();
    const sunEl = sun.dot(up), day = T.MathUtils.smoothstep(sunEl, -.15, .12);
    for (const ring of this.rings.values()) {
      const shader = (ring.mesh.material as T.MeshStandardMaterial).userData.terrainShader;
      if (shader?.uniforms?.bodySun) shader.uniforms.bodySun.value.copy(bodySun);
      if (shader?.uniforms?.surfaceFill) shader.uniforms.surfaceFill.value = .055 + .18 * day;
    }
    this.daylight = day;
    this.sun.intensity = 2.2 * day;
    this.sky.intensity = .28 + .58 * day;
    this.ambient.intensity = .16 + .32 * day;
    const shadowSize = T.MathUtils.clamp(this.agl * 3, 900, 7000);
    // Keep the shadow depth range tight around the ship. A 60 km range made the depth bias worth ~24 m,
    // which erased every shadow cast by the ship and the base.
    const reach = shadowSize * 2 + Math.max(0, this.agl) * 2 + 1000;
    this.sun.position.copy(sun).multiplyScalar(reach);
    const sc = this.sun.shadow.camera as T.OrthographicCamera;
    sc.left = sc.bottom = -shadowSize; sc.right = sc.top = shadowSize; sc.near = 1; sc.far = reach * 2;
    this.sun.shadow.bias = -.25 / sc.far;
    this.sun.shadow.normalBias = shadowSize / 3000;
    sc.updateProjectionMatrix();
    this.sun.target.position.set(0, 0, 0);

    const thick = Math.exp(-Math.max(0, this.agl) / 11100);
    this.fog.color.setRGB(.86 * (.35 + .65 * day), .71 * (.35 + .65 * day), .57 * (.35 + .65 * day), T.SRGBColorSpace);
    this.fog.density = 2.6e-5 * thick ** .8 + 1.5e-7;

    this.camera.fov = camera.fov; this.camera.aspect = camera.aspect; this.camera.updateProjectionMatrix();
    this.camera.position.copy(cameraOffsetM);
    this.camera.quaternion.copy(camera.quaternion);
    this.camera.updateMatrixWorld();
    this.skyMaterial.uniforms.up.value.copy(up);
    this.skyMaterial.uniforms.sunDir.value.copy(sun);
    this.skyMaterial.uniforms.altitude.value = l - MARS.radius * 1000;
    this.skyMaterial.uniforms.inverseProjection.value.copy(this.camera.projectionMatrixInverse);
    this.skyMaterial.uniforms.cameraRotation.value.copy(this.camera.matrixWorld);
    return true;
  }


  // ---------------------------------------------------------------- dust

  private groundFrame(bodyP: V) {
    const o = this.dust.origin!, d = new T.Vector3(bodyP[0] - o[0], bodyP[1] - o[1], bodyP[2] - o[2]), {east, up, north} = this.dust.axes;
    return new T.Vector3(d.dot(east), d.dot(up), d.dot(north));
  }
  /** Ground height in the dust frame: cached 8 m grid within ±256 m, exact beyond. */
  private groundAt = (x: number, z: number) => {
    const o = this.dust.origin!, r0 = Math.hypot(...o), {east, north} = this.dust.axes;
    const exact = (gx: number, gz: number) => {
      const q: V = [o[0] + east.x * gx + north.x * gz, o[1] + east.y * gx + north.y * gz, o[2] + east.z * gx + north.z * gz];
      return this.surface.radiusM(q, 4) - r0;
    };
    const fx = (x + 256) / 8, fz = (z + 256) / 8;
    if (!this.dustHeights || fx < 0 || fz < 0 || fx >= 64 || fz >= 64) return exact(x, z);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, h = this.dustHeights, at = (i: number, j: number) => h[j * 65 + i];
    return (at(ix, iz) * (1 - tx) + at(ix + 1, iz) * tx) * (1 - tz) + (at(ix, iz + 1) * (1 - tx) + at(ix + 1, iz + 1) * tx) * tz;
  };
  private rebaseDust(bodyP: V) {
    const l = Math.hypot(...bodyP), dir: V = [bodyP[0] / l, bodyP[1] / l, bodyP[2] / l];
    const r = this.surface.radiusM(dir, 4);
    this.dust.setOrigin([dir[0] * r, dir[1] * r, dir[2] * r]);
    this.dustHeights = null;
    const heights = new Float32Array(65 * 65);
    for (let j = 0; j <= 64; j++) for (let i = 0; i <= 64; i++) heights[j * 65 + i] = this.groundAt(-256 + i * 8, -256 + j * 8);
    this.dustHeights = heights;
  }

  /**
   * Exhaust jets as inertial directions (unit) with power; skim is the low-pass rooster tail.
   * Call after update() so the ship's body position is current.
   */
  stepDust(dt: number, jets: {dir: T.Vector3; power: number; reach: number}[], skim: {speed: number; dir: T.Vector3} | null, wind: {e: number; n: number} = {e: 1.6, n: .9}) {
    const body = this.lastBody, t = this.lastT;
    const wanted = this.active && this.agl < 1500 && (jets.some(j => j.power > .01) || (skim && this.agl < 30) || (this.storm > .1 && this.agl < 800));
    if (!this.dust.origin && !wanted) {this.dust.group.visible = false; return;}
    if (!this.dust.origin) this.rebaseDust(body);
    let ship = this.groundFrame(body);
    const horizontal = Math.hypot(ship.x, ship.z);
    if ((horizontal > 180 && this.dust.alive === 0 && wanted) || horizontal > 700) {
      if (!wanted && horizontal > 700) {this.dust.origin = null; this.dust.alive = 0; this.dust.group.visible = false; return;}
      this.rebaseDust(body); ship = this.groundFrame(body);
    }
    const toFrame = (v: T.Vector3) => {const b = inertialToBody(v.toArray() as V, t, MARS.rotation); const w = new T.Vector3(...b); return new T.Vector3(w.dot(this.dust.axes.east), w.dot(this.dust.axes.up), w.dot(this.dust.axes.north)).normalize();};
    const emitters = wanted ? jets.map(j => ({dir: toFrame(j.dir), power: j.power, reach: j.reach})) : [];
    const skimFrame = wanted && skim ? {speed: skim.speed, agl: this.agl, dir: (() => {const d = toFrame(skim.dir); d.y = 0; return d.normalize();})()} : null;
    this.dust.wind.set(wind.e, 0, wind.n);
    if (wanted && this.storm > .1) {
      const n = Math.floor(this.storm * 110 * Math.min(dt, .05) + Math.random());
      for (let i = 0; i < n; i++) {
        const x = ship.x + (Math.random() - .5) * 160 - wind.e * 2, z = ship.z + (Math.random() - .5) * 160 - wind.n * 2;
        const g = this.groundAt(x, z), y = g + Math.random() * Math.min(60, Math.max(8, ship.y - g + 20));
        this.dust.spawn(x, y, z, wind.e, (Math.random() - .5) * 2, wind.n, 4 + Math.random() * 7, 2.5 + Math.random() * 2, .1 + .12 * this.storm, 1.5);
      }
    }
    this.dust.update(dt, ship, this.groundAt, emitters, skimFrame);
    this.dust.group.visible = this.dust.alive > 0;
    const o = this.dust.origin!, delta: V = [o[0] - body[0], o[1] - body[1], o[2] - body[2]];
    this.dust.group.position.set(...bodyToInertial(delta, t, MARS.rotation));
    this.dust.group.quaternion.setFromAxisAngle(new T.Vector3(0, 1, 0), t / MARS.rotation * Math.PI * 2);
    const u = this.dust.material.uniforms, day = Math.max(.25, Math.min(1, this.sun.intensity / 2.2));
    (u.fogColor.value as T.Color).copy(this.fog.color); u.fogDensity.value = this.fog.density;
    (u.lit.value as T.Color).setRGB(.9 * day, .7 * day, .53 * day); (u.shade.value as T.Color).setRGB(.55 * day + .08, .41 * day + .06, .32 * day + .05);
    (u.sunView.value as T.Vector3).copy(sunDirection()).transformDirection(this.camera.matrixWorldInverse);
  }

  /** Weather visuals and devil placement. Call after update(). */
  stepWeather(weather: Weather, t: number) {
    this.placeGate(t);
    const body = this.lastBody, {lat, lon} = dirToLatLon(body), R = MARS.radius * 1000;
    const latR = lat * Math.PI / 180, lonR = lon * Math.PI / 180;
    this.shipMap = {x: lonR * R * Math.cos(latR), z: latR * R};
    this.storm = weather.storm;
    const nearby = this.active && this.agl < 30000 ? weather.devils(this.shipMap.x, this.shipMap.z, t, this.daylight).filter(d => Math.hypot(d.x - this.shipMap.x, d.z - this.shipMap.z) < 30000) : [];
    this.devilsNow = nearby;
    this.devilMeshes.set(nearby, (x, z) => {
      const la = z / R, lo = x / (R * Math.cos(latR)), dir = latLonToDir(la * 180 / Math.PI, lo * 180 / Math.PI), r = this.surface.radiusM(dir, 60);
      const delta: V = [dir[0] * r - body[0], dir[1] * r - body[1], dir[2] * r - body[2]];
      return {position: new T.Vector3(...bodyToInertial(delta, t, MARS.rotation)), up: new T.Vector3(...bodyToInertial(dir, t, MARS.rotation))};
    }, performance.now() / 1000);
    const u = this.devilMeshes.material.uniforms; (u.fogColor.value as T.Color).copy(this.fog.color); u.fogDensity.value = this.fog.density;
    if (this.storm > .01) {
      // Visibility near a kilometre at the ground, thinning with height; haze colour matches the storm sky.
      this.fog.density = this.fog.density * (1 - this.storm) + this.storm * (6.5e-4 * Math.exp(-Math.max(0, this.agl) / 6000) + 4e-5);
      const k = .25 + .75 * this.daylight;
      this.fog.color.lerp(new T.Color().setRGB(.46 * k, .31 * k, .21 * k, T.SRGBColorSpace), this.storm);
      this.sun.intensity *= 1 - .75 * this.storm; this.sky.intensity *= 1 - .3 * this.storm;
    }
    this.skyMaterial.uniforms.storm.value = this.storm * Math.exp(-Math.max(0, this.agl) / 25000);
  }

  /** Nose-down landing lights after dark or in a storm. */
  setLandingLights(rotation: T.Quaternion, gearDown: boolean) {
    const need = Math.max(1 - this.daylight, this.storm * .8);
    const on = this.active && this.agl < 3000 && need > .2;
    const forward = new T.Vector3(0, 0, -1).applyQuaternion(rotation), down = new T.Vector3(0, -1, 0).applyQuaternion(rotation);
    this.landingLight.position.copy(down).multiplyScalar(2.5);
    this.landingLight.target.position.copy(forward.multiplyScalar(gearDown ? 20 : 60)).addScaledVector(down, 40);
    this.landingLight.intensity = on ? 2.2e5 * need : 0;
  }

  /** Footpad prints from ship-relative inertial offsets (m). */
  markPrints(offsets: T.Vector3[]) {
    if (!this.active || this.agl > 30) return;
    if (!this.dust.origin) this.rebaseDust(this.lastBody);
    const ship = this.groundFrame(this.lastBody), {east, up, north} = this.dust.axes;
    for (const o of offsets) {
      const b = new T.Vector3(...inertialToBody(o.toArray() as V, this.lastT, MARS.rotation));
      const x = ship.x + b.dot(east), z = ship.z + b.dot(north);
      this.dust.mark(x, this.groundAt(x, z) + b.dot(up) * 0, z, 1.6, .55, true);
    }
  }

  // ---------------------------------------------------------------- mission gates
  private gate: {mesh: T.Mesh; place: {lat: number; lon: number; agl?: number}} | null = null;
  setGate(place: {lat: number; lon: number; agl?: number} | null) {
    if (!place) {if (this.gate) this.gate.mesh.visible = false; if (this.gate) this.gate.place = {lat: 0, lon: 0}; return;}
    if (!this.gate) {
      const mesh = new T.Mesh(new T.TorusGeometry(1, .035, 12, 64), new T.MeshBasicMaterial({color: 0x9ff5c8, transparent: true, opacity: .85, blending: T.AdditiveBlending, depthWrite: false, fog: false}));
      mesh.frustumCulled = false; mesh.renderOrder = 70; this.scene.add(mesh);
      this.gate = {mesh, place};
    }
    this.gate.place = place; this.gate.mesh.visible = true;
  }
  private placeGate(t: number) {
    if (!this.gate || !this.gate.mesh.visible || !this.gate.place.lat && !this.gate.place.lon) return;
    const dir = latLonToDir(this.gate.place.lat, this.gate.place.lon), r = this.surface.radiusM(dir, 200) + (this.gate.place.agl ?? 0);
    const body = this.lastBody, delta: V = [dir[0] * r - body[0], dir[1] * r - body[1], dir[2] * r - body[2]];
    const pos = new T.Vector3(...bodyToInertial(delta, t, MARS.rotation)), up = new T.Vector3(...bodyToInertial(dir, t, MARS.rotation));
    const toShip = pos.clone().negate().addScaledVector(up, pos.dot(up)).normalize();
    this.gate.mesh.position.copy(pos);
    this.gate.mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), toShip.lengthSq() > 0 ? toShip : new T.Vector3(1, 0, 0));
    const size = Math.max(60, (this.gate.place as {radius?: number}).radius ?? 160);
    this.gate.mesh.scale.setScalar(size);
    (this.gate.mesh.material as T.MeshBasicMaterial).opacity = .55 + .35 * Math.sin(performance.now() / 300);
  }

  /** One-off blasts: gentle touchdown puff or a crash cloud under the ship. */
  dustBurst(kind: 'touchdown' | 'crash') {
    if (!this.active || this.agl > 60) return;
    if (!this.dust.origin) this.rebaseDust(this.lastBody);
    const ship = this.groundFrame(this.lastBody), g = this.groundAt(ship.x, ship.z);
    if (kind === 'touchdown') this.dust.burst(ship.x, g, ship.z, 90, 14, 3, .45, 4.5);
    else {this.dust.burst(ship.x, g, ship.z, 320, 45, 7, .8, 9); this.dust.burst(ship.x, g + 4, ship.z, 120, 12, 12, .6, 12);}
  }

  /** How strongly the sky hides space: 0 in orbit, ~1 on the ground. */
  skyOpacity() {return this.active ? Math.exp(-Math.max(0, this.agl) / 22000) : 0;}
  /** Sky opacity weighted by daylight: what actually hides the stars. */
  skyBrightness() {return this.skyOpacity() * this.daylight;}
  /** Sunlit sky glow that hides stars. Scattered light washes stars out well above the dense air. */
  starWash() {return this.active ? Math.exp(-Math.max(0, this.agl) / 45000) * this.daylight : 0;}
  daylight = 1;

  renderSky(renderer: T.WebGLRenderer) {
    if (!this.active) return;
    renderer.autoClear = false;
    renderer.render(this.skyScene, this.skyCamera);
  }
  renderTerrain(renderer: T.WebGLRenderer) {
    if (!this.active) return;
    renderer.autoClear = false;
    renderer.clear(false, true, true);
    renderer.render(this.scene, this.camera);
  }
}
