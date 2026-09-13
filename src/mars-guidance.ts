import {MARS_MOONS,marsMoonState,marsGravity,type MarsState} from './mars';
import {add,mul,len,type V} from './vector';

/** Cancellable rendezvous assist for the fictional high-thrust vehicle.
 * Tracks a stand-off point ahead of the moving moon, rather than its surface. */
export function rendezvousCommand(s:MarsState,index:number):{thrust:V;distance:number;relativeSpeed:number;arrived:boolean}{
 const moon=marsMoonState(index,s.t),m=MARS_MOONS[index],standOff=m.radius+8;
 const radial=mul(moon.p,1/len(moon.p)),target=add(moon.p,mul(radial,standOff));
 const targetVelocity=mul(moon.v,1+standOff/m.orbit),dp=add(target,mul(s.p,-1)),dv=add(targetVelocity,mul(s.v,-1));
 const distance=len(dp),relativeSpeed=len(dv),horizon=Math.max(30,Math.min(900,Math.sqrt(distance/.008)*2));
 const correction=add(mul(dp,4/horizon**2),mul(dv,4/horizon));
 const omega=2*Math.PI/moon.period,feedForward=mul(target,-omega*omega);
 const demand=add(correction,add(feedForward,mul(marsGravity(s.p,s.t),-1))),magnitude=len(demand);
 return {thrust:mul(demand,Math.min(1,.0196133/(magnitude||1))),distance,relativeSpeed,arrived:distance<.5&&relativeSpeed<.005};
}
