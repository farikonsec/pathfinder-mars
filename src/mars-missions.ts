import type {WeatherMode} from './mars-weather';
import {PADS,PAD_RADIUS,padLatLon} from './mars-base';

/**
 * Missions: an ordered list of objectives on top of an existing start, scored on precision, softness,
 * fuel and time. Scores are pure functions so they can be tested without a browser.
 */
export type Objective =
  | {type: 'takeoff'; agl: number; label: string}
  | {type: 'gate'; lat: number; lon: number; agl: number; radius: number; label: string}
  | {type: 'orbit'; label: string}
  | {type: 'land'; lat: number; lon: number; maxDistance: number; label: string; pad?: number};

export interface Mission {
  id: string; title: string; brief: string; scenario: string; weather: WeatherMode; night?: boolean;
  objectives: Objective[]; parSeconds: number; parFuel: number;
}

const pad = (i: number, label = `Land on ${PADS[i].name}`): Objective => ({type: 'land', ...padLatLon(i), maxDistance: PAD_RADIUS, label, pad: i});
/**
 * Coprates Chasma course, checked against MOLA: gates at a common altitude of 3,800 m below datum,
 * ~2 km above the floor, and every leg clears terrain by at least 1.7 km across a 3.6 km-wide corridor.
 */
export const CANYON_START = {lat: -11.90, lon: 293.65, agl: 1970, heading: 109};
export const CANYON_GATES = [
  {lat: -12.05, lon: 294.10, agl: 2060},
  {lat: -11.80, lon: 294.55, agl: 2010},
  {lat: -12.14, lon: 295.00, agl: 2130},
  {lat: -12.29, lon: 295.45, agl: 2125},
  {lat: -12.39, lon: 295.90, agl: 2120},
];

export const MISSIONS: Mission[] = [
  {id: 'first-landing', title: 'First landing', scenario: 'base-approach', weather: 'calm', parSeconds: 150, parFuel: 3,
    brief: 'Bring PATHFINDER down on Pad 1 at Jezero Base. Bleed speed early, lower the gear, and use V for a gentle final descent.',
    objectives: [pad(0)]},
  {id: 'supply-hop', title: 'Supply hop', scenario: 'base-pad', weather: 'breezy', parSeconds: 260, parFuel: 4,
    brief: 'Lift off, fly over Perseverance\'s landing site to drop a relay, then land on Pad 2. Breezy: expect gusts near the ground.',
    objectives: [{type: 'takeoff', agl: 150, label: 'Climb above 150 m'}, {type: 'gate', lat: 18.4447, lon: 77.4508, agl: 180, radius: 160, label: 'Pass over Perseverance'}, pad(1)]},
  {id: 'canyon-courier', title: 'Canyon courier', scenario: 'canyon', weather: 'calm', parSeconds: 420, parFuel: 6,
    brief: 'Thread five gates down Coprates Chasma, 2 km above the floor with the rims 3 to 8 km above you. Gate 2 dodges a landslide ridge on the north side.',
    objectives: CANYON_GATES.map((g, i) => ({type: 'gate' as const, ...g, radius: 350, label: `Gate ${i + 1}`}))},
  {id: 'storm-landing', title: 'Storm landing', scenario: 'base-approach', weather: 'storm', parSeconds: 200, parFuel: 4,
    brief: 'A regional dust storm is rolling over Jezero. Visibility is about a kilometre and the wind gusts past 30 m/s. Follow the HUD to Pad 1.',
    objectives: [pad(0)]},
  {id: 'night-landing', title: 'Night landing', scenario: 'base-approach', weather: 'calm', night: true, parSeconds: 180, parFuel: 4,
    brief: 'Land on Pad 2 after sunset. The pad lights and your landing lights are all you have; Phobos may be up.',
    objectives: [pad(1)]},
  {id: 'arrival-to-base', title: 'From deep space to Jezero', scenario: 'arrival', weather: 'calm', parSeconds: 1400, parFuel: 30,
    brief: 'The whole trip: capture into Mars orbit, survive entry belly-first, and land within 400 m of Jezero Base.',
    objectives: [{type: 'orbit', label: 'Capture into orbit'}, {type: 'land', ...padLatLon(0), maxDistance: 400, label: 'Land at Jezero Base'}]},
];

export const medalFor = (score: number) => score >= 90 ? 'gold' : score >= 70 ? 'silver' : 'bronze';

/** Component scores 0..100 and the overall medal for a finished mission. */
export function scoreMission(m: Mission, r: {seconds: number; fuelUsed: number; touchdown?: number; distance?: number}) {
  const band = (value: number, gold: number, silver: number, bronze: number) => value <= gold ? 100 : value <= silver ? 75 + 25 * (silver - value) / (silver - gold) : value <= bronze ? 45 + 30 * (bronze - value) / (bronze - silver) : 30;
  const parts: {label: string; value: string; score: number}[] = [
    {label: 'Time', value: `${Math.round(r.seconds)} s`, score: band(r.seconds, m.parSeconds, m.parSeconds * 1.5, m.parSeconds * 2.5)},
    {label: 'Fuel used', value: `${r.fuelUsed.toFixed(1)}%`, score: band(r.fuelUsed, m.parFuel, m.parFuel * 2, m.parFuel * 4)},
  ];
  if (r.touchdown !== undefined) parts.push({label: 'Touchdown', value: `${r.touchdown.toFixed(1)} m/s`, score: band(r.touchdown, 1.5, 3, 5.5)});
  if (r.distance !== undefined) parts.push({label: 'Precision', value: `${r.distance.toFixed(1)} m`, score: band(r.distance, 6, 15, PAD_RADIUS)});
  const total = Math.round(parts.reduce((a, p) => a + p.score, 0) / parts.length);
  return {parts, total, medal: medalFor(total)};
}

export function bestScore(id: string) {
  try {return Number(localStorage.getItem(`pathfinder.best.${id}`)) || 0;} catch {return 0;}
}
export function saveBest(id: string, total: number) {
  try {if (total > bestScore(id)) localStorage.setItem(`pathfinder.best.${id}`, String(total));} catch {/* storage unavailable */}
}
