/**
 * "Red Horizon": an original 8-bit score written for this game, synthesised live with Web Audio.
 * 80s space-age synth-pop in spirit (slow starry opening, warm major-key tune, driving bass, a remix break).
 * Every melody, chord sequence and bass line here is original; nothing is sampled, transcribed or licensed.
 */

type Note = [step: number, midi: number, length: number];
interface Section {name: string; bars: number; chords: number[][]; lead: Note[][]; drums: 0 | 1 | 2; arp: 'slow' | 'eighth' | 'chop'; bass: 'none' | 'pulse' | 'drive' | 'jump';}

const D = [50, 54, 57], Bm = [47, 50, 54], G = [43, 47, 50], A = [45, 49, 52], Fsm = [42, 45, 49], Em = [40, 43, 47];
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

const INTRO: Section = {name: 'intro', bars: 4, chords: [D, G, Bm, A], drums: 0, arp: 'slow', bass: 'none', lead: [
  [[0, 81, 16]], [[0, 83, 12], [12, 81, 4]], [[0, 78, 16]], [[0, 76, 8], [8, 73, 8]],
]};
const VERSE: Section = {name: 'verse', bars: 8, chords: [D, Bm, G, A, D, Bm, G, A], drums: 1, arp: 'eighth', bass: 'pulse', lead: [
  [[0, 78, 6], [6, 76, 2], [8, 74, 4], [12, 69, 4]],
  [[0, 71, 6], [6, 73, 2], [8, 74, 4], [12, 78, 4]],
  [[0, 79, 4], [4, 78, 4], [8, 76, 4], [12, 74, 4]],
  [[0, 76, 8], [8, 73, 4], [12, 69, 4]],
  [[0, 69, 4], [4, 74, 4], [8, 78, 6], [14, 76, 2]],
  [[0, 74, 4], [4, 71, 4], [8, 66, 8]],
  [[0, 67, 4], [4, 71, 4], [8, 74, 4], [12, 79, 4]],
  [[0, 78, 6], [6, 76, 2], [8, 76, 8]],
]};
const CHORUS: Section = {name: 'chorus', bars: 8, chords: [G, A, Fsm, Bm, G, A, D, D], drums: 2, arp: 'eighth', bass: 'drive', lead: [
  [[0, 83, 4], [4, 81, 4], [8, 79, 4], [12, 74, 4]],
  [[0, 76, 4], [4, 81, 8], [12, 76, 4]],
  [[0, 78, 6], [6, 81, 2], [8, 85, 8]],
  [[0, 83, 8], [8, 78, 4], [12, 74, 4]],
  [[0, 74, 2], [2, 79, 2], [4, 83, 4], [8, 81, 4], [12, 79, 4]],
  [[0, 81, 6], [6, 79, 2], [8, 76, 4], [12, 73, 4]],
  [[0, 74, 16]],
  [[8, 69, 2], [10, 74, 2], [12, 78, 2], [14, 81, 2]],
]};
const REMIX: Section = {name: 'remix', bars: 8, chords: [Bm, G, D, A, Em, G, A, A], drums: 2, arp: 'chop', bass: 'jump', lead: [
  [[0, 78, 2], [3, 78, 1], [4, 76, 2], [8, 74, 2], [11, 74, 1], [12, 71, 4]],
  [], [[0, 78, 2], [3, 78, 1], [4, 81, 2], [8, 83, 4], [12, 81, 4]], [],
  [[0, 79, 3], [3, 76, 3], [6, 71, 2], [8, 79, 3], [11, 83, 3], [14, 86, 2]],
  [[0, 86, 8], [8, 83, 8]], [[0, 85, 4], [4, 81, 4], [8, 76, 4], [12, 73, 4]], [[0, 81, 16]],
]};
/** Intro plays once; then verse, chorus, verse, remix, chorus loop. */
const LOOP = [VERSE, CHORUS, VERSE, REMIX, CHORUS];

export class FlightAudio {
  mood = 'idle'; volume = .6; enabled = false; lastBeep = 0;
  ctx: AudioContext | null = null; master: GainNode | null = null; engine: GainNode | null = null;
  private music: GainNode | null = null; private echo: GainNode | null = null; private noise: AudioBuffer | null = null;
  private pulse25: PeriodicWave | null = null; private pulse12: PeriodicWave | null = null;
  private keepAlive: HTMLAudioElement | null = null; private terminal = '';
  private nextStep = 0; private section = INTRO; private sectionIndex = -1; private bar = 0; private step = 0;

  setVolume(value: number) {this.volume = Math.max(0, Math.min(1, value)); if (this.ctx && this.enabled) this.master!.gain.setTargetAtTime(this.volume, this.ctx.currentTime, .1);}

  // ---------------------------------------------------------------- instruments
  private voice(freq: number, time: number, length: number, level: number, wave: OscillatorType | PeriodicWave, dest: AudioNode, opts: {vibrato?: boolean; glideFrom?: number; release?: number} = {}) {
    const ctx = this.ctx!, osc = ctx.createOscillator(), gain = ctx.createGain(), release = opts.release ?? .06;
    if (wave instanceof PeriodicWave) osc.setPeriodicWave(wave); else osc.type = wave;
    osc.frequency.setValueAtTime(opts.glideFrom ?? freq, time);
    if (opts.glideFrom) osc.frequency.exponentialRampToValueAtTime(freq, time + .05);
    if (opts.vibrato && length > .25) {
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = 5.5; depth.gain.setValueAtTime(0, time); depth.gain.linearRampToValueAtTime(freq * .012, time + .25);
      lfo.connect(depth); depth.connect(osc.frequency); lfo.start(time); lfo.stop(time + length + release);
    }
    gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(level, time + .008);
    gain.gain.setValueAtTime(level * .8, time + Math.max(.01, length - .02)); gain.gain.linearRampToValueAtTime(0, time + length + release);
    osc.connect(gain); gain.connect(dest); osc.start(time); osc.stop(time + length + release + .02);
    osc.onended = () => {osc.disconnect(); gain.disconnect();};
  }
  private hit(kind: 'kick' | 'snare' | 'hat', time: number, level: number) {
    const ctx = this.ctx!, out = this.music!;
    if (kind === 'kick') {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'triangle'; osc.frequency.setValueAtTime(160, time); osc.frequency.exponentialRampToValueAtTime(42, time + .12);
      g.gain.setValueAtTime(level, time); g.gain.exponentialRampToValueAtTime(.001, time + .18);
      osc.connect(g); g.connect(out); osc.start(time); osc.stop(time + .2); osc.onended = () => {osc.disconnect(); g.disconnect();};
      return;
    }
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), g = ctx.createGain(), dur = kind === 'hat' ? .035 : .14;
    src.buffer = this.noise; filter.type = kind === 'hat' ? 'highpass' : 'bandpass'; filter.frequency.value = kind === 'hat' ? 7000 : 1800;
    g.gain.setValueAtTime(level, time); g.gain.exponentialRampToValueAtTime(.001, time + dur);
    src.connect(filter); filter.connect(g); g.connect(out); src.start(time, Math.random() * .5); src.stop(time + dur + .01);
    src.onended = () => {src.disconnect(); filter.disconnect(); g.disconnect();};
    if (kind === 'snare') this.voice(190, time, .05, level * .5, 'triangle', out, {release: .04});
  }

  // ---------------------------------------------------------------- song
  private advanceSection() {
    this.bar = 0;
    this.sectionIndex = (this.sectionIndex + 1) % LOOP.length;
    this.section = LOOP[this.sectionIndex];
  }
  /** Schedule one 16th-note step of the song. Intensity 0 calm, 1 engines burning, 2 danger. */
  private playStep(t: number, sixteenth: number, intensity: number) {
    const s = this.section, chord = s.chords[this.bar], step = this.step, out = this.music!, echo = this.echo!;
    // Lead: 25% pulse with vibrato on long notes, sent to a dotted-eighth echo.
    for (const [at, midi, len] of s.lead[this.bar]) if (at === step) {
      const f = hz(midi), dur = len * sixteenth * .92;
      this.voice(f, t, dur, .09, this.pulse25!, out, {vibrato: true, glideFrom: s === INTRO ? undefined : f * .985});
      this.voice(f, t, dur, .05, this.pulse25!, echo, {vibrato: true});
    }
    // Arpeggio: chord tones two octaves up on a thin 12.5% pulse.
    const tones = [...chord.map(n => n + 24), chord[0] + 36];
    if (s.arp === 'slow' && step % 2 === 0) this.voice(hz(tones[(step / 2) % 4]), t, sixteenth * 1.8, .035, 'triangle', echo, {release: .3});
    if (s.arp === 'eighth' && step % 2 === 0) this.voice(hz(tones[[0, 1, 2, 3, 2, 1, 0, 1][(step / 2) % 8]]), t, sixteenth * .9, .028, this.pulse12!, out);
    if (s.arp === 'chop' && [0, 2, 3, 5, 6, 8, 10, 11, 13, 14].includes(step)) this.voice(hz(tones[step % 4]), t, sixteenth * .6, .03, this.pulse12!, out);
    // Intro pad: a soft triangle chord at each bar.
    if (s === INTRO && step === 0) for (const n of chord) this.voice(hz(n + 12), t, sixteenth * 15, .03, 'triangle', out, {release: .6});
    // Bass: triangle, octave-doubled so it survives phone speakers.
    const root = chord[0] - 12, fifth = root + 7, bassAt = (midi: number, len: number, level = .16) => {
      this.voice(hz(midi), t, sixteenth * len, level, 'triangle', out);
      this.voice(hz(midi + 12), t, sixteenth * len, level * .35, this.pulse12!, out);
    };
    if (s.bass === 'pulse' && step % 4 === 0) bassAt(step === 8 ? fifth : root, 3);
    if (s.bass === 'drive' && step % 2 === 0) bassAt(step % 8 === 6 ? fifth : root, 1.6, .15);
    if (s.bass === 'jump' && step % 2 === 0) bassAt(step % 4 === 2 ? root + 12 : root, 1.4, .15);
    // Drums: none in the intro, half-time in verses, full beat in the chorus and remix. Engines and danger add drive.
    const drums = Math.min(2, s.drums + (intensity > 0 && s.drums > 0 ? 1 : 0));
    if (drums >= 1) {
      if (step === 0 || step === 8 || (drums === 2 && (step === 4 || step === 12))) this.hit('kick', t, .5);
      if (step === 4 || step === 12) this.hit('snare', t, drums === 2 ? .22 : .14);
      if (step % 2 === 0) this.hit('hat', t, .05);
      if (drums === 2 && step % 2 === 1) this.hit('hat', t, .025);
    }
    // Remix fill on the last bar before the loop turns over.
    if (s === REMIX && this.bar === s.bars - 1 && step >= 12) this.hit('snare', t, .12 + .04 * (step - 12));
  }

  // ---------------------------------------------------------------- iPhone and lifecycle
  /**
   * iPhone: Web Audio stays silent unless the context is started inside the tap, and the ring/silent switch mutes it
   * unless the page declares playback audio. A silent looping media element does that on older iOS versions.
   */
  private unlockIOS() {
    const ctx = this.ctx!;
    try {(navigator as unknown as {audioSession?: {type: string}}).audioSession!.type = 'playback';} catch {/* not Safari 16.4+ */}
    if (!this.keepAlive) {
      const rate = 8000, samples = rate / 2, buf = new ArrayBuffer(44 + samples), v = new DataView(buf), w = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + samples, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, samples, true);
      for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128);
      const el = new Audio(URL.createObjectURL(new Blob([buf], {type: 'audio/wav'}))); el.loop = true; el.setAttribute('playsinline', ''); el.volume = .01; this.keepAlive = el;
    }
    this.keepAlive.play().catch(() => {});
    // A one-sample buffer played inside the gesture fully wakes the context.
    const b = ctx.createBuffer(1, 1, 22050), src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start(0);
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  }
  private watchResume() {
    // iOS suspends ("interrupted") the context after calls, lock screen or app switching; wake it on the next touch.
    const wake = () => {if (this.enabled && this.ctx && this.ctx.state !== 'running') {this.ctx.resume().catch(() => {}); this.keepAlive?.play().catch(() => {});}};
    for (const t of ['pointerdown', 'touchend', 'keydown']) addEventListener(t, wake, {passive: true});
    document.addEventListener('visibilitychange', () => {if (!document.hidden) wake(); else this.keepAlive?.pause();});
  }
  private build(offline?: BaseAudioContext) {
    const AC = window.AudioContext ?? (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
    const ctx = (offline ?? new AC()) as AudioContext; this.ctx = ctx; if (!offline) this.watchResume();
    this.master = ctx.createGain(); this.master.gain.value = 0;
    // Phone speakers are small: a gentle compressor with make-up gain keeps the chip voices present.
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = .005; comp.release.value = .2;
    const makeup = ctx.createGain(); makeup.gain.value = 1.5;
    this.master.connect(comp); comp.connect(makeup); makeup.connect(ctx.destination);
    this.music = ctx.createGain(); this.music.gain.value = .8; this.music.connect(this.master);
    // Dotted-eighth echo, darkened so repeats sit behind the lead.
    this.echo = ctx.createGain(); this.echo.gain.value = 1;
    const delay = ctx.createDelay(1), feedback = ctx.createGain(), tone = ctx.createBiquadFilter();
    delay.delayTime.value = .38; feedback.gain.value = .32; tone.type = 'lowpass'; tone.frequency.value = 2600;
    this.echo.connect(delay); delay.connect(tone); tone.connect(feedback); feedback.connect(delay); tone.connect(this.music);
    this.echo.connect(this.music);
    // Pulse waves as Fourier series (cosine terms 2/(kπ)·sin(πkd)): the NES-style 25% and 12.5% duty cycles.
    const pulse = (duty: number) => {const n = 32, re = new Float32Array(n), im = new Float32Array(n); for (let k = 1; k < n; k++) re[k] = 2 / (k * Math.PI) * Math.sin(Math.PI * k * duty); return ctx.createPeriodicWave(re, im);};
    this.pulse25 = pulse(.25); this.pulse12 = pulse(.125);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const data = this.noise.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    // Engine rumble follows throttle.
    const osc = ctx.createOscillator(), filter = ctx.createBiquadFilter(); osc.type = 'sawtooth'; osc.frequency.value = 38; filter.type = 'lowpass'; filter.frequency.value = 160;
    this.engine = ctx.createGain(); this.engine.gain.value = 0; osc.connect(filter); filter.connect(this.engine); this.engine.connect(this.master); osc.start();
  }

  private schedule(now: number, intensity: number) {
    const sixteenth = 60 / (intensity === 2 ? 128 : 118) / 4;
    if (this.nextStep < now - .25) this.nextStep = now + .02;
    while (this.nextStep < now + .12) {
      this.playStep(this.nextStep, sixteenth, intensity);
      this.nextStep += sixteenth;
      if (++this.step === 16) {this.step = 0; if (++this.bar === this.section.bars) this.advanceSection();}
    }
  }
  /** Render the score offline (for previews and checks). Returns the finished buffer. */
  static async render(seconds: number, sampleRate = 44100, intensity = 0) {
    const offline = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate), audio = new FlightAudio();
    audio.build(offline); audio.master!.gain.value = audio.volume; audio.nextStep = .05;
    for (let t = 0; t < seconds; t += .05) audio.schedule(t, intensity);
    return offline.startRendering();
  }

  toggle(): Promise<boolean> {
    if (!this.ctx) this.build();
    const ctx = this.ctx!;
    this.enabled = !this.enabled;
    // Everything here runs synchronously inside the tap; iOS rejects audio started after an await.
    if (this.enabled) this.unlockIOS(); else this.keepAlive?.pause();
    this.master!.gain.setTargetAtTime(this.enabled ? this.volume : 0, ctx.currentTime, .3);
    if (this.enabled) {this.section = INTRO; this.sectionIndex = -1; this.bar = this.step = 0; this.nextStep = ctx.currentTime + .1;}
    return ctx.resume().then(() => this.enabled, () => this.enabled);
  }

  update(throttle: number, danger: boolean, escaped = false, active = true) {
    this.mood = !active ? 'idle' : danger ? 'danger' : escaped ? 'escape' : throttle > .05 ? 'burn' : 'cruise';
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, now = ctx.currentTime;
    this.music!.gain.setTargetAtTime(active ? (escaped ? .5 : .8) : .0001, now, active ? .5 : .15);
    const terminal = !active ? 'silent' : escaped ? 'landed' : '';
    if (terminal !== this.terminal) {
      this.terminal = terminal;
      if (terminal === 'landed') [[74, 0], [78, .12], [81, .24], [86, .36]].forEach(([m, d]) => this.voice(hz(m), now + d, .5, .07, this.pulse25!, this.echo!, {vibrato: true}));
    }
    this.engine!.gain.setTargetAtTime(active ? throttle * .12 : 0, now, .15);
    if (!active) {this.nextStep = now; return;}
    this.schedule(now, danger ? 2 : throttle > .05 ? 1 : 0);
    if (danger && now - this.lastBeep > 2.2) {this.lastBeep = now; this.voice(880, now, .1, .05, 'square', this.master!); this.voice(1108.73, now + .13, .1, .04, 'square', this.master!);}
  }
}
