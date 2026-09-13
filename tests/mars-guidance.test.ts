import {test,expect} from 'bun:test';
import {marsInitial,marsMoonState,advanceMars} from '../src/mars';
import {add} from '../src/vector';
import {rendezvousCommand} from '../src/mars-guidance';
for(const i of [0,1])test(`moving moon ${i} rendezvous brakes into a safe stand-off`,()=>{
 const s=marsInitial(),moon=marsMoonState(i,0);s.p=add(moon.p,[150,30,100]);s.v=add(moon.v,[.03,0,-.02]);
 let command=rendezvousCommand(s,i),elapsed=0;
 while(!command.arrived&&elapsed<2400&&s.status==='flying'){advanceMars(s,1,command.thrust);command=rendezvousCommand(s,i);elapsed++;}
 expect(s.status).toBe('flying');expect(command.arrived).toBe(true);expect(s.fuel).toBeLessThan(100);
});
