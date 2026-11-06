import { ACC, type Scene } from "./pixel";

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const fract = (v: number) => v - Math.floor(v);
const hash = (n: number) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);
// Signed distance to a box (negative inside).
const box = (x: number, y: number, cx: number, cy: number, hw: number, hh: number) =>
  Math.max(Math.abs(x - cx) - hw, Math.abs(y - cy) - hh);
const dist = (x: number, y: number, x1: number, y1: number, x2: number, y2: number) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const k = clamp(((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(x - (x1 + k * dx), y - (y1 + k * dy));
};
const out = (l: number, ac: number) => (ac > 0 ? ACC + Math.max(ac, Math.min(1, l)) : Math.min(1, l));
const outline = (d: number, th = 0.007) => d < 0 && d > -th;

/* 1. A development board: module, antenna, header pins, USB cable with data pulses, blinking LEDs. */
export const board: Scene = (x, y, t, a) => {
  const cx = a / 2 + 0.08;
  const cy = 0.54;
  let l = 0;
  let ac = 0;
  const pcb = box(x, y, cx, cy, 0.34, 0.19);
  if (pcb < 0) l = outline(pcb, 0.008) ? 1 : 0.1;

  // module can with a shield pattern
  const can = box(x, y, cx + 0.06, cy - 0.005, 0.16, 0.12);
  if (can < 0) l = outline(can) ? 1 : fract((x + y) * 22) < 0.5 ? 0.5 : 0.36;

  // meander antenna at the right end
  const ax = (x - (cx + 0.225)) / 0.1;
  if (ax > 0 && ax < 1) {
    const tri = Math.abs(fract(ax * 4) - 0.5) * 2;
    if (Math.abs(y - (cy - 0.075 + 0.055 * tri)) < 0.0075) l = Math.max(l, 1);
  }

  // main chip
  const chip = box(x, y, cx - 0.19, cy, 0.06, 0.06);
  if (chip < 0) l = outline(chip) ? 1 : 0.22;
  if (Math.abs(Math.abs(x - (cx - 0.19)) - 0.068) < 0.006 && Math.abs(y - cy) < 0.05 && fract(y * 40) < 0.5) l = Math.max(l, 0.9);
  if (Math.abs(Math.abs(y - cy) - 0.068) < 0.006 && Math.abs(x - (cx - 0.19)) < 0.05 && fract(x * 40) < 0.5) l = Math.max(l, 0.9);

  // header pins
  for (let k = 0; k < 18; k++) {
    const px = cx - 0.3 + k * 0.034;
    for (const py of [cy - 0.168, cy + 0.168]) {
      if (Math.abs(x - px) < 0.009 && Math.abs(y - py) < 0.009) l = Math.max(l, 1);
    }
  }

  // traces from chip to the pins, each with a pulse
  for (let k = 0; k < 4; k++) {
    const sx = cx - 0.19 + (k - 1.5) * 0.026;
    const px = cx - 0.2 + k * 0.1;
    const top = k % 2 === 0;
    const y0 = top ? cy - 0.062 : cy + 0.062;
    const y1 = top ? cy - 0.16 : cy + 0.16;
    const d = dist(x, y, sx, y0, px, y1);
    if (d < 0.0035) l = Math.max(l, 0.55);
    const p = fract(t * 0.4 + k * 0.23);
    if (Math.hypot(x - (sx + (px - sx) * p), y - (y0 + (y1 - y0) * p)) < 0.012) ac = 1;
  }

  // USB port and cable
  const usb = box(x, y, cx - 0.37, cy, 0.035, 0.052);
  if (usb < 0) l = outline(usb) ? 1 : 0.5;
  const cableEnd = cx - 0.405;
  if (x < cableEnd && Math.abs(y - cy) < 0.016) l = Math.max(l, 0.45);
  if (x < cableEnd && Math.abs(y - cy) < 0.016) {
    const pos = cableEnd * (1 - fract(t * 0.35));
    if (Math.abs(x - pos) < 0.02) ac = 1;
  }

  // two LEDs
  const on1 = Math.floor(t * 2) % 2 === 0;
  const on2 = fract(t * 0.6) > 0.5;
  if (Math.hypot(x - (cx - 0.26), y - (cy + 0.115)) < 0.014) ac = Math.max(ac, on1 ? 1 : 0.15);
  if (Math.hypot(x - (cx - 0.225), y - (cy + 0.115)) < 0.014) l = Math.max(l, on2 ? 1 : 0.2);

  // radio arcs
  const step = Math.floor(t * 3) % 4;
  for (let i = 0; i < 3; i++) {
    const r = 0.045 + i * 0.035;
    const d = Math.hypot(x - (cx + 0.27), y - (cy - 0.13));
    if (Math.abs(d - r) < 0.0065 && y < cy - 0.13 && step > i) ac = Math.max(ac, 0.9);
  }
  return out(l, ac);
};

/* 2. The core idea: an agent proposes, LokiAI gates it, a person approves, the device acts, the result is recorded. */
export const authority: Scene = (x, y, t, a) => {
  const cx = a / 2;
  const p = t % 9;
  let l = 0;
  let ac = 0;
  const ax = cx - 0.5;
  const gx = cx;
  const dx = cx + 0.5;
  const cy = 0.4;

  // agent: a speech bubble with three lines
  const bub = box(x, y, ax, cy, 0.14, 0.1);
  if (bub < 0) l = outline(bub) ? 1 : 0.08;
  if (x > ax - 0.09 && x < ax + 0.09 && Math.abs(y - (cy - 0.04)) < 0.007) l = Math.max(l, 0.8);
  if (x > ax - 0.09 && x < ax + 0.04 && Math.abs(y - cy) < 0.007) l = Math.max(l, 0.8);
  if (x > ax - 0.09 && x < ax + 0.07 && Math.abs(y - (cy + 0.04)) < 0.007) l = Math.max(l, 0.8);
  if (y > cy + 0.1 && y < cy + 0.15 && Math.abs(x - (ax + 0.06) - (y - cy - 0.1) * -0.6) < 0.022 - (y - cy - 0.1) * 0.3) l = Math.max(l, 1);

  // gate: two pillars and a bar that lifts when approved
  const open = p > 3.6 && p < 6.6 ? 1 : 0;
  for (const s of [-1, 1]) {
    const pil = box(x, y, gx + s * 0.075, cy + 0.015, 0.018, 0.14);
    if (pil < 0) l = Math.max(l, outline(pil) ? 1 : 0.4);
  }
  const barY = cy + 0.1 - open * 0.2;
  const bar = box(x, y, gx, barY, 0.075, 0.012);
  if (bar < 0) l = Math.max(l, 1);
  // padlock on the bar while it is closed
  if (!open) {
    const lock = box(x, y, gx, cy - 0.03, 0.022, 0.018);
    if (lock < 0) l = Math.max(l, 1);
    const shackle = Math.abs(Math.hypot(x - gx, y - (cy - 0.048)) - 0.016);
    if (shackle < 0.005 && y < cy - 0.04) l = Math.max(l, 1);
  }

  // a question mark pulse while waiting, then a tick once approved
  if (p > 1.9 && p < 3.6 && Math.floor(t * 3) % 2 === 0) {
    if (Math.abs(x - gx) < 0.01 && Math.abs(y - (cy - 0.2)) < 0.012) ac = 1;
    if (Math.abs(y - (cy - 0.26)) < 0.007 && Math.abs(x - gx) < 0.026) ac = 1;
    if (Math.abs(x - (gx + 0.026)) < 0.007 && y < cy - 0.215 && y > cy - 0.26) ac = 1;
    if (Math.abs(x - gx) < 0.007 && y > cy - 0.225 && y < cy - 0.21) ac = 1;
  }
  if (p > 3.6 && p < 6.6) {
    if (dist(x, y, gx - 0.03, cy - 0.22, gx - 0.008, cy - 0.195) < 0.008 || dist(x, y, gx - 0.008, cy - 0.195, gx + 0.035, cy - 0.255) < 0.008) ac = 1;
  }

  // device: a small board with an LED
  const dev = box(x, y, dx, cy, 0.14, 0.09);
  if (dev < 0) l = outline(dev) ? 1 : 0.1;
  const dchip = box(x, y, dx - 0.03, cy, 0.04, 0.04);
  if (dchip < 0) l = Math.max(l, outline(dchip) ? 1 : 0.35);
  const ledOn = p > 5.4 && p < 8.4;
  if (Math.hypot(x - (dx + 0.09), y - (cy + 0.05)) < 0.013) ac = Math.max(ac, ledOn ? 1 : 0.15);
  for (let k = 0; k < 5; k++) if (Math.abs(x - (dx - 0.1 + k * 0.05)) < 0.006 && Math.abs(Math.abs(y - cy) - 0.09) < 0.012) l = Math.max(l, 1);

  // link lines
  if (Math.abs(y - cy) < 0.003 && x > ax + 0.15 && x < gx - 0.09 && fract(x * 30) < 0.55) l = Math.max(l, 0.5);
  if (Math.abs(y - cy) < 0.003 && x > gx + 0.09 && x < dx - 0.15 && fract(x * 30) < 0.55) l = Math.max(l, 0.5);

  // request packet: agent to gate
  if (p < 1.9) {
    const k = p / 1.9;
    const px = ax + 0.17 + k * (gx - 0.1 - (ax + 0.17));
    if (Math.abs(x - px) < 0.016 && Math.abs(y - cy) < 0.016) ac = 1;
  }
  // approved packet: gate to device
  if (p > 4.4 && p < 6.0) {
    const k = (p - 4.4) / 1.6;
    const px = gx + 0.1 + k * (dx - 0.16 - (gx + 0.1));
    if (Math.abs(x - px) < 0.016 && Math.abs(y - cy) < 0.016) ac = 1;
  }

  // activity log underneath, filling as steps complete
  const rows = [
    { at: 0.5, w: 0.5 },
    { at: 3.8, w: 0.36 },
    { at: 5.2, w: 0.58 },
    { at: 7.4, w: 0.42 },
  ];
  rows.forEach((r, i) => {
    const ly = 0.74 + i * 0.05;
    if (Math.abs(y - ly) < 0.009 && x > cx - 0.5 && x < cx - 0.5 + r.w * clamp((p - r.at) * 3 + 0.001) && p > r.at) l = Math.max(l, 0.8);
    if (p > r.at && Math.abs(y - ly) < 0.009 && Math.abs(x - (cx - 0.535)) < 0.009) ac = 1;
  });
  if (Math.abs(y - 0.66) < 0.003 && Math.abs(x - cx) < 0.55 && fract(x * 40) < 0.5) l = Math.max(l, 0.35);
  return out(l, ac);
};

/* 3. Telemetry: a signal scrolls past a threshold; a spike raises a flag. */
export const telemetry: Scene = (x, y, t, a) => {
  const cx = a / 2;
  let l = 0;
  let ac = 0;
  const left = cx - 0.62;
  const right = cx + 0.62;
  const top = 0.18;
  const bottom = 0.82;
  const frame = box(x, y, cx, 0.5, 0.64, 0.34);
  if (frame < 0 && frame > -0.006) l = 0.8;
  // grid
  for (let g = 1; g < 6; g++) if (Math.abs(y - (top + (g * (bottom - top)) / 6)) < 0.0025 && fract(x * 40) < 0.4 && x > left && x < right) l = Math.max(l, 0.25);
  const sig = (u: number) => {
    const s = u * 9 + t * 1.6;
    const base = 0.52 + 0.07 * Math.sin(s * 0.9) + 0.035 * Math.sin(s * 2.7 + 1) + 0.02 * Math.sin(s * 7.3);
    const spikeAt = ((t * 0.42) % 1.6) - 0.3;
    const sp = Math.exp(-(((u - 0.3) - spikeAt * 0.55) ** 2) / 0.0018) * 0.3;
    return base - sp;
  };
  if (x > left && x < right) {
    const u = (x - left) / (right - left);
    const yy = sig(u);
    if (Math.abs(y - yy) < 0.012) l = Math.max(l, 1);
    if (y > yy && y < yy + 0.1 && fract(y * 60) < 0.3) l = Math.max(l, 0.18);
  }
  // threshold
  const thr = 0.37;
  if (Math.abs(y - thr) < 0.003 && x > left && x < right && fract(x * 24) < 0.6) ac = 0.9;
  // flag while a spike is past the threshold
  const spikeAt = ((t * 0.42) % 1.6) - 0.3;
  const sx = left + (0.3 + spikeAt * 0.55) * (right - left);
  if (spikeAt > 0.05 && spikeAt < 1.1 && sx > left + 0.02 && sx < right - 0.02) {
    if (Math.abs(x - sx) < 0.005 && y > thr - 0.15 && y < thr) ac = 1;
    if (x > sx && x < sx + 0.07 && y > thr - 0.15 && y < thr - 0.1) ac = 1;
  }
  return out(l, ac);
};

/* 4. A job moving through build, flash, restart, test and verify. */
export const pipeline: Scene = (x, y, t, a) => {
  const cx = a / 2;
  const p = (t % 10) / 2;
  let l = 0;
  let ac = 0;
  for (let i = 0; i < 5; i++) {
    const sx = cx - 0.56 + i * 0.28;
    const b = box(x, y, sx, 0.46, 0.105, 0.14);
    const done = p >= i + 1;
    const active = p >= i && p < i + 1;
    if (b < 0) {
      if (outline(b, 0.009)) l = 1;
      else if (done) l = Math.max(l, fract((x + y) * 36) < 0.62 ? 0.85 : 0.3);
      else if (active) {
        const local = p - i;
        const fillTo = sx - 0.105 + 0.21 * local;
        l = Math.max(l, x < fillTo ? 0.7 : 0.08);
        if (Math.abs(x - fillTo) < 0.008) ac = 1;
      } else l = Math.max(l, 0.06);
    }
    // little icons
    if (done) {
      if (dist(x, y, sx - 0.03, 0.465, sx - 0.008, 0.49) < 0.007 || dist(x, y, sx - 0.008, 0.49, sx + 0.04, 0.42) < 0.007) ac = 1;
    }
    // connector
    if (i < 4 && Math.abs(y - 0.46) < 0.004 && x > sx + 0.11 && x < sx + 0.17) l = Math.max(l, done ? 0.9 : 0.35);
  }
  // result light
  const ok = p >= 5 || p < 0.4;
  if (Math.hypot(x - (cx + 0.56), y - 0.7) < 0.026) ac = Math.max(ac, ok && p >= 5 ? 1 : 0.15);
  // timeline ticks
  for (let i = 0; i <= 10; i++) if (Math.abs(x - (cx - 0.56 + i * 0.112)) < 0.0035 && Math.abs(y - 0.74) < (i % 2 === 0 ? 0.02 : 0.01)) l = Math.max(l, 0.6);
  const prog = cx - 0.56 + clamp(p / 5) * 1.12;
  if (Math.abs(y - 0.74) < 0.005 && x > cx - 0.56 && x < prog) ac = 1;
  return out(l, ac);
};

/* 5. The connector contract: one certified board, other families planned. */
export const connectors: Scene = (x, y, t, a) => {
  const cx = a / 2;
  let l = 0;
  let ac = 0;
  // the contract bar
  const bar = box(x, y, cx, 0.2, 0.55, 0.045);
  if (bar < 0) l = outline(bar) ? 1 : fract(x * 28) < 0.5 ? 0.35 : 0.15;
  for (let i = 0; i < 6; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const sx = cx - 0.38 + col * 0.38;
    const sy = 0.5 + row * 0.27;
    const b = box(x, y, sx, sy, 0.13, 0.085);
    const lit = i === 0;
    if (b < 0) {
      if (outline(b)) l = lit ? 1 : 0.5;
      else l = Math.max(l, lit ? 0.2 : fract((x - y) * 26) < 0.3 ? 0.18 : 0.05);
    }
    // die and pins
    const die = box(x, y, sx, sy, 0.045, 0.03);
    if (die < 0) l = Math.max(l, outline(die, 0.006) ? (lit ? 1 : 0.5) : lit ? 0.5 : 0.1);
    for (let k = 0; k < 4; k++) {
      if (Math.abs(x - (sx - 0.075 + k * 0.05)) < 0.005 && Math.abs(Math.abs(y - sy) - 0.095) < 0.01) l = Math.max(l, lit ? 1 : 0.4);
    }
    // link up to the bar
    if (Math.abs(x - sx) < 0.003 && y > 0.245 && y < sy - 0.085 && (row === 0 || fract(y * 22) < 0.5)) l = Math.max(l, lit ? 0.9 : 0.3);
    if (lit) {
      const p = fract(t * 0.5);
      if (Math.abs(x - sx) < 0.012 && Math.abs(y - (0.26 + p * (sy - 0.085 - 0.26))) < 0.012) ac = 1;
      // tick
      if (dist(x, y, sx + 0.07, sy - 0.12, sx + 0.085, sy - 0.1) < 0.006 || dist(x, y, sx + 0.085, sy - 0.1, sx + 0.115, sy - 0.14) < 0.006) ac = 1;
    }
  }
  return out(l, ac);
};

/* 6. A gateway with several devices; one raises an alert. */
export const gateway: Scene = (x, y, t, a) => {
  const cx = a / 2;
  let l = 0;
  let ac = 0;
  // gateway: a small computer
  const scr = box(x, y, cx, 0.46, 0.13, 0.1);
  if (scr < 0) l = outline(scr, 0.009) ? 1 : 0.1;
  for (let i = 0; i < 3; i++) if (Math.abs(y - (0.42 + i * 0.035)) < 0.006 && x > cx - 0.09 && x < cx - 0.09 + 0.12 + 0.03 * ((i * 7) % 3) + 0.04 * fract(t * 0.5 + i)) l = Math.max(l, 0.8);
  const stand = box(x, y, cx, 0.58, 0.035, 0.018);
  if (stand < 0) l = Math.max(l, 1);
  const foot = box(x, y, cx, 0.612, 0.09, 0.01);
  if (foot < 0) l = Math.max(l, 1);

  const nodes: [number, number][] = [
    [cx - 0.5, 0.25],
    [cx + 0.5, 0.25],
    [cx - 0.5, 0.72],
    [cx + 0.5, 0.72],
  ];
  nodes.forEach(([nx, ny], i) => {
    const b = box(x, y, nx, ny, 0.085, 0.06);
    if (b < 0) l = Math.max(l, outline(b) ? 1 : 0.12);
    const c = box(x, y, nx, ny, 0.025, 0.022);
    if (c < 0) l = Math.max(l, outline(c, 0.005) ? 1 : 0.4);
    // link to the gateway
    const sx = cx + (nx < cx ? -0.13 : 0.13);
    const d = dist(x, y, nx + (nx < cx ? 0.085 : -0.085), ny + (ny < 0.5 ? 0.06 : -0.06), sx, 0.46);
    if (d < 0.003 && fract((x + y) * 26) < 0.6) l = Math.max(l, 0.5);
    const p = fract(t * 0.35 + i * 0.27);
    const x0 = nx + (nx < cx ? 0.085 : -0.085);
    const y0 = ny + (ny < 0.5 ? 0.06 : -0.06);
    if (Math.hypot(x - (x0 + (sx - x0) * p), y - (y0 + (0.46 - y0) * p)) < 0.011) ac = Math.max(ac, i === 3 ? 0 : 0.9);
    // the last device is in trouble
    if (i === 3) {
      const blink = Math.floor(t * 3) % 2 === 0;
      if (blink && Math.abs(x - nx) < 0.007 && y > ny - 0.045 && y < ny + 0.01) ac = 1;
      if (blink && Math.abs(x - nx) < 0.007 && Math.abs(y - (ny + 0.032)) < 0.006) ac = 1;
    }
  });
  return out(l, ac);
};

export const SCENES = { board, authority, telemetry, pipeline, connectors, gateway } as const;
export type SceneName = keyof typeof SCENES;
export { hash };
