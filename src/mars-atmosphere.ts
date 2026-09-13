import * as T from 'three';

/** Single-scattering dust approximation. Integrates density along the viewing ray;
 * coefficients are art-directed, not a calibrated Martian radiative-transfer model. */
export function createMarsAtmosphere(){
 const material=new T.ShaderMaterial({transparent:true,depthWrite:false,depthTest:false,
  uniforms:{eye:{value:new T.Vector3()},inverseProjection:{value:new T.Matrix4()},cameraRotation:{value:new T.Matrix4()},sunDirection:{value:new T.Vector3(1,0,.3).normalize()},fade:{value:1}},
  vertexShader:`varying vec2 screenUV;void main(){screenUV=uv;gl_Position=vec4(position.xy,0.,1.);}`,
  fragmentShader:`precision highp float;
    varying vec2 screenUV;uniform vec3 eye;uniform mat4 inverseProjection;uniform mat4 cameraRotation;uniform vec3 sunDirection;uniform float fade;
    vec2 sphere(vec3 origin,vec3 ray,float radius){float b=dot(origin,ray),c=dot(origin,origin)-radius*radius,d=b*b-c;if(d<0.)return vec2(1e8,-1e8);float root=sqrt(d);return vec2(-b-root,-b+root);}
    void main(){
      vec4 view=inverseProjection*vec4(screenUV*2.-1.,1.,1.);vec3 ray=normalize(mat3(cameraRotation)*view.xyz);
      vec2 shell=sphere(eye,ray,3469.5);float start=max(0.,shell.x),end=shell.y;
      vec2 ground=sphere(eye,ray,3389.5);if(ground.x>0.)end=min(end,ground.x);
      if(end<=start){gl_FragColor=vec4(0.);return;}
      float stride=(end-start)/24.,optical=0.;vec3 scattering=vec3(0.);
      float mu=dot(ray,sunDirection),phase=.45+.55*pow(max(0.,mu),8.);
      for(int i=0;i<24;i++){
        vec3 pos=eye+ray*(start+(float(i)+.5)*stride);float height=max(0.,length(pos)-3389.5);
        float density=exp(-height/10.8);float segment=density*stride*.012;
        vec2 shadow=sphere(pos,sunDirection,3389.5);
        float daylight=shadow.x>0.?0.:smoothstep(-.12,.15,dot(normalize(pos),sunDirection));
        vec3 tint=mix(vec3(.32,.20,.15),vec3(.78,.49,.28),daylight);
        scattering+=exp(-optical)*segment*tint*(.12+daylight*phase);optical+=segment;
      }
      float alpha=(1.-exp(-optical))*fade;gl_FragColor=vec4(scattering/max(1.-exp(-optical),.00001),alpha);
    }`});
 const scene=new T.Scene();scene.add(new T.Mesh(new T.PlaneGeometry(2,2),material));
 return {scene,material,camera:new T.Camera()};
}
