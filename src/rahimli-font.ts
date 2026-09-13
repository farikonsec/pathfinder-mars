/**
 * RAHIMLI STENCIL — a geometric stencil display face drawn for Farhad Rahimli's Mars expedition.
 * Glyphs are polylines on a 4 × 6 grid with 45° chamfers. Wherever a stroke ends on another stroke,
 * the renderer pulls it back, so every joint becomes a stencil bridge.
 */
const GLYPHS: Record<string, string> = {
  A: '0,6 0,1.5 1.5,0 2.5,0 4,1.5 4,6|0,3.4 4,3.4',
  B: '0,0 0,6|0,0 3,0 4,1 4,2 3,3 0,3|0,3 3,3 4,4 4,5 3,6 0,6',
  C: '4,0 1.2,0 0,1.2 0,4.8 1.2,6 4,6',
  D: '0,0 0,6|0,0 2.6,0 4,1.4 4,4.6 2.6,6 0,6',
  E: '0,0 0,6|0,0 4,0|0,3 3,3|0,6 4,6',
  F: '0,0 0,6|0,0 4,0|0,3 3,3',
  G: '4,0 1.2,0 0,1.2 0,4.8 1.2,6 4,6 4,3.2 2.2,3.2',
  H: '0,0 0,6|4,0 4,6|0,3 4,3',
  I: '2,0 2,6|0.8,0 3.2,0|0.8,6 3.2,6',
  J: '4,0 4,4.8 2.8,6 1.2,6 0,4.8',
  K: '0,0 0,6|4,0 0,3.4|1.3,2.6 4,6',
  L: '0,0 0,6 4,6',
  M: '0,6 0,0 2,2.6 4,0 4,6',
  N: '0,6 0,0 4,6 4,0',
  O: '2,0 2.8,0 4,1.2 4,4.8 2.8,6 2,6|2,6 1.2,6 0,4.8 0,1.2 1.2,0 2,0',
  P: '0,0 0,6|0,0 3,0 4,1 4,2.4 3,3.4 0,3.4',
  Q: '2,0 2.8,0 4,1.2 4,4.8 2.8,6 2,6|2,6 1.2,6 0,4.8 0,1.2 1.2,0 2,0|2.6,4.4 4.3,6.2',
  R: '0,0 0,6|0,0 3,0 4,1 4,2.4 3,3.4 0,3.4|1.8,3.4 4,6',
  S: '4,0 1,0 0,1 0,2 1,3 3,3 4,4 4,5 3,6 0,6',
  T: '0,0 4,0|2,0 2,6',
  U: '0,0 0,4.8 1.2,6 2.8,6 4,4.8 4,0',
  V: '0,0 2,6 4,0',
  W: '0,0 0.8,6 2,3 3.2,6 4,0',
  X: '0,0 4,6|4,0 2.35,2.5|1.65,3.5 0,6',
  Y: '0,0 2,3 4,0|2,3 2,6',
  Z: '0,0 4,0 0,6 4,6',
  0: '2,0 2.8,0 4,1.2 4,4.8 2.8,6 2,6|2,6 1.2,6 0,4.8 0,1.2 1.2,0 2,0|1.2,4.4 2.8,1.6',
  1: '0.8,1.2 2,0 2,6|0.8,6 3.2,6',
  2: '0,1.2 1.2,0 2.8,0 4,1.2 4,2.4 0,6 4,6',
  3: '0,0 4,0 2,2.6 3,2.6 4,3.6 4,4.8 2.8,6 0,6',
  4: '3,6 3,0 0,4.2 4,4.2',
  5: '4,0 0,0 0,2.6 2.8,2.6 4,3.6 4,4.8 2.8,6 0,6',
  6: '3.6,0 1.6,0 0,1.6 0,4.8 1.2,6 2.8,6 4,4.8 4,3.8 2.8,2.8 0,2.8',
  7: '0,0 4,0 1.4,6',
  8: '1,0 3,0 4,1 4,1.9 3,2.8 1,2.8 0,1.9 0,1 1,0|1,2.8 0,3.8 0,5 1,6 3,6 4,5 4,3.8 3,2.8',
  9: '0.4,6 2.4,6 4,4.4 4,1.2 2.8,0 1.2,0 0,1.2 0,2.2 1.2,3.2 4,3.2',
  '-': '0.6,3 3.4,3',
  '.': '1.6,5.4 2.4,5.4 2.4,6 1.6,6 1.6,5.4',
  '·': '1.6,2.7 2.4,2.7 2.4,3.3 1.6,3.3 1.6,2.7',
  ':': '1.6,1.4 2.4,1.4 2.4,2 1.6,2 1.6,1.4|1.6,4.6 2.4,4.6 2.4,5.2 1.6,5.2 1.6,4.6',
  '/': '0.4,6 3.6,0',
  '°': '1.4,0 2.6,0 2.6,1.2 1.4,1.2 1.4,0',
};
type P = [number, number];
/** Narrow glyphs advance by less so words keep an even rhythm. */
const NARROW: Record<string, number> = {I: 1.6, '1': 1.2, '.': 2.2, ':': 2.2, '·': 2.2};
const PARSED: Record<string, P[][]> = Object.fromEntries(Object.entries(GLYPHS).map(([k, v]) => [k, v.split('|').map(line => line.trim().split(' ').map(pt => pt.split(',').map(Number) as P))]));

function onSegment(p: P, a: P, b: P) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) < .02;
}
function touches(p: P, others: P[][]) {return others.some(line => line.slice(1).some((q, i) => onSegment(p, line[i], q)));}

export interface StencilOptions {size: number; weight?: number; tracking?: number; color?: string; align?: 'left' | 'center' | 'right';}

export function measureStencil(text: string, o: StencilOptions) {
  const unit = o.size / 6, advance = (4 + (o.tracking ?? 1.6)) * unit;
  return [...text.toUpperCase()].reduce((w, ch) => w + (ch === ' ' ? advance * .75 : advance - (NARROW[ch] ?? 0) * unit), 0) - (o.tracking ?? 1.6) * unit;
}

/** Draw text with its top-left (or aligned) origin at x, y on a 2D canvas. */
export function drawStencil(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: StencilOptions) {
  const unit = o.size / 6, weight = (o.weight ?? .9) * unit, advance = (4 + (o.tracking ?? 1.6)) * unit;
  const width = measureStencil(text, o);
  let cursor = o.align === 'center' ? x - width / 2 : o.align === 'right' ? x - width : x;
  const inset = weight / 2;
  ctx.save();
  ctx.strokeStyle = o.color ?? '#1c2026'; ctx.lineWidth = weight; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.miterLimit = 3;
  for (const ch of text.toUpperCase()) {
    if (ch === ' ') {cursor += advance * .75; continue;}
    const trim = (NARROW[ch] ?? 0) * unit;
    cursor -= trim / 2;
    const lines = PARSED[ch];
    if (lines) lines.forEach((line, li) => {
      const others = lines.filter((_, j) => j !== li);
      const pts = line.map(([gx, gy]) => [cursor + (inset + gx * (4 * unit - 2 * inset) / 4), y + inset + gy * (o.size - 2 * inset) / 6] as P);
      // Pull back ends that land on another stroke: the stencil bridge.
      const gap = weight * .5 + unit * .32;
      for (const end of [0, pts.length - 1]) {
        if (!touches(line[end], others)) continue;
        const next = pts[end === 0 ? 1 : pts.length - 2], p = pts[end];
        const dx = next[0] - p[0], dy = next[1] - p[1], l = Math.hypot(dx, dy) || 1;
        pts[end] = [p[0] + dx / l * Math.min(gap, l * .45), p[1] + dy / l * Math.min(gap, l * .45)];
      }
      ctx.beginPath(); pts.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.stroke();
    });
    cursor += advance - trim / 2;
  }
  ctx.restore();
  return width;
}

export const FONT_CREDIT = 'RAHIMLI STENCIL typeface, drawn for Farhad Rahimli';
