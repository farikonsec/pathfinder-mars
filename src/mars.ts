import {add,mul,len,dot,segmentHitsSphere,type V} from './vector';

// km, seconds. JPL MAR097 GM and mean moon radii:
// https://ssd.jpl.nasa.gov/sats/phys_par/
// Circular, equatorial moon paths with fictional starting phases, not an epoch ephemeris.
export const MARS={name:'Mars',mu:42828.37362,radius:3389.5,rotation:88642.7};
export const MARS_MOONS=[
 {name:'Phobos',mu:.0007087,radius:11.08,orbit:9376,phase:0},
 {name:'Deimos',mu:.0000962,radius:6.2,orbit:23463,phase:2.1},
] as const;
export function marsMoonState(index:number,time:number){
 const m=MARS_MOONS[index];if(!m)throw new RangeError('Unknown Mars moon');
 const omega=Math.sqrt(MARS.mu/m.orbit**3),a=m.phase+omega*time;
 return {p:[Math.cos(a)*m.orbit,0,Math.sin(a)*m.orbit] as V,v:[-Math.sin(a)*m.orbit*omega,0,Math.cos(a)*m.orbit*omega] as V,period:2*Math.PI/omega};
}
export interface MarsState {p:V;v:V;t:number;fuel:number;status:'flying'|'impact'|'landed';body:string;heat?:number;dynamicPressure?:number;landingReady?:boolean;}
export function marsInitial():MarsState {
 const moon=marsMoonState(0,0);
 return {p:add(moon.p,[0,0,40]),v:[...moon.v],t:0,fuel:100,status:'flying',body:''};
}
export function marsGravity(p:V,time:number,moons=true):V {
 let a=mul(p,-MARS.mu/Math.max(len(p),1e-6)**3);
 if(moons)MARS_MOONS.forEach((m,i)=>{const mp=marsMoonState(i,time).p,delta=add(mp,mul(p,-1));a=add(a,add(mul(delta,m.mu/Math.max(len(delta),1e-6)**3),mul(mp,-m.mu/len(mp)**3)));});
 return a;
}
/** Vacuum integrator. Terrain, atmosphere and landing classification will layer on this baseline. */
export function advanceMars(s:MarsState,seconds:number,thrust:V=[0,0,0],perturb=true,surface?:(p:V,time:number)=>number){
 if(!Number.isFinite(seconds)||seconds<0)throw new RangeError('Invalid simulation duration');
 let left=seconds;
 while(left>1e-9&&s.status==='flying'){
  const dt=Math.min(left,surface&&len(s.p)-surface(s.p,s.t)<150?.05:.5),old=s.p,oldTime=s.t;
  const demand=len(thrust)*dt*.022,actual=mul(thrust,Math.min(1,s.fuel/(demand||1)));
  const a=add(marsGravity(s.p,s.t,perturb),actual),next=add(add(s.p,mul(s.v,dt)),mul(a,dt*dt*.5));
  const b=add(marsGravity(next,s.t+dt,perturb),actual);
  s.v=add(s.v,mul(add(a,b),dt*.5));s.p=next;s.t+=dt;s.fuel=Math.max(0,s.fuel-demand);
  if(surface){
    const altitude=len(next)-surface(next,s.t),omega=2*Math.PI/MARS.rotation;
    const atmosphereVelocity:V=[omega*next[2],0,-omega*next[0]],relative=add(s.v,mul(atmosphereVelocity,-1)),speed=len(relative)*1000;
    // Reference exponential atmosphere and fictional vehicle ballistic coefficient (kg/m²).
    const density=.02*Math.exp(-Math.max(-10,altitude)/10.8),pressure=.5*density*speed*speed;
    s.dynamicPressure=pressure;s.v=add(s.v,mul(relative,-Math.min(.2,density*speed*dt/(2*600))));
    s.heat=Math.max(0,(s.heat??0)+(Math.sqrt(density/.02)*(speed/1000)**3*.12-.08)*dt);
    if(altitude<=0){s.status=s.landingReady&&len(relative)<.003?'landed':'impact';s.body='Mars';s.v=atmosphereVelocity;}
    if((s.heat??0)>100){s.status='impact';s.body='Atmospheric heating';}
  }else if(segmentHitsSphere(old,next,MARS.radius)){s.status='impact';s.body=MARS.name;}
  MARS_MOONS.forEach((m,i)=>{if(segmentHitsSphere(add(old,mul(marsMoonState(i,oldTime).p,-1)),add(next,mul(marsMoonState(i,s.t).p,-1)),m.radius)){s.status='impact';s.body=m.name;}});
  left-=dt;
 }
}
export function marsSpecificEnergy(s:MarsState){return dot(s.v,s.v)/2-MARS.mu/len(s.p);}
