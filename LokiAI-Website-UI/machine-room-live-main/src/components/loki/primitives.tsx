import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Float, PixelScene, Seam } from "./pixel";
import type { SceneName } from "@/lib/pixel-scenes";

/** A full-width band. `tone="field"` turns it green; join differently coloured bands with <Seam />. */
export function Section({
  id,
  children,
  className = "",
  bleed = false,
  tone = "black",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  bleed?: boolean;
  tone?: "black" | "field";
}) {
  return (
    <section id={id} className={`relative ${tone === "field" ? "field" : ""} ${className}`}>
      <div className={bleed ? "" : "mx-auto max-w-7xl px-8 py-20 md:px-12 lg:px-20 lg:py-28"}>
        {children}
      </div>
    </section>
  );
}

export function Eyebrow({ children, index }: { children: ReactNode; index?: string }) {
  return (
    <p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.24em] text-gold-dim">
      {index && <span className="px text-base tracking-normal text-foreground">{index}</span>}
      <span className="h-1.5 w-1.5 bg-gold" aria-hidden="true" />
      {children}
    </p>
  );
}

export function SectionHeader({
  eyebrow,
  index,
  title,
  lede,
  as: As = "h2",
}: {
  eyebrow?: string;
  index?: string;
  title: ReactNode;
  lede?: ReactNode;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <header className="max-w-3xl">
      {eyebrow && <Eyebrow index={index}>{eyebrow}</Eyebrow>}
      <As className="mt-5 font-serif text-3xl leading-[1.12] text-foreground sm:text-4xl lg:text-5xl">
        {title}
      </As>
      {lede && <p className="mt-6 text-lg text-muted-foreground sm:text-xl">{lede}</p>}
    </header>
  );
}

export type Availability = "available" | "beta" | "planned";

const STATUS_STYLE: Record<Availability, string> = {
  available: "border-live/60 text-live",
  beta: "border-gold/60 text-gold",
  planned: "border-border text-muted-foreground",
};

export function StatusPill({
  status,
  labels,
}: {
  status: Availability;
  labels?: Partial<Record<Availability, string>>;
}) {
  const text = labels?.[status] ?? (status === "available" ? "Available" : status === "beta" ? "Beta" : "Planned");
  return (
    <span
      className={`inline-flex items-center gap-2 border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] ${STATUS_STYLE[status]}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 ${
          status === "available"
            ? "bg-live [animation:loki-pulse_2s_steps(2)_infinite]"
            : status === "beta"
              ? "bg-gold"
              : "bg-muted-foreground"
        }`}
      />
      {text}
    </span>
  );
}

export function Panel({
  children,
  className = "",
  as: As = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "article" | "li";
}) {
  return (
    <As className={`border border-border p-6 transition-colors hover:border-gold/60 sm:p-8 ${className}`}>
      {children}
    </As>
  );
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-border py-4">
      <dt className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </dt>
      <dd className="text-base text-foreground">{value}</dd>
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return (
    <code className="border border-border px-1.5 py-0.5 font-mono text-[0.85em] text-gold">
      {children}
    </code>
  );
}

export function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <figure className="border-l-2 border-gold pl-5">
      {label && (
        <figcaption className="pb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </figcaption>
      )}
      <pre className="overflow-x-auto font-mono text-[13px] leading-relaxed text-foreground">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

// A CTA target is either an internal route (`to`, routed via TanStack
// Link) or an external target (`href`, a plain anchor).
type CTATarget = { label: string } & ({ to: string; href?: never } | { href: string; to?: never });

function CTAButton({ target, className }: { target: CTATarget; className: string }) {
  if (target.href) {
    return (
      <a href={target.href} className={className} {...(target.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
        {target.label}
      </a>
    );
  }
  return (
    <Link to={target.to!} className={className}>
      {target.label}
    </Link>
  );
}

/** A green closing band that joins the previous black band and the footer with pixel seams. */
export function CTABlock({
  title,
  body,
  primary = { label: "View on GitHub", href: "https://github.com/THE-SHRIKS/LokiAI-v1.2" },
  secondary = { label: "Read the docs", to: "/docs" },
  tertiary = { label: "Contact us", to: "/contact" },
  seamFrom = "black",
}: {
  title: ReactNode;
  body?: string;
  primary?: CTATarget;
  secondary?: CTATarget;
  tertiary?: CTATarget | null;
  seamFrom?: "black" | "green";
}) {
  return (
    <>
      {seamFrom === "black" && <Seam from="black" to="green" salt={91} />}
      <Section tone="field">
        <Float className="right-[6%] top-[18%]">Open source.<br />In development.</Float>
        <div className="max-w-3xl">
          <h2 className="font-serif text-3xl leading-tight text-foreground sm:text-4xl lg:text-5xl">{title}</h2>
          {body && <p className="mt-6 text-lg text-muted-foreground">{body}</p>}
          <div className="mt-10 flex flex-wrap gap-3">
            <CTAButton
              target={primary}
              className="inline-flex min-h-[48px] items-center bg-gold px-6 font-mono text-xs uppercase tracking-[0.2em] text-primary-foreground transition-opacity hover:opacity-85"
            />
            <CTAButton
              target={secondary}
              className="inline-flex min-h-[48px] items-center border border-foreground px-6 font-mono text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-primary-foreground"
            />
            {tertiary && (
              <CTAButton
                target={tertiary}
                className="inline-flex min-h-[48px] items-center px-2 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
              />
            )}
          </div>
        </div>
      </Section>
      <Seam from="green" to="black" salt={92} />
    </>
  );
}

/** A page opener: title and lede on the left, an optional pixel scene on the right. */
export function PageHero({
  eyebrow,
  title,
  lede,
  meta,
  scene,
  sceneLabel,
  note,
}: {
  eyebrow: string;
  title: ReactNode;
  lede: string;
  meta?: string[];
  scene?: SceneName;
  sceneLabel?: string;
  note?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden">
      {note && <Float className="right-[5%] top-[14%]">{note}</Float>}
      <div className="relative mx-auto grid max-w-7xl gap-12 px-8 py-20 md:px-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:px-20 lg:py-28">
        <div>
          <SectionHeader as="h1" eyebrow={eyebrow} title={title} lede={lede} />
          {meta && (
            <ul className="mt-10 flex flex-wrap gap-x-8 gap-y-3">
              {meta.map((m) => (
                <li
                  key={m}
                  className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground"
                >
                  {m}
                </li>
              ))}
            </ul>
          )}
        </div>
        {scene && (
          <div className="min-w-0">
            <PixelScene scene={scene} label={sceneLabel ?? "Pixel illustration"} ratio="16 / 11" />
          </div>
        )}
      </div>
    </section>
  );
}

export { Float, PixelScene, Seam };
