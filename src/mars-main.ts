import * as T from 'three';
import './style.css';
import './mars-ui.css';
import {MarsScene,CAMERA_NAMES} from './mars-scene';
import {FlightAudio} from './audio';
import {rendezvousCommand} from './mars-guidance';
import {MARS,MARS_MOONS,marsInitial,marsMoonState,type MarsState} from './mars';
import {add,mul,len,dot,type V} from './vector';
import {VEHICLE,FlightControl,advanceFlight,descentAssist,entryAttitude,atmosphereVelocity,localUp,type FlightInput,type FlightTelemetry} from './mars-flight';
import {latLonToDir} from './mars-geo';
import {sunDirection} from './mars-surface';
import {Hud,Glare} from './hud';
import {BASE,padLatLon} from './mars-base';
import {MISSIONS,CANYON_START,scoreMission,bestScore,saveBest,type Mission} from './mars-missions';
import {Weather,WEATHER_NAMES,windToInertial,type WeatherMode} from './mars-weather';
import {inertialToBody as toBody} from './mars-geo';
import {drawStencil} from './rahimli-font';
import {PLACES,LANDING_SITES,placeById,type Place} from './mars-atlas';
import {orbitOf,predictPath,arrivalState,type Orbit} from './mars-orbit';
import {dirToLatLon,inertialToBody} from './mars-geo';
import {publicAsset} from './assets';

const $ = (id: string) => document.getElementById(id)!;
document.body.className = 'mars-ui';
const SCENARIOS: [string, string][] = [
  ['base-pad', 'Jezero Base · on Pad 1'],
  ['base-approach', 'Jezero Base · approach'],
  ['arrival', 'Arrival & capture'],
  ['olympus-overview', 'Olympus Mons · orbital overview'],
  ['olympus-scarp', 'Olympus Mons · escarpment run'],
  ['olympus', 'Olympus Mons summit'],
  ['jezero', 'Jezero approach'],
  ['canyon', 'Valles Marineris run'],
  ['landing', 'Final descent · Jezero'],
  ['surface', 'Landed at Jezero'],
  ['entry', 'Atmospheric entry'],
  ['orbit', 'Low Mars orbit'],
  ['phobos', 'Phobos departure'],
  ['deimos', 'Deimos encounter'],
];
document.querySelector('#app')!.innerHTML = `
<div id="universe"></div>
<header><a class="brand" href="${import.meta.env.BASE_URL}" aria-label="Pathfinder Mars"><canvas id="wordmark" width="520" height="64"></canvas><i>MSV-01 · MARS EXPEDITION</i></a><div class="header-actions"><button id="menu" class="compact-only" aria-expanded="false">Menu</button><button id="sound">Sound off</button><button id="markings" class="active">Marks · essential</button><button id="labels" class="active">Labels · smart</button><button id="clean"><kbd>H</kbd>Clean view</button><button id="stars" class="active">Stars</button><button id="help">Flight guide</button></div></header>
<nav class="view-tabs" aria-label="Camera modes">${CAMERA_NAMES.map((n, i) => `<button data-camera="${i}">${n}</button>`).join('')}</nav>
<section class="mission card"><div class="card-head"><span class="eyebrow">Mission</span><span id="mission-state" class="state">Loading MOLA terrain…</span></div><div class="scenario-row"><label class="sr-only" for="scenario">Start</label><select id="scenario">${SCENARIOS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select><button id="reset" class="primary">New flight</button></div><div class="scenario-row mission-row"><label class="sr-only" for="mission-pick">Mission</label><select id="mission-pick"><option value="">Free flight</option>${MISSIONS.map(m => `<option value="${m.id}">${m.title}</option>`).join('')}</select><button id="mission-start">Start mission</button></div><div class="weather-row"><span class="eyebrow">Weather</span><div class="segmented" id="weather">${(Object.keys(WEATHER_NAMES) as WeatherMode[]).map(k => `<button data-weather="${k}">${WEATHER_NAMES[k]}</button>`).join('')}</div></div><div class="lighting-row"><label class="eyebrow" for="lighting">Local time</label><select id="lighting" title="Choose the local sunlight and sky"><option value="sunrise">Sunrise</option><option value="day" selected>Day</option><option value="sunset">Sunset</option><option value="evening">Evening</option><option value="night">Night</option></select></div><div id="mission-panel" hidden><p id="mission-brief"></p><ol id="objectives"></ol><p id="mission-clock"></p></div></section>
<section class="telemetry card"><div class="card-head"><span class="eyebrow">Telemetry</span></div><div class="primary-value"><strong id="speed">0</strong><span id="speed-unit">m/s</span></div><div class="measure-label" id="speed-label">AIRSPEED</div><div class="metric"><span>RADAR ALTITUDE</span><b id="altitude"></b></div><div class="metric"><span>VERTICAL SPEED</span><b id="vs"></b></div><div class="metric"><span>FUEL</span><b id="fuel"></b></div><div class="metric"><span>G LOAD</span><b id="g"></b></div><div class="metric"><span>HULL TEMP</span><b id="heat"></b></div><div class="divider"></div><label class="target-label"><span class="eyebrow">Target</span><select id="target"><optgroup label="Bodies"><option value="-1">Mars</option><option value="0">Phobos</option><option value="1">Deimos</option></optgroup><optgroup label="Landing sites">${LANDING_SITES.map(p => `<option value="place:${p.id}">${p.name}</option>`).join('')}</optgroup><optgroup label="Features">${PLACES.filter(p => p.kind !== 'site' && p.kind !== 'crash').map(p => `<option value="place:${p.id}">${p.name}</option>`).join('')}</optgroup></select></label><p id="target-range"></p><p id="target-note"></p><p id="orbit-readout"></p><div class="button-pair"><button id="face">Face</button><button id="rendezvous">Rendezvous</button></div><p id="guidance-state">MANUAL FLIGHT</p></section>
<section class="nav-panel card"><div class="card-head"><span class="eyebrow">Map</span><button id="map-mode" class="ghost">Surface map</button></div><canvas id="map" width="300" height="220"></canvas><div class="map-foot" id="map-foot">CLICK A SITE TO SET TARGET</div></section>
<div id="stick"><i></i></div><div id="tooltip" role="tooltip"></div><div id="warning"></div><div id="result" hidden><h2 id="result-title"></h2><p id="result-detail"></p><div class="button-pair"><button id="result-retry" class="primary">Fly again</button><button id="result-ground">Ground view</button></div></div>
<div class="clock-panel card"><div class="card-head"><span class="eyebrow">Sim time</span><span id="rate-label" class="state"></span></div><div id="perf" class="perf"></div><b id="clock"></b><div class="time-controls">${[1, 10, 100, 1000, 10000].map(n => `<button data-rate="${n}">${n >= 1000 ? n / 1000 + 'k' : n}×</button>`).join('')}<button id="pause">Ⅱ</button></div></div>
<div id="sheet" aria-label="Flight menu"><div class="sheet-grip"></div><div class="sheet-actions"></div></div>
<div id="touch-pad" class="compact-only"><div class="pad-left"><button id="jets-up" class="pad-btn">Jets ▲</button><button id="jets-down" class="pad-btn">Jets ▼</button></div><div class="pad-right"><button id="cam-next" class="pad-btn">Cam</button><button id="pad-pause" class="pad-btn">Ⅱ</button></div><div id="touch-throttle" role="slider" aria-label="Main drive throttle" aria-valuemin="0" aria-valuemax="100"><i></i><b>0%</b><span>THR</span></div><div id="stick-hint">Drag anywhere to steer</div><div class="chip-row"></div></div>
<footer class="dock"><div class="dock-group drive"><div class="dock-label"><span class="eyebrow">Main drive</span><b id="burn">0%</b></div><input id="throttle" aria-label="Main engine throttle" type="range" min="0" max="100" value="0"><div class="dock-hint"><kbd>Shift</kbd><kbd>Ctrl</kbd> throttle <kbd>Z</kbd> full <button id="cut" class="ghost"><kbd>X</kbd>Cut</button></div></div><div class="dock-group toggles"><button id="torch" class="toggle"><kbd>M</kbd><span>Torch</span></button><button id="gear" class="toggle"><kbd>G</kbd><span>Gear</span></button><button id="descent" class="toggle"><kbd>V</kbd><span>Descent assist</span></button><button id="entry-hold" class="toggle"><kbd>B</kbd><span>Entry attitude</span></button><button id="handling" class="toggle"><kbd>T</kbd><span>Assisted</span></button><button id="prograde"><span>Prograde</span></button><button id="retrograde"><span>Retrograde</span></button></div><div class="dock-group keys"><span><kbd>W</kbd><kbd>S</kbd> pitch <kbd>A</kbd><kbd>D</kbd> roll <kbd>Q</kbd><kbd>E</kbd> yaw</span><span><kbd>R</kbd><kbd>F</kbd> jets <kbd>C</kbd> camera <kbd>Space</kbd> pause</span></div></footer>
<dialog id="guide"><button id="close-guide" class="ghost close">Close</button><h2>Fly the spaceplane.</h2>
<p><b>Stick.</b> W/S pitch (S pulls the nose up), A/D roll, Q/E yaw; arrow keys also pitch and roll. Or hold the left mouse button in the view and drag: the further from where you pressed, the harder the turn. Assisted handling holds attitude when you let go; T switches to Newtonian spin in space.</p>
<p><b>In the air</b> the ship flies like an aircraft: it weathervanes into the airflow, wings make lift, and banking turns you. Mars air is 1% of Earth's, so you need speed or engines to stay up. <b>In space</b> pointing the nose does not change your path; thrust does.</p>
<p><b>Engines.</b> Shift raises throttle, Ctrl lowers it, Z is full, X cuts. R/F fire the belly hover jets (0.85 g, enough to hover in Mars' 0.38 g). J/L slide sideways, I/K push forward and back.</p>
<p><b>Landing.</b> G lowers the gear. Touch down upright with under 6 m/s vertical and 5 m/s horizontal. V engages descent assist: the jets hold your position over the ground, even in wind, and lower you gently while you steer the throttle. B holds a 40° belly-first entry attitude so the heat shield takes the plasma.</p>
<p><b>Arrival and speed.</b> M switches the main drive to torch mode, 30 g, for short interplanetary capture burns. Use it in vacuum when a large Δv is needed, then cut it early: sustained 30 g rapidly changes your orbit, and in atmosphere it can exceed the 45 kPa structural limit and destroy the ship. The Arrival start puts you 150,000 km out on a flyby: coast and you escape; point retrograde (the ⊗ marker) near periapsis and burn the capture Δv shown on the HUD. Full markings shows the amber predicted path. Warp goes to 10,000× and backs off near Mars.</p>
<p><b>Map.</b> Named craters, volcanoes, plains and every successful lander site are placed at their published coordinates; landers stand at their sites with a blinking beacon. Pick one as the navigation target for a HUD waypoint, or click it on the surface map. Olympus Mons is true MOLA scale. Lettering uses RAHIMLI STENCIL, a typeface drawn for Farhad Rahimli; look for it on the hull and on the Olympus Mons caldera floor.</p>
<p><b>Cameras.</b> C cycles ten views. GROUND puts you on the surface at eye height, like a rover mast camera. Scroll zooms exterior views; drag ORBIT and FULL SHIP to inspect.</p>
<p><b>Data.</b> Terrain: NASA MGS MOLA elevations (4 px/deg global, 128 px/deg over Valles Marineris), bicubic, no vertical exaggeration, plus procedural craters, ridges and rocks below the 15 km data spacing. The same surface function drives rendering and collision. Colour: <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener">Solar System Scope</a> (CC BY 4.0), graded toward rover true colour near the ground. Atmosphere: exponential, 11.1 km scale height, 20 g/m³ at the datum; sky colours are art-directed. Ship, thrust and heat model are fictional.</p></dialog>`;

{
  const mark = $('wordmark') as HTMLCanvasElement, ink = mark.getContext('2d')!;
  const w = drawStencil(ink, 'PATHFINDER', 2, 6, {size: 40, weight: 1.05, tracking: 1.5, color: '#ede8e0'});
  drawStencil(ink, 'MARS', w + 26, 6, {size: 40, weight: 1.05, tracking: 1.5, color: '#9ff5c8'});
}
const glare = new Glare(document.body);
const view = new MarsScene($('universe')), control = new FlightControl(), audio = new FlightAudio(), hud = new Hud(document.body);
let state: MarsState & {tele?: FlightTelemetry} = marsInitial();
let rotation = new T.Quaternion(), paused = false, rate = 1, throttle = 0, last = performance.now();
const weather = new Weather();
let lighting: LightingPreset = 'day';
let mission: Mission | null = null, missionStep = 0, missionStart = {t: 0, fuel: 100, wall: 0}, missionSeconds = 0, missionOver = false, lastTouchdown = 0, windNow = {e: 0, n: 0, total: 0, devil: 0};
let torch = false, mapMode: 'surface' | 'system' | 'auto' = 'auto', orbit: Orbit | null = null, path: V[] | null = null, pathClock = 0;
let gear = false, gearAnim = 0, descent = false, entryHold = false, autopilot = false, ended = false, endTimer = 0, invertPitch = false;
const keys = new Set<string>();
const stick = {active: false, ox: 0, oy: 0, x: 0, y: 0};

function destination(lat: number, lon: number, bearingDeg: number, distanceM: number) {
  const d = distanceM / (MARS.radius * 1000), b = bearingDeg * Math.PI / 180, a = lat * Math.PI / 180, l = lon * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(a) * Math.cos(d) + Math.cos(a) * Math.sin(d) * Math.cos(b));
  const lon2 = l + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(a), Math.cos(d) - Math.sin(a) * Math.sin(lat2));
  return {lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI};
}
/** Place the ship over a surface point with air-relative speed, heading from north, flight-path angle and angle of attack. */
function placeOver(lat: number, lon: number, agl: number, heading: number, speed: number, gamma: number, alpha: number) {
  const dir = new T.Vector3(...latLonToDir(lat, lon));
  const ground = view.surface ? view.surface.radiusM(dir.toArray() as V, 3) : MARS.radius * 1000;
  state.p = dir.clone().multiplyScalar((ground + agl) / 1000).toArray() as V;
  const north = new T.Vector3(0, 1, 0).addScaledVector(dir, -dir.y).normalize(), east = new T.Vector3().crossVectors(north, dir).normalize();
  const h = heading * Math.PI / 180, g = gamma * Math.PI / 180;
  const flat = north.clone().multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
  const velocity = flat.clone().multiplyScalar(Math.cos(g)).addScaledVector(dir, Math.sin(g));
  state.v = add(velocity.clone().multiplyScalar(speed / 1000).toArray() as V, atmosphereVelocity(state.p));
  const right = flat.clone().cross(dir).normalize(), liftUp = right.clone().cross(velocity).normalize();
  const a = alpha * Math.PI / 180, forward = velocity.clone().multiplyScalar(Math.cos(a)).addScaledVector(liftUp, Math.sin(a));
  const up = liftUp.clone().multiplyScalar(Math.cos(a)).addScaledVector(velocity, -Math.sin(a));
  rotation.setFromRotationMatrix(new T.Matrix4().makeBasis(forward.clone().cross(up).normalize(), up, forward.clone().negate()));
}

type LightingPreset = 'sunrise'|'day'|'sunset'|'evening'|'night';
const LIGHTING: Record<LightingPreset,{elevation:number;side:'morning'|'afternoon'}> = {
  sunrise:{elevation:3,side:'morning'}, day:{elevation:35,side:'afternoon'}, sunset:{elevation:3,side:'afternoon'}, evening:{elevation:-5,side:'afternoon'}, night:{elevation:-15,side:'afternoon'}
};
/** Spin Mars to put the current location at a requested solar elevation and morning/afternoon side. */
function setLocalSun(elevationDeg: number, side: 'morning'|'afternoon' = 'afternoon') {
  const undo = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -state.t / MARS.rotation * Math.PI * 2);
  state.p = new T.Vector3(...state.p).applyQuaternion(undo).toArray() as V; state.v = new T.Vector3(...state.v).applyQuaternion(undo).toArray() as V;
  rotation.premultiply(undo); state.t = 0;
  const dirBody = new T.Vector3(...state.p).normalize(), sun = sunDirection(), target = Math.sin(elevationDeg * Math.PI / 180);
  let best = 0, bestErr = Infinity;
  for (let i = 0; i < 720; i++) {
    const theta = i / 720 * Math.PI * 2, up = dirBody.clone().applyAxisAngle(new T.Vector3(0, 1, 0), theta);
    const east = new T.Vector3(0, 1, 0).cross(up).normalize();
    const wrongSide = side === 'morning' ? sun.dot(east) < 0 : sun.dot(east) > 0;
    const err = Math.abs(sun.dot(up) - target) + (wrongSide ? 1 : 0);
    if (err < bestErr) {bestErr = err; best = theta;}
  }
  const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), best);
  state.t = best / (Math.PI * 2) * MARS.rotation;
  state.p = new T.Vector3(...state.p).applyQuaternion(q).toArray() as V;
  state.v = new T.Vector3(...state.v).applyQuaternion(q).toArray() as V;
  rotation.premultiply(q);
}

function reset() {
  autopilot = descent = entryHold = ended = false; endTimer = 0;
  state = marsInitial(); state.heat = 0; control.assisted = true; control.reset(); view.clearExplosion(); view.resetCameraState(); view.surfaceView?.reset();
  const scenario = ($('scenario') as HTMLSelectElement).value;
  let camera = 1; gear = false; throttle = 0; torch = false; view.trackedBody = -1; view.navPlace = null; path = null; pathClock = 0;
  const jezero = {lat: 18.38, lon: 77.58};
  if (scenario === 'arrival') {
    const a = arrivalState(300, 2.65, 150000); state.p = a.p; state.v = a.v;
    const fwd = new T.Vector3(...state.p).negate().normalize();
    rotation.setFromRotationMatrix(new T.Matrix4().makeBasis(fwd.clone().cross(new T.Vector3(0, 1, 0)).normalize(), new T.Vector3(0, 1, 0).addScaledVector(fwd, -fwd.y).normalize(), fwd.clone().negate()));
  }
  else if (scenario === 'base-pad') {const pad = padLatLon(0); placeOver(pad.lat, pad.lon, VEHICLE.gearClearance, 60, 0, 0, 0); gear = true; state.status = 'landed'; camera = 1; view.navPlace = placeById('jezero-base')!;}
  else if (scenario === 'base-approach') {const s = destination(BASE.lat, BASE.lon, 240, 7000); placeOver(s.lat, s.lon, 2200, 60, 170, -8, 10); throttle = .3; view.navPlace = placeById('jezero-base')!;}
  else if (scenario === 'olympus-overview') {placeOver(18.65, 226.2, 650000, 90, Math.sqrt(MARS.mu / (MARS.radius + 650)) * 1000 - 227, 0, 4); camera = 3; view.navPlace = placeById('olympus')!;}
  else if (scenario === 'olympus-scarp') {placeOver(18.65, 221.0, 16000, 90, 500, -1, 7); throttle = .32; view.navPlace = placeById('olympus')!;}
  else if (scenario === 'olympus') {placeOver(18.9, 225.1, 9000, 105, 420, -4, 9); throttle = .45; view.navPlace = placeById('rahimli-glyph')!;}
  else if (scenario === 'jezero') {const s = destination(jezero.lat, jezero.lon, 225, 26000); placeOver(s.lat, s.lon, 6000, 45, 270, -6, 10); throttle = .12;}
  else if (scenario === 'canyon') {placeOver(CANYON_START.lat, CANYON_START.lon, CANYON_START.agl, CANYON_START.heading, 260, 0, 9); throttle = .3;}
  else if (scenario === 'landing') {const s = destination(jezero.lat, jezero.lon, 200, 1200); placeOver(s.lat, s.lon, 900, 20, 35, -30, 0); gear = true; descent = true;}
  else if (scenario === 'surface') {placeOver(jezero.lat, jezero.lon, VEHICLE.gearClearance, 30, 0, 0, 0); gear = true; state.status = 'landed'; camera = 9;}
  else if (scenario === 'entry') {const s = destination(jezero.lat, jezero.lon, 240, 600000); placeOver(s.lat, s.lon, 58000, 60, 3600, -9, 40); entryHold = true;}
  else if (scenario === 'orbit') {
    const r = MARS.radius + 320; state.p = [r, 0, 0];
    state.v = new T.Vector3(0, Math.sin(.4), Math.cos(.4)).multiplyScalar(Math.sqrt(MARS.mu / r)).toArray() as V;
    const fwd = new T.Vector3(...state.v).normalize(), up = new T.Vector3(...state.p).normalize();
    rotation.setFromRotationMatrix(new T.Matrix4().makeBasis(fwd.clone().cross(up).normalize(), up, fwd.clone().negate()));
  } else {
    const i = scenario === 'phobos' ? 0 : 1, moon = marsMoonState(i, 0);
    state.p = add(moon.p, [0, 0, 40]); state.v = [...moon.v]; view.trackedBody = i;
    rotation.setFromUnitVectors(new T.Vector3(0, 0, -1), new T.Vector3(...add(moon.p, mul(state.p, -1))).normalize());
  }
  lighting = 'day'; ($('lighting') as HTMLSelectElement).value = lighting;
  if (['jezero', 'canyon', 'landing', 'surface', 'olympus', 'olympus-overview', 'olympus-scarp', 'base-pad', 'base-approach'].includes(scenario)) setLocalSun(scenario.startsWith('olympus') ? 28 : LIGHTING.day.elevation, LIGHTING.day.side);
  if (['jezero', 'landing', 'surface'].includes(scenario)) view.navPlace = placeById('perseverance')!;
  gearAnim = gear ? 1 : 0;
  ($('target') as HTMLSelectElement).value = view.navPlace ? `place:${view.navPlace.id}` : String(view.trackedBody);
  ($('throttle') as HTMLInputElement).value = String(Math.round(throttle * 100));
  paused = false; keys.clear(); setCamera(camera); $('pause').textContent = 'Ⅱ'; $('result').hidden = true;
  const low = ['jezero', 'canyon', 'landing', 'surface', 'base-pad', 'base-approach', 'olympus', 'olympus-scarp'].includes(scenario);
  setRate(low ? 1 : scenario === 'entry' || scenario === 'olympus-overview' ? 10 : scenario === 'arrival' ? 10000 : 100);
  syncButtons();
  document.body.classList.remove('flying'); setTimeout(() => document.body.classList.add('flying'), 3500);
}

function setCamera(mode: number) {view.mode = mode; document.querySelectorAll<HTMLElement>('[data-camera]').forEach(b => b.classList.toggle('active', Number(b.dataset.camera) === mode));}
function setRate(r: number) {rate = r; document.querySelectorAll<HTMLElement>('[data-rate]').forEach(b => b.classList.toggle('active', Number(b.dataset.rate) === r));}
function syncButtons() {
  const label = (id: string, text: string) => {$(id).querySelector('span')!.textContent = text;};
  label('gear', gear ? 'Gear down' : 'Gear up'); $('gear').classList.toggle('active', gear);
  $('descent').classList.toggle('active', descent); $('entry-hold').classList.toggle('active', entryHold);
  label('handling', control.assisted ? 'Assisted' : 'Newtonian'); $('handling').classList.toggle('active', control.assisted);
  label('torch', torch ? 'Torch 30 g' : 'Torch'); $('torch').classList.toggle('active', torch); $('torch').classList.toggle('hot', torch);
}
function syncDisplayButtons() {
  $('markings').textContent = `Marks · ${view.markings}`; $('markings').classList.toggle('active', view.markings !== 'off');
  $('labels').textContent = `Labels · ${view.labelsMode}`; $('labels').classList.toggle('active', view.labelsMode !== 'off');
}
function aim(v: V) {entryHold = false; descent = false; control.pointTo(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, -1), new T.Vector3(...v).normalize())); syncButtons();}
function pause() {paused = !paused; keys.clear(); $('pause').textContent = paused ? '▶' : 'Ⅱ'; $('pause').classList.toggle('active', paused);}

$('reset').onclick = () => {mission = null; renderObjectives(); reset();}; $('result-retry').onclick = () => mission ? startMission(mission.id) : reset();
$('cut').onclick = () => {throttle = 0; autopilot = false;};
$('result-ground').onclick = () => {setCamera(9); $('result').hidden = true;};
$('throttle').oninput = e => throttle = Number((e.target as HTMLInputElement).value) / 100;
$('gear').onclick = () => {gear = !gear; syncButtons();};
$('descent').onclick = () => {descent = !descent; if (descent) {entryHold = false; throttle = 0; torch = false; if (state.tele && state.tele.agl < 400) gear = true;} syncButtons();};
$('entry-hold').onclick = () => {entryHold = !entryHold; if (entryHold) descent = false; syncButtons();};
$('prograde').onclick = () => aim(state.tele ? state.tele.airVelocity : state.v);
$('retrograde').onclick = () => aim(mul(state.tele ? state.tele.airVelocity : state.v, -1));
function targetPosition(): V {return view.navPlace ? view.placePosition(view.navPlace, state.t).toArray() as V : view.trackedBody < 0 ? [0, 0, 0] : marsMoonState(view.trackedBody, state.t).p;}
$('face').onclick = () => aim(add(targetPosition(), mul(state.p, -1)));
function selectTarget(value: string) {
  ($('target') as HTMLSelectElement).value = value; autopilot = false;
  if (value.startsWith('place:')) {view.navPlace = placeById(value.slice(6)) ?? null; view.trackedBody = -1;}
  else {view.navPlace = null; view.trackedBody = Number(value);}
}
$('target').onchange = () => selectTarget(($('target') as HTMLSelectElement).value);
function setWeather(mode: WeatherMode) {weather.mode = mode; document.querySelectorAll<HTMLElement>('[data-weather]').forEach(b => b.classList.toggle('active', b.dataset.weather === mode));}
document.querySelectorAll<HTMLElement>('[data-weather]').forEach(b => b.onclick = () => setWeather(b.dataset.weather as WeatherMode));
setWeather('calm');
function setLighting(value: LightingPreset) {lighting = value; const p = LIGHTING[value]; setLocalSun(p.elevation, p.side); ($('lighting') as HTMLSelectElement).value = value;}
$('lighting').onchange = () => setLighting(($('lighting') as HTMLSelectElement).value as LightingPreset);
function objectivePlace(): Place | null {
  const o = mission?.objectives[missionStep];
  if (!o || o.type === 'takeoff' || o.type === 'orbit') return null;
  return {id: 'objective', name: o.label, lat: o.lat, lon: o.lon, kind: 'site', note: '', agl: o.type === 'gate' ? o.agl : 0, ...(o.type === 'gate' ? {radius: o.radius} : {})} as Place;
}
function renderObjectives() {
  if (!mission) {$('mission-panel').hidden = true; return;}
  $('mission-panel').hidden = false; $('mission-brief').textContent = mission.brief;
  $('objectives').innerHTML = mission.objectives.map((o, i) => `<li class="${i < missionStep ? 'done' : i === missionStep && !missionOver ? 'current' : ''}">${o.label}</li>`).join('');
  view.navPlace = objectivePlace() ?? view.navPlace;
  view.surfaceView?.setGate(mission.objectives[missionStep]?.type === 'gate' ? objectivePlace() : null);
}
function startMission(id: string) {
  const m = MISSIONS.find(x => x.id === id) ?? null;
  mission = null; ($('scenario') as HTMLSelectElement).value = m ? m.scenario : ($('scenario') as HTMLSelectElement).value;
  if (m) {setWeather(m.weather); weather.storm = m.weather === 'storm' ? 1 : 0;}
  reset();
  if (!m) {renderObjectives(); view.surfaceView?.setGate(null); return;}
  if (m.night) setLighting('night');
  mission = m; missionStep = 0; missionOver = false; missionSeconds = 0; missionStart = {t: state.t, fuel: state.fuel, wall: performance.now()};
  if (m.id === 'arrival-to-base') {setCamera(1);}
  renderObjectives();
}
function finishMission(success: boolean, reason = '') {
  if (!mission || missionOver) return;
  missionOver = true; renderObjectives(); view.surfaceView?.setGate(null);
  const seconds = missionSeconds, fuelUsed = missionStart.fuel - state.fuel;
  const last = mission.objectives[mission.objectives.length - 1];
  if (!success) {
    $('result-title').textContent = 'MISSION FAILED';
    $('result-detail').textContent = reason;
  } else {
    const landing = last.type === 'land' ? {touchdown: lastTouchdown, distance: objectiveDistance(last)} : {};
    const score = scoreMission(mission, {seconds, fuelUsed, ...landing}), best = bestScore(mission.id);
    saveBest(mission.id, score.total);
    $('result-title').innerHTML = `<span class="medal ${score.medal}"></span>${score.medal.toUpperCase()} · ${score.total}`;
    $('result-detail').innerHTML = `${mission.title} complete.<br>${score.parts.map(p => `<span class="score-part"><b>${p.label}</b> ${p.value} <i>${Math.round(p.score)}</i></span>`).join('')}<br>${score.total > best ? 'New personal best.' : `Best: ${best}`}`;
  }
  $('result').hidden = false;
}
function objectiveDistance(o: {lat: number; lon: number}) {
  const target = new T.Vector3(...latLonToDir(o.lat, o.lon)), here = new T.Vector3(...toBody(state.p, state.t, MARS.rotation)).normalize();
  return Math.acos(Math.min(1, target.dot(here))) * MARS.radius * 1000;
}
function stepMission() {
  if (!mission || missionOver || !state.tele) return;
  const o = mission.objectives[missionStep];
  let done = false;
  if (o.type === 'takeoff') done = state.status === 'flying' && state.tele.agl > o.agl;
  else if (o.type === 'orbit') done = orbit?.status === 'orbit';
  else if (o.type === 'gate') {const p = view.placePosition(objectivePlace()!, state.t); done = p.distanceTo(new T.Vector3(...state.p)) * 1000 < o.radius;} // both km
  if (done) {missionStep++; if (missionStep >= mission.objectives.length) finishMission(true); else renderObjectives();}
  $('mission-clock').textContent = `T+${Math.round(missionSeconds)} s · fuel used ${(missionStart.fuel - state.fuel).toFixed(1)}%`;
}
$('mission-start').onclick = () => startMission(($('mission-pick') as HTMLSelectElement).value);
$('torch').onclick = () => {torch = !torch; syncButtons();};
$('map-mode').onclick = () => {mapMode = mapMode === 'system' ? 'surface' : mapMode === 'surface' ? 'system' : (len(state.p) < 25000 ? 'system' : 'surface'); };
const mapImage = new Image(); mapImage.src = publicAsset('/textures/mars-nasa.jpg');
const mapXY = (lat: number, lon: number) => [((lon + 180) % 360 + 360) % 360 / 360 * 300, 35 + (90 - lat) / 180 * 150];
($('map') as HTMLCanvasElement).addEventListener('click', e => {
  if (!mapShowsSurface()) return;
  const r = (e.target as HTMLCanvasElement).getBoundingClientRect(), x = (e.clientX - r.left) * 300 / r.width, y = (e.clientY - r.top) * 220 / r.height;
  let best: Place | null = null, bestD = 10;
  for (const p of PLACES) {const [px, py] = mapXY(p.lat, p.lon), d = Math.hypot(px - x, py - y); if (d < bestD) {bestD = d; best = p;}}
  if (best) selectTarget(`place:${best.id}`);
});
($('map') as HTMLCanvasElement).addEventListener('mousemove', e => {
  if (!mapShowsSurface()) return;
  const r = (e.target as HTMLCanvasElement).getBoundingClientRect(), x = (e.clientX - r.left) * 300 / r.width, y = (e.clientY - r.top) * 220 / r.height;
  const near = PLACES.map(p => ({p, d: Math.hypot(mapXY(p.lat, p.lon)[0] - x, mapXY(p.lat, p.lon)[1] - y)})).sort((a, b) => a.d - b.d)[0];
  $('map-foot').textContent = near && near.d < 10 ? `${near.p.name.toUpperCase()} · ${near.p.lat.toFixed(1)}°, ${near.p.lon.toFixed(1)}°E` : 'CLICK A SITE TO SET TARGET';
});
function mapShowsSurface() {return mapMode === 'surface' || (mapMode === 'auto' && len(state.p) < 25000);}
$('rendezvous').onclick = () => {if (view.trackedBody >= 0) autopilot = !autopilot; else $('guidance-state').textContent = 'SELECT PHOBOS OR DEIMOS';};
$('handling').onclick = () => {control.assisted = !control.assisted; syncButtons();};
$('pause').onclick = pause; $('clean').onclick = () => document.body.classList.toggle('clean-view');
$('markings').onclick = () => {view.markings = view.markings === 'essential' ? 'full' : view.markings === 'full' ? 'off' : 'essential'; syncDisplayButtons();};
$('labels').onclick = () => {view.labelsMode = view.labelsMode === 'smart' ? 'all' : view.labelsMode === 'all' ? 'off' : 'smart'; syncDisplayButtons();};
$('stars').onclick = () => {view.starBoost = view.starBoost === 1 ? 2.4 : view.starBoost === 2.4 ? 0 : 1; $('stars').textContent = view.starBoost === 0 ? 'Stars off' : view.starBoost > 1 ? 'Stars bright' : 'Stars'; $('stars').classList.toggle('active', view.starBoost > 0);};
$('sound').onclick = async () => {const on = await audio.toggle(); $('sound').textContent = on ? 'Sound on' : 'Sound off'; $('sound').classList.toggle('active', on);};
$('help').onclick = () => {if (!paused) pause(); ($('guide') as HTMLDialogElement).showModal();};
$('close-guide').onclick = () => ($('guide') as HTMLDialogElement).close();
document.querySelectorAll<HTMLElement>('[data-camera]').forEach(b => b.onclick = () => setCamera(Number(b.dataset.camera)));
document.querySelectorAll<HTMLElement>('[data-rate]').forEach(b => b.onclick = () => setRate(Number(b.dataset.rate)));

const cameraTips = ['Pilot-eye view inside the cockpit.','Stable camera following behind the ship.','Slow camera orbit around the ship.','Look at the selected navigation target.','View the ship from ahead.','View the starboard side.','Look down on the ship from above.','Moving cinematic camera.','Close inspection view; drag to rotate.','Rover-height view from the surface.'];
const tips: Record<string,string> = {sound:'Turn music and flight sounds on or off.',markings:'Cycle essential, full, and hidden flight marks.',labels:'Cycle smart, all, and hidden place labels.',clean:'Hide every interface panel.',stars:'Cycle normal, bright, and hidden stars.',help:'Open controls and flight notes.',reset:'Restart at the selected location.','mission-start':'Start the selected scored mission.','map-mode':'Switch between surface and Mars-system maps.',face:'Turn the nose toward the selected target.',rendezvous:'Toggle assisted moon rendezvous.',pause:'Pause or resume simulation time.',cut:'Set main-engine throttle to zero.',torch:'Toggle the 30 g vacuum drive; unsafe in atmosphere.',gear:'Raise or lower landing gear.',descent:'Manage hover jets for a stable descent.','entry-hold':'Hold a belly-first entry attitude.',handling:'Toggle stable fly-by-wire and free Newtonian rotation.',prograde:'Turn the nose along the current velocity.',retrograde:'Turn the nose opposite the current velocity.','result-retry':'Restart this flight or mission.','result-ground':'Inspect the landing or crash site from the ground.','close-guide':'Close the flight guide.',menu:'Open the flight menu.','jets-up':'Hold to fire the hover jets upward.','jets-down':'Hold to push down with the jets.','cam-next':'Switch to the next camera.','pad-pause':'Pause or resume.'};
document.querySelectorAll<HTMLButtonElement>('button').forEach(button => {button.dataset.tip = button.dataset.camera !== undefined ? cameraTips[Number(button.dataset.camera)] : button.dataset.rate ? `${button.dataset.rate} simulation seconds per real second.` : button.dataset.weather ? `Set ${button.textContent?.trim().toLowerCase()} Mars weather.` : tips[button.id] ?? `Use ${button.textContent?.trim()}.`;});
const tooltip = $('tooltip');
const showTip = (button: HTMLButtonElement) => {tooltip.textContent = button.dataset.tip ?? ''; tooltip.classList.add('visible'); const r = button.getBoundingClientRect(), w = tooltip.offsetWidth, h = tooltip.offsetHeight; tooltip.style.left = `${Math.max(8,Math.min(innerWidth-w-8,r.left+r.width/2-w/2))}px`; tooltip.style.top = `${r.top > h+14 ? r.top-h-9 : r.bottom+9}px`;};
document.addEventListener('pointerover', e => {if ((e as PointerEvent).pointerType === 'touch') return; const button=(e.target as Element).closest?.('button') as HTMLButtonElement|null;if(button)showTip(button);});
document.addEventListener('pointerout', e => {if((e.target as Element).closest?.('button'))tooltip.classList.remove('visible');});
document.addEventListener('focusin', e => {if(e.target instanceof HTMLButtonElement)showTip(e.target);});
document.addEventListener('focusout', () => tooltip.classList.remove('visible'));
syncDisplayButtons();

// Mouse virtual stick: press anywhere in the view, drag away from the press point.
const canvas = view.renderer.domElement;
canvas.addEventListener('pointerdown', e => {if (document.body.classList.contains('sheet-open')) {document.body.classList.remove('sheet-open'); $('menu').setAttribute('aria-expanded', 'false'); $('menu').textContent = 'Menu'; return;} if (e.button !== 0 || view.mode === 2 || view.mode === 8 || stick.active) return; stickId = e.pointerId; $('stick-hint').classList.add('used'); Object.assign(stick, {active: true, ox: e.clientX, oy: e.clientY, x: 0, y: 0}); const s = $('stick'); s.style.left = `${e.clientX}px`; s.style.top = `${e.clientY}px`; s.classList.add('on');});
let stickId = -1;
addEventListener('pointermove', e => {if (!stick.active || e.pointerId !== stickId) return; const dx = (e.clientX - stick.ox) / 110, dy = (e.clientY - stick.oy) / 110, l = Math.hypot(dx, dy), k = l > 1 ? 1 / l : 1; stick.x = dx * k; stick.y = dy * k; ($('stick').firstElementChild as HTMLElement).style.transform = `translate(${stick.x * 44}px,${stick.y * 44}px)`;});
const release = () => {stick.active = false; stick.x = stick.y = 0; stickId = -1; $('stick').classList.remove('on');};
const releasePointer = (e: PointerEvent) => {if (e.pointerId === stickId) release();};
addEventListener('pointerup', releasePointer); addEventListener('pointercancel', releasePointer);

// Phones: panels move into a pull-up menu and touch controls replace the keyboard.
const compactQuery = matchMedia('(max-width: 760px), (max-height: 520px)');
const movable = ['.view-tabs', '.mission', '.telemetry', '.clock-panel'].map(q => document.querySelector(q) as HTMLElement);
const headerButtons = ['markings', 'labels', 'clean', 'stars', 'help'].map(id => $(id));
const chipButtons = ['gear', 'descent', 'cut', 'torch', 'handling', 'entry-hold', 'prograde', 'retrograde'].map(id => $(id));
function applyCompact() {
  const compact = compactQuery.matches, sheet = $('sheet'), actions = sheet.querySelector('.sheet-actions')!, header = document.querySelector('.header-actions')!, footer = document.querySelector('footer.dock')!;
  document.body.classList.toggle('compact', compact);
  const chips = document.querySelector('.chip-row')!, toggles = document.querySelector('.dock-group.toggles')!, hint = document.querySelector('.dock-hint')!;
  if (compact) {headerButtons.forEach(b => actions.appendChild(b)); movable.forEach(el => sheet.appendChild(el)); chipButtons.forEach(b => chips.appendChild(b));}
  else {
    document.body.classList.remove('sheet-open'); headerButtons.forEach(b => header.appendChild(b)); movable.forEach(el => footer.before(el));
    chipButtons.forEach(b => b.id === 'cut' ? hint.appendChild(b) : toggles.appendChild(b));
    for (const id of ['torch', 'gear', 'descent', 'entry-hold', 'handling', 'prograde', 'retrograde']) toggles.appendChild($(id));
  }
  tooltip.classList.remove('visible');
}
compactQuery.addEventListener('change', applyCompact); applyCompact();
const closeSheet = () => {document.body.classList.remove('sheet-open'); $('menu').setAttribute('aria-expanded', 'false'); $('menu').textContent = 'Menu';};
// Choosing a flight, mission or camera from the menu drops you straight back into the view.
$('sheet').addEventListener('click', e => {if ((e.target as Element).closest('#reset,#mission-start,[data-camera],#help,#face,#rendezvous')) setTimeout(closeSheet, 0);});
$('menu').onclick = () => {const open = document.body.classList.toggle('sheet-open'); $('menu').setAttribute('aria-expanded', String(open)); $('menu').textContent = open ? 'Close' : 'Menu';};
$('cam-next').onclick = () => setCamera((view.mode + 1) % CAMERA_NAMES.length);
$('pad-pause').onclick = () => {pause(); $('pad-pause').textContent = paused ? '▶' : 'Ⅱ';};
for (const [id, key] of [['jets-up', 'r'], ['jets-down', 'f']] as const) {
  const b = $(id), up = () => {keys.delete(key); b.classList.remove('active');};
  b.addEventListener('pointerdown', e => {e.preventDefault(); try {b.setPointerCapture(e.pointerId);} catch {/* synthetic pointer */} keys.add(key); b.classList.add('active');});
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
  b.addEventListener('contextmenu', e => e.preventDefault());
}
{
  const track = $('touch-throttle'), set = (e: PointerEvent) => {const r = track.getBoundingClientRect(); throttle = T.MathUtils.clamp(1 - (e.clientY - r.top - 10) / (r.height - 20), 0, 1); if (throttle < .03) throttle = 0;};
  track.addEventListener('pointerdown', e => {e.preventDefault(); set(e); try {track.setPointerCapture(e.pointerId);} catch {/* synthetic pointer */}});
  track.addEventListener('pointermove', e => {if (track.hasPointerCapture(e.pointerId)) set(e);});
}

const HANDLED = new Set(['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', 'i', 'j', 'k', 'l', 'z', 'x', 'g', 'v', 'b', 't', 'c', 'h', 'n', ' ', 'shift', 'control', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'm']);
addEventListener('keydown', e => {
  if ((e.target instanceof HTMLElement && e.target.matches('select,input')) || ($('guide') as HTMLDialogElement).open) return;
  const k = e.key.toLowerCase();
  if (HANDLED.has(k)) e.preventDefault();
  if (e.repeat) return;
  if (k === ' ') pause();
  else if (k === 'c') setCamera((view.mode + 1) % CAMERA_NAMES.length);
  else if (k === 'h') document.body.classList.toggle('clean-view');
  else if (k === 'g') {gear = !gear; syncButtons();}
  else if (k === 'v') $('descent').click();
  else if (k === 'b') $('entry-hold').click();
  else if (k === 't') $('handling').click();
  else if (k === 'z') throttle = 1;
  else if (k === 'x') {throttle = 0; autopilot = false;}
  else if (k === 'n') invertPitch = !invertPitch;
  else if (k === 'm') $('torch').click();
  else keys.add(k);
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => {keys.clear(); release();});
document.addEventListener('visibilitychange', () => {if (document.hidden && !paused) pause();});

function drawMap() {
  const c = ($('map') as HTMLCanvasElement).getContext('2d')!;
  c.clearRect(0, 0, 300, 220); c.font = '10px monospace';
  if (mapShowsSurface()) {
    $('map-mode').textContent = 'Surface ⇄ System';
    if (mapImage.complete) c.drawImage(mapImage, 0, 35, 300, 150);
    c.strokeStyle = '#ffffff22'; for (let lon = 0; lon <= 360; lon += 30) {c.beginPath(); c.moveTo(lon / 360 * 300, 35); c.lineTo(lon / 360 * 300, 185); c.stroke();}
    for (const p of PLACES) {
      if (p.kind === 'glyph') continue;
      const [x, y] = mapXY(p.lat, p.lon), selected = view.navPlace?.id === p.id;
      c.fillStyle = p.kind === 'site' ? '#ffd28e' : p.kind === 'crash' ? '#ff7a59' : '#e8f4f8aa';
      if (p.kind === 'site' || p.kind === 'crash') {c.beginPath(); c.moveTo(x, y - 3.5); c.lineTo(x + 3, y + 2.5); c.lineTo(x - 3, y + 2.5); c.fill();}
      else c.fillRect(x - 1.5, y - 1.5, 3, 3);
      if (selected) {c.strokeStyle = '#9ff5c8'; c.beginPath(); c.arc(x, y, 6, 0, 7); c.stroke(); c.fillStyle = '#9ff5c8'; c.fillText(p.name.toUpperCase(), Math.min(x + 8, 220), Math.max(46, y - 6));}
    }
    const {lat, lon} = dirToLatLon(inertialToBody(state.p, state.t, MARS.rotation)), [sx, sy] = mapXY(lat, lon);
    c.fillStyle = '#9ff5c8'; c.beginPath(); c.arc(sx, sy, 3.5, 0, 7); c.fill(); c.strokeStyle = '#0b1a14'; c.stroke();
    c.fillStyle = '#e8f4f8'; c.fillText(`SHIP ${lat.toFixed(1)}° ${((lon % 360) + 360) % 360 < 180 ? (((lon % 360) + 360) % 360).toFixed(1) + '°E' : (360 - ((lon % 360) + 360) % 360).toFixed(1) + '°W'}`, 6, 205);
    return;
  }
  $('map-mode').textContent = 'System ⇄ Surface';
  const extent = Math.max(26000, len(state.p) * 1.2), scale = 95 / extent, project = (p: V) => [150 + p[0] * scale, 110 + p[2] * scale];
  c.fillStyle = '#de9975'; c.beginPath(); c.arc(150, 110, Math.max(2, MARS.radius * scale), 0, Math.PI * 2); c.fill();
  MARS_MOONS.forEach((m, i) => {c.strokeStyle = '#7897ac80'; c.beginPath(); c.arc(150, 110, m.orbit * scale, 0, Math.PI * 2); c.stroke(); const [x, y] = project(marsMoonState(i, state.t).p); c.fillStyle = '#d9e9eb'; c.fillRect(x - 2, y - 2, 4, 4); c.fillText(m.name.toUpperCase(), Math.min(x + 5, 245), y - 6);});
  if (path) {c.strokeStyle = '#ffc46b'; c.beginPath(); path.forEach((p, i) => {const [x, y] = project(p); i ? c.lineTo(x, y) : c.moveTo(x, y);}); c.stroke();}
  const [x, y] = project(state.p); c.fillStyle = '#9ff5c8'; c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill();
  c.fillStyle = '#e8f4f8'; c.fillText(`${(extent / 1000).toFixed(0)}k km across`, 6, 205);
}

function input(): {stick: T.Vector3; flight: FlightInput} {
  const k = (a: string) => keys.has(a) ? 1 : 0;
  if (keys.has('shift')) throttle = Math.min(1, throttle + .012);
  if (keys.has('control')) throttle = Math.max(0, throttle - .012);
  const throttleEl = $('throttle') as HTMLInputElement; throttleEl.value = String(Math.round(throttle * 100)); throttleEl.style.setProperty('--fill', `${Math.round(throttle * 100)}%`);
  if (document.body.classList.contains('compact')) {const t = $('touch-throttle'); t.style.setProperty('--level', String(throttle)); t.querySelector('b')!.textContent = `${Math.round(throttle * 100)}%`;}
  const pitchKeys = (k('s') + k('arrowdown') - k('w') - k('arrowup')) * (invertPitch ? -1 : 1);
  const s = new T.Vector3(
    T.MathUtils.clamp(pitchKeys - stick.y * (invertPitch ? -1 : 1), -1, 1),
    T.MathUtils.clamp(k('q') - k('e'), -1, 1),
    T.MathUtils.clamp(k('a') + k('arrowleft') - k('d') - k('arrowright') - stick.x, -1, 1));
  // Soft response curve keeps fine corrections gentle.
  s.set(Math.sign(s.x) * Math.abs(s.x) ** 1.5, Math.sign(s.y) * Math.abs(s.y) ** 1.5, Math.sign(s.z) * Math.abs(s.z) ** 1.5);
  return {stick: s, flight: {throttle, torch, hover: k('r') - k('f'), lateral: k('l') - k('j'), surge: k('i') - k('k')}};
}

/**
 * Adaptive resolution: hold the frame budget by trading pixel density, never features.
 * Drops quickly when frames run long, climbs back slowly when there is headroom.
 */
const perf = {samples: [] as number[], ratio: Math.min(devicePixelRatio, 2), max: Math.min(devicePixelRatio, 2), adaptive: true, calm: 0};
{
  const q = new URLSearchParams(location.search);
  if (q.get('dpr')) perf.ratio = perf.max = Number(q.get('dpr'));
  if (q.get('adaptive') === '0') perf.adaptive = false;
  view.renderer.setPixelRatio(perf.ratio); view.resize();
}
function trackPerformance(ms: number) {
  if (document.hidden || ms <= 0 || ms > 250) return;
  perf.samples.push(ms); if (perf.samples.length > 90) perf.samples.shift();
  const avg = perf.samples.reduce((a, b) => a + b, 0) / perf.samples.length;
  if (perf.adaptive && perf.samples.length >= 45) {
    if (avg > 19 && perf.ratio > Math.min(1, perf.max)) {perf.ratio = Math.max(Math.min(1, perf.max), perf.ratio - .25); perf.samples.length = 0; perf.calm = 0; view.renderer.setPixelRatio(perf.ratio); view.resize();}
    else if (avg < 13 && perf.ratio < perf.max) {if (++perf.calm > 240) {perf.ratio = Math.min(perf.max, perf.ratio + .25); perf.samples.length = 0; perf.calm = 0; view.renderer.setPixelRatio(perf.ratio); view.resize();}}
    else perf.calm = 0;
  }
  if (perf.samples.length % 15 === 0) $('perf').textContent = `${Math.round(1000 / avg)} fps · ${perf.ratio.toFixed(2)}× res`;
}

function frame(now: number, schedule = true) {
  if (schedule) trackPerformance(now - last);
  const dt = Math.max(0, Math.min(.05, (now - last) / 1000)); last = now;
  const ready = !!view.surface;
  const active = ready && !paused && (state.status === 'flying' || state.status === 'landed');
  const {stick: s, flight} = input();
  if (!state.tele && ready) advanceFlight(state, 0, rotation, flight, {surface: view.surface!, gear});
  const tele = state.tele ?? null;
  gearAnim = T.MathUtils.clamp(gearAnim + (gear ? dt : -dt) / 3.2, 0, 1);

  // Time compression backs off near the ground and in dense air.
  let effectiveRate = rate;
  if (tele) {
    if (tele.agl < 150000) effectiveRate = Math.min(effectiveRate, 10);
    if (tele.agl < 40000) effectiveRate = Math.min(effectiveRate, 4);
    if (tele.agl < 8000 || state.status === 'landed') effectiveRate = Math.min(effectiveRate, 1);
    if (tele.verticalSpeed < -1 && tele.agl < 200000) effectiveRate = Math.min(effectiveRate, Math.max(1, tele.agl / -tele.verticalSpeed / 10));
  }
  orbit = orbitOf(state.p, state.v);
  // Burns happen in (near) real time so they can be feathered; warp resumes when the engines stop.
  if (flight.throttle > 0 || flight.hover !== 0 || flight.lateral !== 0 || flight.surge !== 0) effectiveRate = Math.min(effectiveRate, flight.torch ? 1 : 4);
  if (orbit.approaching && orbit.periapsis < 3000 && Number.isFinite(orbit.timeToPeriapsis)) effectiveRate = Math.min(effectiveRate, Math.max(orbit.periapsis < 0 ? 1 : 10, orbit.timeToPeriapsis / 5));
  pathClock -= dt;
  if (pathClock <= 0 && tele && tele.agl > 90000) {path = predictPath(state.p, state.v).path; pathClock = .3;} else if (tele && tele.agl <= 90000) path = null;
  MARS_MOONS.forEach((m, i) => {const moon = marsMoonState(i, state.t), dp = add(state.p, mul(moon.p, -1)), dv = add(state.v, mul(moon.v, -1)), v = -dot(dp, dv) / len(dp); if (v > 0) effectiveRate = Math.min(effectiveRate, Math.max(1, (len(dp) - m.radius) / v / 12));});

  let hoverOut = flight.hover;
  if (active && tele) {
    const flow = tele.airspeed > 5 ? {alpha: tele.alpha, beta: tele.beta, qbar: tele.dynamicPressure} : undefined;
    if (s.lengthSq() > 1e-4 && entryHold) {entryHold = false; syncButtons();}
    if (entryHold && tele.airspeed > 50) control.pointTo(entryAttitude(tele));
    if (descent) {
      const cmd = descentAssist(state, tele, rotation);
      flight.hover = Math.max(flight.hover, cmd.hover); flight.lateral = flight.lateral || cmd.lateral; flight.surge = flight.surge || cmd.surge;
      if (s.lengthSq() < 1e-4) control.pointTo(cmd.level);
      if (tele.agl < 350 && !gear) {gear = true; syncButtons();}
      hoverOut = flight.hover;
    }
    if (autopilot && view.trackedBody >= 0) {
      const command = rendezvousCommand(state, view.trackedBody);
      const local = new T.Vector3(...command.thrust).multiplyScalar(1000).applyQuaternion(rotation.clone().invert());
      flight.throttle = Math.max(0, -local.z) / 19.6; flight.surge = 0; flight.torch = false;
      if (len(command.thrust) > 1e-6) control.pointTo(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, -1), new T.Vector3(...command.thrust).normalize()));
      $('guidance-state').textContent = command.arrived ? 'STAND-OFF HOLD' : `INTERCEPT / BRAKE · ${command.distance.toFixed(1)} KM`;
    } else $('guidance-state').textContent = descent ? 'DESCENT ASSIST' : entryHold ? 'ENTRY ATTITUDE HOLD' : 'MANUAL FLIGHT';
    if (state.status !== 'landed') control.update(rotation, s, dt, flow);
    else control.reset();
    weather.update(dt);
    let windInertial: V | undefined;
    if (tele.agl < 50000) {
      const w = weather.windEN(state.t, tele.agl), sv = view.surfaceView;
      const devil = sv ? weather.devilWind(sv.devilsNow, sv.shipMap.x, sv.shipMap.z, tele.agl) : {e: 0, up: 0, n: 0};
      const up = new T.Vector3(...tele.up), eastI = new T.Vector3(0, 1, 0).cross(up).normalize(), northI = up.clone().cross(eastI);
      const e = w.e + devil.e, n = w.n + devil.n;
      windInertial = mul(windToInertial(e, devil.up, n, {east: eastI.toArray() as V, up: tele.up, north: northI.toArray() as V}), .001);
      windNow = {e, n, total: Math.hypot(e, n), devil: Math.hypot(devil.e, devil.n, devil.up)};
    } else windNow = {e: 0, n: 0, total: 0, devil: 0};
    advanceFlight(state, dt * effectiveRate, rotation, flight, {surface: view.surface!, gear: gearAnim > .95, wind: windInertial});
    if (mission && !missionOver) missionSeconds += dt * effectiveRate;
    stepMission();
    if (state.status === 'landed' && descent) {descent = false; syncButtons();}
  }

  if (!ended && (state.status === 'impact' || state.status === 'landed') && state.tele) {
    if (state.status === 'impact') {
      ended = true; view.explode(); view.surfaceView?.dustBurst('crash'); audio.update(0, false, false, false);
      if (view.mode === 0) setCamera(1);
      endTimer = 2.2;
      $('result-title').textContent = 'VEHICLE LOST';
      $('result-detail').textContent = state.body;
      if (mission && !missionOver) {missionOver = true; renderObjectives(); $('result-title').textContent = 'MISSION FAILED'; $('result-detail').textContent = `${state.body}.`;}
    } else if (state.body.startsWith('Touchdown')) {
      view.surfaceView?.dustBurst('touchdown');
      lastTouchdown = Number(/Touchdown ([\d.]+)/.exec(state.body)?.[1] ?? 0);
      view.markGearOnGround(rotation);
      const objective = mission && !missionOver ? mission.objectives[missionStep] : null;
      if (objective?.type === 'land') {
        const distance = objectiveDistance(objective);
        state.body = 'Landed';
        if (distance <= objective.maxDistance) {missionStep++; if (missionStep >= mission!.objectives.length) finishMission(true); else renderObjectives();}
        else {$('result-title').textContent = 'OFF TARGET'; $('result-detail').textContent = `Landed ${distance.toFixed(0)} m from ${objective.label.replace('Land on ', '')}. Lift off and try again.`; $('result').hidden = false; setTimeout(() => $('result').hidden = true, 5000);}
      } else {
      $('result-title').textContent = 'TOUCHDOWN';
      $('result-detail').textContent = `${state.body}. Welcome to Mars. Try the GROUND camera, or throttle up and hover jets to lift off again.`;
      $('result').hidden = false; state.body = 'Landed';
      setTimeout(() => {if (state.status === 'landed') $('result').hidden = true;}, 7000);
      }
    }
  }
  if (ended && endTimer > 0) {endTimer -= dt; if (endTimer <= 0) $('result').hidden = false;}

  const heat = state.heat ?? 0, flux = tele?.heatFlux ?? 0;
  // Plasma glow follows the unshielded stagnation heating: √ρ·v³ with ρ recovered from dynamic pressure.
  const rho = tele && tele.airspeed > 1 ? 2 * tele.dynamicPressure / tele.airspeed ** 2 : 0;
  const plasma = tele ? Math.max(0, Math.sqrt(rho / .02) * (tele.airspeed / 1000) ** 3 * .3 - .15) : 0;
  const shake = tele ? Math.min(1, (flight.torch ? flight.throttle * .5 : 0) + plasma * .35 + flux * .1 + Math.max(0, tele.dynamicPressure - 300) / 2500 + (throttle + hoverOut) * .12 + (view.explosionTime >= 0 && view.explosionTime < 1 ? 3 : 0)) : 0;
  view.draw({state, rotation, tele, dt, shake, path, weather, wind: windNow, controls: {torch: flight.torch, throttle: active ? flight.throttle : 0, hover: active ? Math.max(0, hoverOut) : 0, pitch: s.x, roll: s.z, gear: gearAnim, heat: plasma}});

  {
    // Glare: full in space, softened by dust in the sky, gone below the horizon or behind Mars.
    const sunDir = sunDirection(), cam = view.camera, sv = view.surfaceView;
    const shipKm = new T.Vector3(...state.p), toSun = sunDir.clone();
    const b = shipKm.dot(toSun), c2 = shipKm.lengthSq() - (MARS.radius * .999) ** 2, blocked = b < 0 && b * b - c2 > 0;
    const upL = tele ? new T.Vector3(...tele.up) : shipKm.clone().normalize();
    const belowHorizon = sv?.active && tele ? sunDir.dot(upL) < -Math.sqrt(Math.max(0, 2 * tele.agl / (MARS.radius * 1000))) - .01 : false;
    const dusty = sv?.active ? sv.skyOpacity() : 0;
    glare.draw(cam, sunDir, blocked || belowHorizon || view.mode === 0 && false ? 0 : (1 - .55 * dusty) * (1 - (sv?.storm ?? 0) * .9));
  }
  if (tele) {
    const showHud = (view.mode === 0 || view.mode === 1 || view.mode === 3) && !document.body.classList.contains('clean-view') && state.status !== 'impact';
    if (showHud && view.markings !== 'off') hud.draw({tele, rotation, camera: view.camera, cockpit: view.mode === 0, throttle: flight.throttle, hover: Math.max(0, hoverOut), gear, assist: descent ? 'DESCENT' : entryHold ? 'ENTRY' : control.assisted ? 'FBW' : 'NEWTON', heat, fuel: state.fuel, status: state.status, warp: effectiveRate, wind: windNow, storm: weather.storm, drive: flight.torch ? 'TORCH' : 'MAIN', orbit, velocity: state.v, space: tele.agl > 120000, markings: view.markings,
      waypoint: view.navPlace || view.trackedBody >= 0 ? {name: view.navPlace ? view.navPlace.name : MARS_MOONS[view.trackedBody].name, offset: new T.Vector3(...add(targetPosition(), mul(state.p, -1)))} : null,
      accel: (flight.torch ? VEHICLE.torchThrust : VEHICLE.mainThrust) / 1000}, dt);
    else hud.clear();
    const atmospheric = tele.agl < 150000;
    $('speed').textContent = atmospheric ? tele.airspeed.toFixed(0) : (len(state.v)).toFixed(len(state.v) > 100 ? 1 : 3);
    $('speed-unit').textContent = atmospheric ? 'm/s' : 'km/s';
    $('speed-label').textContent = atmospheric ? 'AIRSPEED' : 'MARS-RELATIVE VELOCITY';
    $('altitude').textContent = tele.agl > 99999 ? `${(tele.agl / 1000).toLocaleString('en-GB', {maximumFractionDigits: 0})} km` : `${tele.agl.toFixed(0)} m`;
    $('vs').textContent = `${tele.verticalSpeed.toFixed(1)} m/s`;
    $('g').textContent = `${tele.gLoad.toFixed(2)} g`;
    $('heat').textContent = `${heat.toFixed(0)}%`;
    audio.update(Math.max(flight.throttle, hoverOut * .6), heat > 40 || (tele.agl < 1500 && tele.verticalSpeed < -40), state.status === 'landed', active);
  }
  $('fuel').textContent = state.fuel.toFixed(1) + '%';
  $('burn').textContent = Math.round(throttle * 100) + '%';
  const range = len(add(targetPosition(), mul(state.p, -1)));
  $('target-range').textContent = `Range ${range > 1000 ? range.toLocaleString('en-GB', {maximumFractionDigits: 0}) : range.toFixed(range < 10 ? 2 : 1)} km`;
  $('target-note').textContent = view.navPlace ? view.navPlace.note : '';
  $('orbit-readout').textContent = orbit && (!tele || tele.agl > 90000) ? `${orbit.status.toUpperCase()} · Pe ${orbit.periapsis.toFixed(0)} km · Ap ${Number.isFinite(orbit.apoapsis) ? orbit.apoapsis.toFixed(0) + ' km' : '∞'} · e ${orbit.e.toFixed(2)}` : '';
  $('clock').textContent = new Date(state.t * 1000).toISOString().slice(11, 19);
  $('rate-label').textContent = `${effectiveRate >= 10 ? Math.round(effectiveRate).toLocaleString('en-GB') : effectiveRate.toFixed(effectiveRate < 1.95 ? 0 : 1)}× real time`;
  $('warning').textContent = !ready ? 'LOADING TERRAIN' : paused ? 'SIMULATION PAUSED' : '';
  $('mission-state').textContent = !ready ? 'Loading MOLA terrain…' : paused ? 'Paused' : state.status === 'impact' ? 'Flight ended' : state.status === 'landed' ? 'Landed on Mars' : tele && tele.agl < 150000 ? 'Atmospheric flight' : 'Orbital flight';
  drawMap();
  if (schedule) requestAnimationFrame(t => frame(t));
}

view.onTerrainReady = () => {
  // Deep links can stage a location, camera and cockpit configuration for sharing or screenshots.
  const q = new URLSearchParams(location.search), cam = q.get('camera'), sun = q.get('sun'), w = q.get('weather') as WeatherMode | null, light = q.get('light') as LightingPreset | null;
  if (w && w in WEATHER_NAMES) setWeather(w);
  if (q.get('scenario')) ($('scenario') as HTMLSelectElement).value = q.get('scenario')!;
  if (q.get('mission')) {($('mission-pick') as HTMLSelectElement).value = q.get('mission')!; startMission(q.get('mission')!);} else reset();
  if (light && light in LIGHTING) setLighting(light); else if (sun !== null) setLocalSun(Number(sun));
  if (cam !== null) setCamera(Number(cam));
  if (q.get('torch') === '1') torch = true;
  if (q.get('throttle')) throttle = T.MathUtils.clamp(Number(q.get('throttle')) / 100, 0, 1);
  if (['essential','full','off'].includes(q.get('marks') ?? '')) view.markings = q.get('marks') as typeof view.markings;
  if (['smart','all','off'].includes(q.get('labels') ?? '')) view.labelsMode = q.get('labels') as typeof view.labelsMode;
  syncButtons(); syncDisplayButtons();
};
setCamera(1);
requestAnimationFrame(t => frame(t));
Object.defineProperty(window, 'marsStatus', {get: () => ({
  destination: 'mars', time: state.t, paused, status: state.status, body: state.body, fuel: state.fuel, speed: len(state.v), camera: view.mode, target: view.trackedBody,
  position: [...state.p], rotation: rotation.toArray(), rate, angularSpeed: control.angularVelocity.length(), shipFramed: view.shipFramed, vehicle: view.vehicleStatus, autopilot, terrain: view.terrainStatus,
  torch, orbit, navPlace: view.navPlace?.id ?? null, heat: state.heat ?? 0, texture: view.cloudMapStatus, errors: [...view.renderErrors], tele: state.tele, gear, descent, markings:view.markings, labels:view.labelsMode, lighting, assisted:control.assisted, audioMood:audio.mood, surfaceCameraClearance:view.surfaceCameraClearance, perf: {ratio: perf.ratio, adaptive: perf.adaptive}, rings: view.surfaceView ? [...view.surfaceView.rings.keys()] : [], generationMs: view.surfaceView?.generationMs ?? 0,
})});
// Test hooks for the browser probe: set a scenario and step without waiting on real time.
Object.defineProperty(window, 'marsDebug', {value: {reset: (name: string) => {($('scenario') as HTMLSelectElement).value = name; reset();}, setThrottle: (v: number) => throttle = v, finishMission, startMission, setWeather, setLighting, weather, setTorch: (v: boolean) => {torch = v; syncButtons();}, select: selectTarget, placeAt: (lat: number, lon: number, agl: number, heading = 0, speed = 0) => {state.t = 0; rotation.identity(); placeOver(lat, lon, agl, heading, speed, 0, 0); state.heat = 0; state.status = speed === 0 ? 'landed' : 'flying'; gear = gearAnim === 1 || speed === 0; gearAnim = gear ? 1 : 0; ended = false; view.resetCameraState(); view.surfaceView?.reset();}, setLocalSun, orbit: () => orbit, upL: () => localUp(state.p), view, state: () => state, rotation: () => rotation, keys, tick: (frames = 1, ms = 16.7) => {if (paused) pause(); for (let i = 0; i < frames; i++) frame(last + ms, false);},
}});
