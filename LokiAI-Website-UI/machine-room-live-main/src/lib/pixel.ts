// A small ordered-dither renderer. A scene returns brightness for a point.
// Values 0..1 draw in the ink colour. Values 2..3 draw in the accent colour (brightness minus 2).

export type Scene = (x: number, y: number, t: number, a: number) => number;
export const ACC = 2;

export const BAYER: number[] = (() => {
  let m: number[][] = [
    [0, 2],
    [3, 1],
  ];
  for (let n = 2; n < 8; n *= 2) {
    const next: number[][] = [];
    for (let y = 0; y < n * 2; y++) {
      next.push([]);
      for (let x = 0; x < n * 2; x++) {
        const base = (m[y % n]?.[x % n] ?? 0) * 4;
        const q = (y < n ? 0 : 2) + (x < n ? 0 : 1);
        next[y]![x] = base + [0, 2, 3, 1][q]!;
      }
    }
    m = next;
  }
  return m.flat();
})();

const rgb = (hex: string): [number, number, number] => {
  const v = hex.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};

export interface MountOptions {
  cell: number;
  ink: string;
  accent: string;
}

/** Draws a scene into a canvas at a low resolution and a low frame rate (8 per second). */
export function mount(canvas: HTMLCanvasElement, scene: Scene, opts: MountOptions) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => undefined;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ink = rgb(opts.ink);
  const acc = rgb(opts.accent);
  let cols = 1;
  let rows = 1;
  let image: ImageData | null = null;
  let visible = true;
  let last = 0;
  let raf = 0;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    cols = Math.max(8, Math.floor(rect.width / opts.cell));
    rows = Math.max(8, Math.floor(rect.height / opts.cell));
    canvas.width = cols;
    canvas.height = rows;
    image = ctx.createImageData(cols, rows);
  };

  const draw = (time: number) => {
    if (!image) return;
    // Time moves in whole frames, so motion steps like a sprite sheet instead of gliding.
    const t = Math.floor(time / 125) / 8;
    const a = cols / rows;
    const s = Math.min(1, a / 1.3);
    const aEff = a / s;
    const data = image.data;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const px = ((x + 0.5) / cols) * a;
        const py = (y + 0.5) / rows;
        const X = a / 2 + (px - a / 2) / s;
        const Y = 0.5 + (py - 0.5) / s;
        const th = (BAYER[(y % 8) * 8 + (x % 8)] ?? 0) / 64;
        const v = scene(X, Y, t, aEff);
        const isAcc = v >= ACC;
        const l = isAcc ? v - ACC : v;
        const i = (y * cols + x) * 4;
        if (l > th) {
          const c = isAcc ? acc : ink;
          data[i] = c[0];
          data[i + 1] = c[1];
          data[i + 2] = c[2];
          data[i + 3] = 255;
        } else {
          data[i + 3] = 0;
        }
      }
    }
    ctx.putImageData(image, 0, 0);
  };

  const loop = (time: number) => {
    raf = requestAnimationFrame(loop);
    if (visible && time - last > 125) {
      draw(time);
      last = time;
    }
  };

  resize();
  draw(reduced ? 3000 : performance.now());
  const ro = new ResizeObserver(() => {
    resize();
    draw(reduced ? 3000 : performance.now());
  });
  ro.observe(canvas);
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
  });
  io.observe(canvas);
  if (!reduced) raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
  };
}
