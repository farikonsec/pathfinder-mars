import * as T from 'three';
import type {FlightTelemetry} from './mars-flight';
import type {Orbit} from './mars-orbit';
import type {V} from './vector';

export interface HudData {
  tele: FlightTelemetry; rotation: T.Quaternion; camera: T.PerspectiveCamera; cockpit: boolean;
  throttle: number; hover: number; gear: boolean; assist: string; heat: number; fuel: number; status: string; warp: number;
  drive: string; orbit: Orbit | null; velocity: V; space: boolean; accel: number;
  waypoint: {name: string; offset: T.Vector3} | null;
  markings: 'essential' | 'full' | 'off';
  wind?: {total: number; devil: number}; storm?: number;
}
const clock = (s: number) => {s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(x).padStart(2, '0')}`;};

/** Glass HUD drawn over the 3D view. Directions are projected through the real camera, so markers sit on the world. */
export class Hud {
  canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private blink = 0;
  constructor(host: HTMLElement) {
    this.canvas.className = 'flight-hud';
    host.appendChild(this.canvas);
    const size = () => {const r = Math.min(devicePixelRatio, 2); this.canvas.width = innerWidth * r; this.canvas.height = innerHeight * r; this.ctx.setTransform(r, 0, 0, r, 0, 0);};
    addEventListener('resize', size); size();
  }
  clear() {this.ctx.clearRect(0, 0, innerWidth, innerHeight);}

  private project(dir: T.Vector3, camera: T.PerspectiveCamera) {
    const local = dir.clone().applyQuaternion(camera.quaternion.clone().invert());
    if (local.z > -1e-3) return null;
    const p = dir.clone().add(camera.position).project(camera);
    return {x: (p.x * .5 + .5) * innerWidth, y: (-p.y * .5 + .5) * innerHeight};
  }

  /** Screen point for a direction, pinned to the screen edge when off-screen or behind. */
  private pinned(dir: T.Vector3, camera: T.PerspectiveCamera) {
    const on = this.project(dir, camera), w = innerWidth, h = innerHeight, m = 40;
    if (on && on.x > m && on.x < w - m && on.y > m && on.y < h - m) return {...on, off: false, angle: 0};
    const local = dir.clone().applyQuaternion(camera.quaternion.clone().invert());
    const angle = Math.atan2(-local.y, local.x), cx = w / 2, cy = h / 2;
    const k = Math.min((w / 2 - m) / Math.abs(Math.cos(angle) || 1e-6), (h / 2 - m) / Math.abs(Math.sin(angle) || 1e-6));
    return {x: cx + Math.cos(angle) * k, y: cy + Math.sin(angle) * k, off: true, angle};
  }

  draw(d: HudData, dt: number) {
    const c = this.ctx, w = innerWidth, h = innerHeight, t = d.tele;
    this.blink += dt;
    c.clearRect(0, 0, w, h);
    const green = t.agl < 400 && t.verticalSpeed < -25 ? '#ff7a59' : '#9ff5c8';
    c.strokeStyle = green; c.fillStyle = green; c.lineWidth = 1.6; c.font = '600 12px "IBM Plex Mono", ui-monospace, monospace';
    c.shadowColor = 'rgba(0,0,0,.65)'; c.shadowBlur = 4;
    const up = new T.Vector3(...t.up), forward = new T.Vector3(0, 0, -1).applyQuaternion(d.rotation);
    const camForward = new T.Vector3(0, 0, -1).applyQuaternion(d.camera.quaternion);

    // Pitch ladder around the camera heading.
    const heading = camForward.clone().addScaledVector(up, -camForward.dot(up));
    if (d.markings === 'full' && heading.lengthSq() > 1e-6) {
      heading.normalize();
      const side = heading.clone().cross(up).normalize();
      for (let deg = -60; deg <= 60; deg += 10) {
        const a = deg * Math.PI / 180, centre = heading.clone().multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a));
        const half = deg === 0 ? .32 : .09, gap = deg === 0 ? .06 : .03;
        const pts = [-half, -gap, gap, half].map(s => this.project(centre.clone().addScaledVector(side, s).normalize(), d.camera));
        if (pts.some(p => !p)) continue;
        c.globalAlpha = deg === 0 ? .85 : .55;
        c.setLineDash(deg < 0 ? [6, 5] : []);
        c.beginPath(); c.moveTo(pts[0]!.x, pts[0]!.y); c.lineTo(pts[1]!.x, pts[1]!.y); c.moveTo(pts[2]!.x, pts[2]!.y); c.lineTo(pts[3]!.x, pts[3]!.y); c.stroke();
        if (deg !== 0) {c.fillText(String(Math.abs(deg)), pts[3]!.x + 6, pts[3]!.y + 4);}
      }
      c.setLineDash([]); c.globalAlpha = 1;
    }

    // Boresight: where the nose points.
    const nose = d.markings === 'off' ? null : this.project(forward, d.camera);
    if (nose) {
      c.beginPath(); c.moveTo(nose.x - 22, nose.y); c.lineTo(nose.x - 9, nose.y); c.lineTo(nose.x - 4, nose.y + 7); c.lineTo(nose.x, nose.y); c.lineTo(nose.x + 4, nose.y + 7); c.lineTo(nose.x + 9, nose.y); c.lineTo(nose.x + 22, nose.y); c.stroke();
    }
    // Flight path marker: where the ship is actually going.
    const air = new T.Vector3(...t.airVelocity);
    if (d.markings !== 'off' && air.length() > 1e-6) {
      const fpm = this.project(air.clone().normalize(), d.camera);
      if (fpm) {
        c.beginPath(); c.arc(fpm.x, fpm.y, 7, 0, Math.PI * 2); c.moveTo(fpm.x - 7, fpm.y); c.lineTo(fpm.x - 17, fpm.y); c.moveTo(fpm.x + 7, fpm.y); c.lineTo(fpm.x + 17, fpm.y); c.moveTo(fpm.x, fpm.y - 7); c.lineTo(fpm.x, fpm.y - 14); c.stroke();
      }
    }

    // Tapes.
    const cx = w / 2, cy = h / 2, tapeX = Math.min(260, w < 900 ? w * .15 : w * .2);
    const box = (x: number, y: number, label: string, value: string, align: 'left' | 'right') => {
      c.globalAlpha = .9; c.strokeRect(x - (align === 'right' ? 104 : 0), y - 16, 104, 30);
      c.textAlign = align; c.font = '600 17px "IBM Plex Mono", ui-monospace, monospace';
      c.fillText(value, x + (align === 'right' ? -8 : 8), y + 6);
      c.font = '600 10px "IBM Plex Mono", ui-monospace, monospace'; c.fillText(label, x + (align === 'right' ? -8 : 8), y - 22);
      c.textAlign = 'left';
    };
    const speed = t.agl < 120000 ? t.airspeed : t.airspeed;
    box(cx - tapeX, cy, t.agl < 120000 ? 'AIRSPEED M/S' : 'VELOCITY KM/S', t.agl < 120000 ? speed.toFixed(0) : (speed / 1000).toFixed(speed > 99999 ? 1 : 3), 'right');
    const aglText = t.agl > 9999999 ? (t.agl / 1e6).toFixed(1) + 'k km' : t.agl > 99999 ? (t.agl / 1000).toFixed(0) + ' km' : t.agl > 9999 ? (t.agl / 1000).toFixed(2) + 'k' : t.agl.toFixed(0);
    box(cx + tapeX, cy, t.agl > 99999 ? 'ALTITUDE' : 'RADAR ALT M', aglText, 'left');
    c.font = '600 12px "IBM Plex Mono", ui-monospace, monospace';
    c.textAlign = 'left'; c.fillText(`VS ${t.verticalSpeed >= 0 ? '+' : ''}${t.verticalSpeed.toFixed(1)}`, cx + tapeX + 8, cy + 36);
    c.fillText(`GS ${t.groundSpeed.toFixed(0)}`, cx + tapeX + 8, cy + 52);
    c.textAlign = 'right';
    c.fillText(t.airspeed < 20 ? "AOA --" : `AOA ${(t.alpha * 180 / Math.PI).toFixed(1)}°`, cx - tapeX - 8, cy + 36);
    c.fillText(`G ${t.gLoad.toFixed(2)}`, cx - tapeX - 8, cy + 52);
    c.fillText(`Q ${t.dynamicPressure.toFixed(0)} Pa`, cx - tapeX - 8, cy + 68);
    c.textAlign = 'left';

    // Status row.
    const row = h - (w < 900 ? 330 : 150);
    c.font = '600 11px "IBM Plex Mono", ui-monospace, monospace';
    const items = [`THR ${Math.round(d.throttle * 100)}%`, `JETS ${Math.round(d.hover * 100)}%`, d.gear ? 'GEAR DN' : 'GEAR UP', d.assist, `HULL ${d.heat.toFixed(0)}%`, `WARP ${d.warp.toFixed(0)}×`, `DRIVE ${d.drive}`, `WIND ${Math.round(d.wind?.total ?? 0)} M/S`];
    let x = cx - 330;
    for (const item of items) {c.fillText(item, x, row); x += 95;}
    // Throttle bar.
    c.strokeRect(cx - 290, row + 10, 580, 6); c.fillRect(cx - 290, row + 10, 580 * d.throttle, 6);

    // Prograde / retrograde markers relative to Mars, the ones that matter for orbit changes.
    const vel = new T.Vector3(...d.velocity);
    if (d.space && vel.lengthSq() > 1e-10) {
      const retro = this.project(vel.clone().normalize().negate(), d.camera);
      if (retro) {c.beginPath(); c.arc(retro.x, retro.y, 9, 0, Math.PI * 2); c.moveTo(retro.x - 6, retro.y - 6); c.lineTo(retro.x + 6, retro.y + 6); c.moveTo(retro.x + 6, retro.y - 6); c.lineTo(retro.x - 6, retro.y + 6); c.stroke(); c.fillText('RETRO', retro.x + 13, retro.y + 4);}
    }
    // Target waypoint.
    if (d.waypoint) {
      const p = this.pinned(d.waypoint.offset.clone().normalize(), d.camera), km = d.waypoint.offset.length();
      c.save(); c.strokeStyle = c.fillStyle = '#ffd28e';
      if (p.off) {c.translate(p.x, p.y); c.rotate(p.angle); c.beginPath(); c.moveTo(12, 0); c.lineTo(-6, -8); c.lineTo(-6, 8); c.closePath(); c.fill(); c.setTransform(Math.min(devicePixelRatio, 2), 0, 0, Math.min(devicePixelRatio, 2), 0, 0);}
      else {c.beginPath(); c.moveTo(p.x, p.y - 10); c.lineTo(p.x + 10, p.y); c.lineTo(p.x, p.y + 10); c.lineTo(p.x - 10, p.y); c.closePath(); c.stroke();}
      c.textAlign = 'center';
      c.fillText(`${d.waypoint.name.toUpperCase()} · ${km >= 1000 ? km.toLocaleString('en-GB', {maximumFractionDigits: 0}) : km.toFixed(km < 10 ? 2 : 1)} KM`, Math.min(w - 90, Math.max(90, p.x)), Math.min(h - 20, Math.max(24, p.y + (p.off ? 26 : 24))));
      c.restore();
    }
    // Orbit readout and capture guidance.
    const o = d.orbit;
    if (o && d.space) {
      c.font = '600 12px "IBM Plex Mono", ui-monospace, monospace'; c.textAlign = 'center';
      const label = {impact: 'IMPACT TRAJECTORY', entry: 'ENTRY CORRIDOR', orbit: 'CAPTURED · IN ORBIT', escape: 'FLYBY · ESCAPE'}[o.status];
      const top = w < 900 ? 212 : 132;
      c.fillText(`${label} · e ${o.e.toFixed(3)}`, cx, top);
      const pe = o.approaching || o.e < 1 ? `PERIAPSIS ${o.periapsis.toFixed(0)} KM${Number.isFinite(o.timeToPeriapsis) ? ' IN ' + clock(o.timeToPeriapsis) : ''}` : 'PERIAPSIS PASSED';
      c.fillText(`${pe} · APOAPSIS ${Number.isFinite(o.apoapsis) ? o.apoapsis.toFixed(0) + ' KM' : '∞'}`, cx, top + 18);
      if (o.status === 'escape' && o.approaching) {
        const burn = o.captureDeltaV / d.accel;
        c.fillText(`CAPTURE Δv ${o.captureDeltaV.toFixed(2)} KM/S · ${burn < 120 ? burn.toFixed(0) + ' S' : clock(burn)} AT FULL ${d.drive}`, cx, top + 36);
        if (o.timeToPeriapsis < Math.max(240, burn * 1.2) && (this.blink % 1) < .7) {c.font = '800 18px "IBM Plex Mono", ui-monospace, monospace'; c.fillStyle = '#ffd28e'; c.fillText('BURN RETROGRADE NOW', cx, top + 62); c.fillStyle = green;}
      } else if (o.status === 'orbit') c.fillText(`PERIOD ${clock(o.period)} · CIRCULARISE Δv ${o.circulariseDeltaV.toFixed(2)} KM/S`, cx, top + 36);
      else if (o.status === 'entry') c.fillText('ENTRY: B HOLDS BELLY-FIRST ATTITUDE', cx, top + 36);
      c.textAlign = 'left';
    }

    // Warnings.
    const warnings: string[] = [];
    const timeToImpact = t.verticalSpeed < -1 ? t.agl / -t.verticalSpeed : Infinity;
    if (d.status === 'flying' && t.agl < 3000 && timeToImpact < 9) warnings.push('PULL UP');
    if (t.dynamicPressure > 30000) warnings.push('OVERSPEED · STRUCTURE');
    else if (d.status === 'flying' && t.agl < 60 && t.verticalSpeed < -6) warnings.push('SINK RATE');
    if (d.status === 'flying' && !d.gear && t.agl < 250 && t.groundSpeed < 60) warnings.push('GEAR');
    if (t.heatFlux > 1.6 || d.heat > 55) warnings.push('HULL TEMP');
    if (d.fuel < 10) warnings.push('FUEL');
    if ((d.wind?.devil ?? 0) > 5) warnings.push('DUST DEVIL');
    if ((d.storm ?? 0) > .5 && t.agl < 50000) warnings.push('DUST STORM');
    if (warnings.length && (this.blink % .8) < .55) {
      c.font = '800 22px "IBM Plex Mono", ui-monospace, monospace'; c.fillStyle = '#ff6b4a'; c.textAlign = 'center';
      warnings.forEach((wn, i) => c.fillText(wn, cx, cy - 90 - i * 28));
      c.textAlign = 'left';
    }
    c.shadowBlur = 0;
    return warnings;
  }
}

/** Sun glare: a bloom on the disc plus faint lens ghosts along the line through screen centre. */
export class Glare {
  canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  constructor(host: HTMLElement) {
    this.canvas.className = 'glare';
    host.appendChild(this.canvas);
    const size = () => {this.canvas.width = innerWidth; this.canvas.height = innerHeight;};
    addEventListener('resize', size); size();
  }
  draw(camera: T.PerspectiveCamera, sunDir: T.Vector3, strength: number) {
    const c = this.ctx, w = innerWidth, h = innerHeight;
    c.clearRect(0, 0, w, h);
    if (strength <= .01) return;
    const local = sunDir.clone().applyQuaternion(camera.quaternion.clone().invert());
    if (local.z > -.05) return;
    const p = sunDir.clone().add(camera.position).project(camera), x = (p.x * .5 + .5) * w, y = (-p.y * .5 + .5) * h;
    const off = Math.max(0, Math.hypot(p.x, p.y) - 1), k = strength * Math.max(0, 1 - off * 1.5);
    if (k <= .01) return;
    c.globalCompositeOperation = 'lighter';
    const bloom = c.createRadialGradient(x, y, 0, x, y, Math.max(w, h) * .45);
    bloom.addColorStop(0, `rgba(255,246,228,${.5 * k})`); bloom.addColorStop(.08, `rgba(255,226,190,${.18 * k})`); bloom.addColorStop(1, 'rgba(255,200,150,0)');
    c.fillStyle = bloom; c.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    for (const [t, r, a, col] of [[.55, 26, .08, '160,200,255'], [.95, 60, .05, '255,210,170'], [1.35, 16, .1, '190,255,220'], [1.8, 90, .035, '200,180,255']] as [number, number, number, string][]) {
      const gx = x + (cx - x) * t, gy = y + (cy - y) * t, g = c.createRadialGradient(gx, gy, 0, gx, gy, r);
      g.addColorStop(0, `rgba(${col},${a * k})`); g.addColorStop(.7, `rgba(${col},${a * k * .5})`); g.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = g; c.beginPath(); c.arc(gx, gy, r, 0, 7); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  }
}
