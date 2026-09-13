import * as T from 'three';
import {MARS} from './mars';
import type {V} from './vector';
import {MolaHeights,dirToLatLon,inertialToBody,latLonToDir} from './mars-geo';

/** Orbital globe mesh from PDS MOLA MEGR 4 pixels/degree. Units: world km/1000. Longitudes are east-positive. */
export class MarsTerrain {
  readonly heights:MolaHeights;
  private hasCanyon=false;
  constructor(buffer:ArrayBuffer){this.heights=new MolaHeights(buffer);}
  setCanyon(buffer:ArrayBuffer){this.heights.setCanyon(buffer);this.hasCanyon=true;}
  /** Radius in km. */
  radius(latitude:number,longitude:number){return this.heights.radius(latitude,longitude)/1000;}
  radiusAt(p:V,time:number){const {lat,lon}=dirToLatLon(inertialToBody(p,time,MARS.rotation));return this.radius(lat,lon);}
  geometry(width=720,height=360){
    const g=new T.SphereGeometry(1,width,height),positions=g.getAttribute('position');
    for(let i=0;i<positions.count;i++){const v=new T.Vector3().fromBufferAttribute(positions,i).normalize();const {lat,lon}=dirToLatLon(v.toArray() as V);const r=this.radius(lat,lon)/1000;positions.setXYZ(i,v.x*r,v.y*r,v.z*r);}
    if(this.hasCanyon){const indices:number[]=[];const index=g.index!;for(let i=0;i<index.count;i+=3){const v=new T.Vector3();for(let j=0;j<3;j++)v.add(new T.Vector3().fromBufferAttribute(positions,index.getX(i+j)));const {lat,lon}=dirToLatLon(v.toArray() as V),east=(lon+360)%360;if(!(lat<0&&lat>-16&&east>280&&east<300))indices.push(index.getX(i),index.getX(i+1),index.getX(i+2));}g.setIndex(indices);}
    g.computeVertexNormals();g.computeBoundingSphere();return g;
  }
  canyonGeometry(width=640,height=512){
    const positions:number[]=[],uv:number[]=[],indices:number[]=[];
    for(let y=0;y<=height;y++)for(let x=0;x<=width;x++){const lat=-16*y/height,lon=280+20*x/width,r=this.radius(lat,lon)/1000,d=latLonToDir(lat,lon);positions.push(d[0]*r,d[1]*r,d[2]*r);uv.push((.5+lon/360)%1,.5+lat/180);}
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=y*(width+1)+x,b=a+1,c=a+width+1,d=c+1;indices.push(a,c,b,b,c,d);}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingSphere();return g;
  }
  /**
   * Tangent-space normal map from MOLA radii for the orbital globe, so scarps and calderas catch low sunlight.
   * `relief` > 1 steepens shading only; geometry keeps true scale.
   */
  normalMap(width = 2048, height = 1024, relief = 3) {
    const h = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const lat = 90 - (y + .5) / height * 180, lon = (x + .5) / width * 360 - 180;
      h[y * width + x] = this.heights.radius(lat, lon);
    }
    const data = new Uint8Array(width * height * 4), R = MARS.radius * 1000;
    for (let y = 0; y < height; y++) {
      const lat = (90 - (y + .5) / height * 180) * Math.PI / 180;
      const dx = 2 * Math.PI * R * Math.max(.05, Math.cos(lat)) / width, dy = Math.PI * R / height;
      for (let x = 0; x < width; x++) {
        const e = h[y * width + (x + 1) % width] - h[y * width + (x - 1 + width) % width];
        const n = h[Math.max(0, y - 1) * width + x] - h[Math.min(height - 1, y + 1) * width + x];
        let nx = -e / (2 * dx) * relief, ny = -n / (2 * dy) * relief, nz = 1;
        const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        // Rows are north-up in the image; three.js flips textures so v grows north.
        const i = ((height - 1 - y) * width + x) * 4;
        data[i] = (nx * .5 + .5) * 255; data[i + 1] = (ny * .5 + .5) * 255; data[i + 2] = (nz * .5 + .5) * 255; data[i + 3] = 255;
      }
    }
    const tex = new T.DataTexture(data, width, height, T.RGBAFormat);
    tex.wrapS = T.RepeatWrapping; tex.magFilter = T.LinearFilter; tex.minFilter = T.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
    return tex;
  }
}
