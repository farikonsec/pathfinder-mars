import {test,expect} from 'bun:test';
import {sunlightVisibility} from '../src/vector';

test('finite Sun shadows distinguish umbra, penumbra, and irrelevant occluders',()=>{
 const sun:[number,number,number]=[778000000,0,0];
 expect(sunlightVisibility([0,0,0],sun,[400000,0,0],1800)).toBe(0);
 expect(sunlightVisibility([0,0,0],sun,[400000,1800,0],1800)).toBeCloseTo(.5);
 expect(sunlightVisibility([0,0,0],sun,[400000,3000,0],1800)).toBe(1);
 expect(sunlightVisibility([0,0,0],sun,[-400000,0,0],1800)).toBe(1);
 expect(sunlightVisibility([0,0,0],sun,[800000000,0,0],1800)).toBe(1);
});
