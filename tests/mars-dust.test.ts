import {test,expect} from 'bun:test';
import * as T from 'three';
import {DustSystem} from '../src/mars-dust';

const flat = () => 0;
const down = new T.Vector3(0, -1, 0);

test('hover jets raise dust near the ground but not from high up', () => {
  const low = new DustSystem(), high = new DustSystem();
  for (let i = 0; i < 60; i++) {
    low.update(1 / 60, new T.Vector3(0, 12, 0), flat, [{dir: down, power: 1, reach: 70}], null);
    high.update(1 / 60, new T.Vector3(0, 400, 0), flat, [{dir: down, power: 1, reach: 70}], null);
  }
  expect(low.alive).toBeGreaterThan(60);
  expect(high.alive).toBe(0);
});

test('dust clouds settle and clear after the engines stop', () => {
  const d = new DustSystem();
  for (let i = 0; i < 60; i++) d.update(1 / 60, new T.Vector3(0, 8, 0), flat, [{dir: down, power: 1, reach: 70}], null);
  const peak = d.alive;
  for (let i = 0; i < 60 * 12; i++) d.update(1 / 60, new T.Vector3(0, 8, 0), flat, [], null);
  expect(peak).toBeGreaterThan(0);
  expect(d.alive).toBe(0);
});

test('a low fast pass leaves a rooster tail behind the ship', () => {
  const d = new DustSystem();
  for (let i = 0; i < 120; i++) d.update(1 / 60, new T.Vector3(0, 6, 0), flat, [], {speed: 180, agl: 6, dir: new T.Vector3(1, 0, 0)});
  expect(d.alive).toBeGreaterThan(20);
});
