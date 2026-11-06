import { useEffect, useRef, type ReactNode } from "react";
import { mount } from "@/lib/pixel";
import { SCENES, hash, type SceneName } from "@/lib/pixel-scenes";

const BLACK = "oklch(0.06 0 0)";
const GREEN = "oklch(0.68 0.13 130)";

/** Resolve any CSS colour to rgb by painting one pixel. */
function toRgb(css: string): [number, number, number] {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const ctx = c.getContext("2d");
  if (!ctx) return [0, 0, 0];
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0]!, d[1]!, d[2]!];
}

/** An animated pixel illustration drawn from a scene function. */
export function PixelScene({
  scene,
  label,
  tone = "dark",
  ratio = "16 / 10",
  cell = 5,
  className = "",
}: {
  scene: SceneName;
  label: string;
  tone?: "dark" | "field";
  ratio?: string;
  cell?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const field = tone === "field";
    return mount(el, SCENES[scene], {
      cell,
      ink: field ? "#030303" : "#e2d7ba",
      accent: field ? "#f5efd4" : "#a0d06b",
    });
  }, [scene, tone, cell]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      style={{ aspectRatio: ratio, imageRendering: "pixelated" }}
      className={`block w-full ${className}`}
    />
  );
}

/**
 * Where one colour field meets another, one breaks into the other as chunky pixel blocks.
 * The break line travels as you scroll, and the blocks on the edge flicker in whole frames.
 */
export function Seam({ from, to, salt = 1 }: { from: "black" | "green"; to: "black" | "green"; salt?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const A = toRgb(from === "black" ? BLACK : GREEN);
    const B = toRgb(to === "black" ? BLACK : GREEN);
    const CELL = 12;
    let cols = 0;
    let rows = 0;
    let image: ImageData | null = null;
    let lastKey = "";
    let visible = false;
    let raf = 0;

    const size = () => {
      const r = el.getBoundingClientRect();
      cols = Math.max(8, Math.ceil(r.width / CELL));
      rows = Math.max(4, Math.ceil(r.height / CELL));
      el.width = cols;
      el.height = rows;
      image = ctx.createImageData(cols, rows);
      lastKey = "";
    };

    const paint = (time: number) => {
      if (!image) return;
      const rect = box.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = reduced ? 0.5 : Math.min(1, Math.max(0, (vh - rect.top) / (vh + rect.height)));
      const frame = reduced ? 0 : Math.floor(time / 140);
      const key = `${Math.round(p * 200)}:${frame}`;
      if (key === lastKey) return;
      lastKey = key;
      for (let y = 0; y < rows; y++) {
        const t0 = (y + 0.5) / rows;
        const t = t0 * t0 * (3 - 2 * t0);
        for (let x = 0; x < cols; x++) {
          const bx = Math.floor(x / 2);
          const by = Math.floor(y / 2);
          const coarse = hash(bx * 7.1 + by * 13.7 + salt) > 0.5;
          const r = coarse ? hash(bx * 31.3 + by * 57.1 + salt * 3) : hash(x * 17.7 + y * 29.3 + salt * 5);
          const lane = (hash(Math.floor(x / 9) * 3.3 + salt) - 0.5) * 0.2;
          const edge = Math.min(1, Math.max(0, t + lane + (p - 0.5) * 0.42)) * 1.04;
          const on = Math.abs(r - edge) < 0.075 ? hash(x * 3.7 + y * 9.1 + frame * 1.37 + salt) < 0.5 : r < edge;
          const c = on ? B : A;
          const i = (y * cols + x) * 4;
          image.data[i] = c[0];
          image.data[i + 1] = c[1];
          image.data[i + 2] = c[2];
          image.data[i + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    };

    size();
    paint(0);
    const ro = new ResizeObserver(() => {
      size();
      paint(performance.now());
    });
    ro.observe(el);
    const io = new IntersectionObserver((e) => (visible = e.some((x) => x.isIntersecting)), { rootMargin: "120px" });
    io.observe(box);
    const loop = (time: number) => {
      raf = requestAnimationFrame(loop);
      if (visible) paint(time);
    };
    if (!reduced) raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [from, to, salt]);

  return (
    <div ref={wrap} aria-hidden="true" className="relative -my-px block h-[168px] w-full">
      <canvas ref={canvas} className="block h-full w-full" style={{ imageRendering: "pixelated" }} />
    </div>
  );
}

/** Small text placed like a poster note: tiny, spaced out, off to one side. */
export function Float({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`pointer-events-none absolute z-20 hidden max-w-[14rem] font-mono text-[10px] uppercase leading-[1.6] tracking-[0.08em] text-muted-foreground lg:block ${className}`}
    >
      <span className="mb-1.5 block text-sm leading-none">+</span>
      {children}
    </p>
  );
}
