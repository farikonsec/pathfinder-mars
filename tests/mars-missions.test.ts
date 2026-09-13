import {test,expect} from 'bun:test';
import {MISSIONS,scoreMission,medalFor} from '../src/mars-missions';
import {BASE,PADS,padLatLon,baseLocalDir} from '../src/mars-base';
import {latLonToDir} from '../src/mars-geo';
import {Weather} from '../src/mars-weather';

test('pads sit where the base layout says, a couple of hundred metres from the hub', () => {
  const centre = latLonToDir(BASE.lat, BASE.lon);
  PADS.forEach((p, i) => {
    const d = latLonToDir(padLatLon(i).lat, padLatLon(i).lon), metres = Math.acos(centre[0] * d[0] + centre[1] * d[1] + centre[2] * d[2]) * 3389500;
    expect(Math.abs(metres - Math.hypot(p.x, p.z))).toBeLessThan(1);
  });
  const east = baseLocalDir(100, 0), north = baseLocalDir(0, -100);
  expect(east[0] * centre[2] - east[2] * centre[0]).not.toBe(0);
  expect(latLonToDir(BASE.lat, BASE.lon)[1]).toBeLessThan(north[1]); // -z is north: higher y at this northern latitude
});

test('Jezero Base sits a short hop from Perseverance, not on top of it', () => {
  const a = latLonToDir(BASE.lat, BASE.lon), b = latLonToDir(18.4447, 77.4508);
  const km = Math.acos(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) * 3389.5;
  expect(km).toBeGreaterThan(1.5); expect(km).toBeLessThan(5);
});

test('a soft, precise, quick landing earns gold and a sloppy one does not', () => {
  const m = MISSIONS.find(x => x.id === 'first-landing')!;
  const good = scoreMission(m, {seconds: 120, fuelUsed: 2, touchdown: 1.1, distance: 3});
  const poor = scoreMission(m, {seconds: 500, fuelUsed: 15, touchdown: 5.8, distance: 30});
  expect(good.medal).toBe('gold'); expect(poor.medal).toBe('bronze');
  expect(medalFor(75)).toBe('silver');
});

test('every mission starts from a real scenario and ends with a goal', () => {
  const scenarios = ['base-pad', 'base-approach', 'canyon', 'arrival'];
  for (const m of MISSIONS) {expect(scenarios).toContain(m.scenario); expect(m.objectives.length).toBeGreaterThan(0);}
});

test('storms blow harder than calm days and devils only form in daylight without storms', () => {
  const w = new Weather();
  const calm = Array.from({length: 200}, (_, i) => Math.hypot(w.windEN(i * 7, 20).e, w.windEN(i * 7, 20).n)).reduce((a, b) => a + b) / 200;
  w.mode = 'storm';
  const storm = Array.from({length: 200}, (_, i) => Math.hypot(w.windEN(i * 7, 20).e, w.windEN(i * 7, 20).n)).reduce((a, b) => a + b) / 200;
  expect(storm).toBeGreaterThan(calm * 4);
  expect(w.devils(0, 0, 0, 1)).toHaveLength(0);
  w.mode = 'breezy';
  expect(w.devils(0, 0, 0, 1).length).toBeGreaterThan(0);
  expect(w.devils(0, 0, 0, .1)).toHaveLength(0);
  const d = w.devils(0, 0, 0, 1)[0], push = w.devilWind([d], d.x + d.radius, d.z, 20);
  expect(Math.hypot(push.e, push.n)).toBeGreaterThan(5);
});
