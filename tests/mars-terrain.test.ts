import {test,expect} from 'bun:test';
import {MarsTerrain} from '../src/mars-terrain';
import * as T from 'three';
const terrain=new MarsTerrain(await Bun.file(new URL('../public/textures/mars-radius.img',import.meta.url)).arrayBuffer());
test('MOLA radii have metre offsets, finite ranges and seamless longitude',()=>{
 for(let lat=-89;lat<90;lat+=10)for(let lon=0;lon<360;lon+=10){const r=terrain.radius(lat,lon);expect(r).toBeGreaterThan(3360);expect(r).toBeLessThan(3430);}
 expect(terrain.radius(12,-1)).toBeCloseTo(terrain.radius(12,359),10);
 expect(terrain.radius(18.65,226.2)).toBeGreaterThan(terrain.radius(-42,70));
});
test('canyon mesh faces outward and matches the collision radius at measured vertices',async()=>{
 const regional=new MarsTerrain(await Bun.file(new URL('../public/textures/mars-radius.img',import.meta.url)).arrayBuffer());
 regional.setCanyon(await Bun.file(new URL('../public/textures/mars-canyon-radius.img',import.meta.url)).arrayBuffer());
 expect(regional.radius(-8,285)).toBeGreaterThan(3360);
 expect(regional.radius(-8,285)).toBeLessThan(3430);
 expect(regional.radius(-8,280)).toBe(terrain.radius(-8,280));
 expect(regional.radius(-8,280.000001)).toBeCloseTo(terrain.radius(-8,280),4);
 const mesh=regional.canyonGeometry(40,32),positions=mesh.getAttribute('position'),index=mesh.index!;
 for(let i=0;i<positions.count;i+=17){const p=new T.Vector3().fromBufferAttribute(positions,i);expect(regional.radiusAt(p.toArray().map(n=>n*1000) as [number,number,number],0)).toBeCloseTo(p.length()*1000,2);}
 for(let i=0;i<index.count;i+=93){const a=new T.Vector3().fromBufferAttribute(positions,index.getX(i)),b=new T.Vector3().fromBufferAttribute(positions,index.getX(i+1)),c=new T.Vector3().fromBufferAttribute(positions,index.getX(i+2));expect(b.sub(a).cross(c.sub(a)).dot(a)).toBeGreaterThan(0);}
 mesh.dispose();
});
test('terrain mesh uses measured radius without vertical exaggeration',()=>{
 const g=terrain.geometry(64,32),p=g.getAttribute('position');
 for(let i=0;i<p.count;i++){expect(Math.hypot(p.getX(i),p.getY(i),p.getZ(i))).toBeGreaterThan(3.36);expect(Math.hypot(p.getX(i),p.getY(i),p.getZ(i))).toBeLessThan(3.43);}g.dispose();
});
