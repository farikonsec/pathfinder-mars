import {test,expect} from 'bun:test';
import {MARS,marsMoonState,marsInitial,advanceMars,marsSpecificEnergy} from '../src/mars';
import {len,add} from '../src/vector';
test('entry drag uses atmospheric-relative speed and heats fast arrivals',()=>{
 const s=marsInitial();s.p=[MARS.radius+15,0,0];s.v=[-.01,0,4];advanceMars(s,1,[0,0,0],true,()=>MARS.radius);
 expect(s.dynamicPressure!).toBeGreaterThan(1000);expect(s.heat!).toBeGreaterThan(0);expect(len(s.v)).toBeLessThan(4);
});
test('low-speed touchdown lands but a fast arrival impacts',()=>{
 for(const speed of [.001,.1]){const s=marsInitial();s.landingReady=true;s.p=[MARS.radius+.0001,0,0];s.v=[-speed,0,-2*Math.PI/MARS.rotation*s.p[0]];advanceMars(s,.5,[0,0,0],true,()=>MARS.radius);expect(s.status).toBe(speed<.003?'landed':'impact');}
});
test('Mars reference gravity and moon periods match expected scales',()=>{
 expect(MARS.mu/MARS.radius**2*1000).toBeCloseTo(3.727,2);
 expect(marsMoonState(0,0).period/3600).toBeCloseTo(7.65,1);
 expect(marsMoonState(1,0).period/3600).toBeCloseTo(30.3,1);
});
test('Mars circular orbit conserves energy without perturbations',()=>{
 const s=marsInitial(),r=4000;s.p=[r,0,0];s.v=[0,0,Math.sqrt(MARS.mu/r)];const e=marsSpecificEnergy(s);
 advanceMars(s,2*Math.PI*Math.sqrt(r**3/MARS.mu),[0,0,0],false);
 expect(s.status).toBe('flying');expect(Math.abs(len(s.p)-r)/r).toBeLessThan(1e-7);expect(Math.abs(marsSpecificEnergy(s)-e)).toBeLessThan(1e-8);
});
test('Mars time compression preserves state and exhausted fuel cannot accelerate',()=>{
 const a=marsInitial(),b=marsInitial();a.fuel=b.fuel=0;advanceMars(a,60,[1,0,0]);for(let i=0;i<120;i++)advanceMars(b,.5);
 expect(a.p).toEqual(b.p);expect(a.v).toEqual(b.v);expect(a.fuel).toBe(0);
});
test('small Phobos is not skipped between integration endpoints',()=>{
 const s=marsInitial(),moon=marsMoonState(0,0);s.p=add(moon.p,[-30,0,0]);s.v=add(moon.v,[120,0,0]);advanceMars(s,.5);
 expect(s.status).toBe('impact');expect(s.body).toBe('Phobos');
});
test('Phobos departure starts clear of both bodies and remains viable',()=>{
 const s=marsInitial();advanceMars(s,120);expect(s.status).toBe('flying');expect(s.p.every(Number.isFinite)).toBe(true);
});
