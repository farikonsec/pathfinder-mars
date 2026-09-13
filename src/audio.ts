export class FlightAudio {
 mood='idle';volume=.6;private beat=0;private nextBeat=0;private ambience:GainNode|null=null;private terminal='';
 setVolume(value:number){this.volume=Math.max(0,Math.min(1,value));if(this.ctx&&this.enabled)this.master!.gain.setTargetAtTime(this.volume,this.ctx.currentTime,.1);}
 private note(f:number,time:number,duration:number,level:number,type:OscillatorType='triangle'){
  const ctx=this.ctx!,osc=ctx.createOscillator(),gain=ctx.createGain();osc.frequency.value=f;osc.type=type;
  gain.gain.setValueAtTime(.0001,time);gain.gain.exponentialRampToValueAtTime(level,time+.015);gain.gain.exponentialRampToValueAtTime(.0001,time+duration);
  osc.connect(gain);gain.connect(this.master!);osc.start(time);osc.stop(time+duration+.02);osc.onended=()=>{osc.disconnect();gain.disconnect();};
 }
 ctx:AudioContext|null=null;master:GainNode|null=null;engine:GainNode|null=null;enabled=false;lastBeep=0;
 private keepAlive:HTMLAudioElement|null=null;
 /**
  * iPhone: Web Audio stays silent unless the context is started inside the tap, and the ring/silent switch mutes it
  * unless the page declares playback audio. A silent looping media element does that on older iOS versions.
  */
 private unlockIOS(){
  const ctx=this.ctx!;
  try{(navigator as unknown as {audioSession?:{type:string}}).audioSession!.type='playback';}catch{/* not Safari 16.4+ */}
  if(!this.keepAlive){
   const rate=8000,samples=rate/2,buf=new ArrayBuffer(44+samples),v=new DataView(buf),w=(o:number,t:string)=>[...t].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
   w(0,'RIFF');v.setUint32(4,36+samples,true);w(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate,true);v.setUint16(32,1,true);v.setUint16(34,8,true);w(36,'data');v.setUint32(40,samples,true);
   for(let i=0;i<samples;i++)v.setUint8(44+i,128);
   const el=new Audio(URL.createObjectURL(new Blob([buf],{type:'audio/wav'})));el.loop=true;el.setAttribute('playsinline','');el.volume=.01;this.keepAlive=el;
  }
  this.keepAlive.play().catch(()=>{});
  // A one-sample buffer played inside the gesture fully wakes the context.
  const b=ctx.createBuffer(1,1,22050),src=ctx.createBufferSource();src.buffer=b;src.connect(ctx.destination);src.start(0);
  if(ctx.state!=='running')ctx.resume().catch(()=>{});
 }
 private watchResume(){
  // iOS suspends ("interrupted") the context after calls, lock screen or app switching; wake it on the next touch.
  const wake=()=>{if(this.enabled&&this.ctx&&this.ctx.state!=='running'){this.ctx.resume().catch(()=>{});this.keepAlive?.play().catch(()=>{});}};
  for(const t of ['pointerdown','touchend','keydown'])addEventListener(t,wake,{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)wake();else this.keepAlive?.pause();});
 }
 toggle():Promise<boolean>{if(!this.ctx){const AC=window.AudioContext??(window as unknown as {webkitAudioContext:typeof AudioContext}).webkitAudioContext;this.ctx=new AC();this.watchResume();this.master=this.ctx.createGain();this.master.gain.value=0;
 // Phone speakers cannot reproduce the 55-165 Hz pad, so a gentle compressor and an upper voicing keep the score audible there.
 const comp=this.ctx.createDynamicsCompressor();comp.threshold.value=-24;comp.ratio.value=3;comp.attack.value=.01;comp.release.value=.25;const makeup=this.ctx.createGain();makeup.gain.value=1.6;this.master.connect(comp);comp.connect(makeup);makeup.connect(this.ctx.destination);this.ambience=this.ctx.createGain();this.ambience.gain.value=.82;this.ambience.connect(this.master);
 // Original generative score: a quiet open A-major add9 pad. It contains no sampled or licensed music.
 for(const [i,f] of [55,82.4069,110,138.5913,164.8138,246.9417,329.6276,440,554.3653].entries()){const osc=this.ctx.createOscillator(),g=this.ctx.createGain();osc.type='sine';osc.frequency.value=f;g.gain.value=f>300?.007:.018;const lfo=this.ctx.createOscillator(),lg=this.ctx.createGain();lfo.frequency.value=.04+i*.009;lg.gain.value=.011;lfo.connect(lg);lg.connect(g.gain);osc.connect(g);g.connect(this.ambience!);osc.start();lfo.start();}
 const osc=this.ctx.createOscillator();osc.type='sawtooth';osc.frequency.value=38;const filter=this.ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=160;this.engine=this.ctx.createGain();this.engine.gain.value=0;osc.connect(filter);filter.connect(this.engine);this.engine.connect(this.master);osc.start();}
 this.enabled=!this.enabled;
 // Everything above and the unlock below run synchronously inside the tap; iOS rejects audio started after an await.
 if(this.enabled)this.unlockIOS();else this.keepAlive?.pause();
 this.master!.gain.setTargetAtTime(this.enabled?this.volume:0,this.ctx.currentTime,.3);this.nextBeat=this.ctx.currentTime;
 if(this.enabled){this.note(659.25,this.ctx.currentTime+.05,.25,.03,'sine');this.note(880,this.ctx.currentTime+.18,.35,.025,'sine');}
 return this.ctx.resume().then(()=>this.enabled,()=>this.enabled);}
 update(throttle:number,danger:boolean,escaped=false,active=true){
  this.mood=!active?'idle':danger?'danger':escaped?'escape':throttle>.05?'burn':'cruise';
  if(!this.ctx||!this.enabled)return;
  const now=this.ctx.currentTime,intense=this.mood==='danger'||this.mood==='burn';
  this.ambience!.gain.setTargetAtTime(active?(escaped?.55:.82):.0001,now,active?.7:.16);
  const terminal=!active?'silent':escaped?'landed':'';
  if(terminal!==this.terminal){this.terminal=terminal;if(terminal==='landed'){this.note(440,now,.7,.026,'sine');this.note(554.37,now+.16,.9,.02,'sine');this.note(659.25,now+.34,1.2,.018,'sine');}}
  this.engine!.gain.setTargetAtTime(active?throttle*.12:0,now,.15);
  const tempo=danger?126:intense?116:escaped?108:96;
  if(this.nextBeat<now-.2)this.nextBeat=now;
  if(active&&this.nextBeat<now+.08){
   // I–V–vi–IV in A major: hopeful and forward-moving. Danger swaps to a suspended colour, not a minor key.
   const t=Math.max(now,this.nextBeat),step=this.beat++,bar=Math.floor(step/16)%4,root=55*2**([0,7,5,0][bar]/12);
   const chord=danger?[0,5,7,12,14,17,12,7]:[0,4,7,12,16,19,16,12];
   const melody=[0,2,4,7,9,12,9,7,4,7,9,12,14,12,9,7];
   const f=root*4*2**(chord[step%8]/12);
   this.note(f,t,intense?.22:.5,intense?.04:.024);
   if(step%2===0)this.note(root*8*2**(melody[(step/2+bar*3)%16]/12),t+.02,.35,.02,'sine');
   this.note(f*2,t+.18,.4,.006,'sine');
   if(step%4===0){this.note(root,t,.5,.06,'sine');if(intense)this.note(55,t,.12,.07,'sine');}
   if(step%8===4)this.note(root*2,t,.3,.03,'triangle');
   if(intense&&step%2===1)this.note(2400+(step%3)*300,t,.03,.005);
   this.nextBeat=t+60/tempo/2;
  }else if(!active)this.nextBeat=now;
  if(active&&danger&&now-this.lastBeep>2.2){this.lastBeep=now;this.note(880,now,.12,.025,'sine');this.note(1108.73,now+.13,.12,.02,'sine');}
 }
}
