import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function Section({
  id,
  children,
  className = "",
  bleed = false,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  bleed?: boolean;
}) {
  return (
    <section id={id} className={`border-t border-border ${className}`}>
      <div className={bleed ? "" : "mx-auto max-w-7xl px-8 py-20 md:px-12 lg:px-20 lg:py-28"}>
        {children}
      </div>
    </section>
  );
}

export function Eyebrow({ children, index }: { children: ReactNode; index?: string }) {
  return (
    <p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.28em] text-gold-dim">
      {index && <span className="text-muted-foreground">{index}</span>}
      <span className="h-px w-8 bg-border" aria-hidden="true" />
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
      <As className="mt-5 font-serif text-4xl leading-[1.08] text-foreground sm:text-5xl lg:text-6xl">
        {title}
      </As>
      {lede && <p className="mt-6 text-lg text-muted-foreground sm:text-xl">{lede}</p>}
    </header>
  );
}

export type Availability = "available" | "beta" | "planned";

const STATUS_STYLE: Record<Availability, string> = {
  available: "border-live/50 text-live",
  beta: "border-gold/50 text-gold",
  planned: "border-border text-muted-foreground",
};

export function StatusPill({ status }: { status: Availability }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] ${STATUS_STYLE[status]}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          status === "available"
            ? "bg-live [animation:loki-pulse_2s_ease-in-out_infinite]"
            : status === "beta"
              ? "bg-gold"
              : "bg-muted-foreground"
        }`}
      />
      {status === "available" ? "Available" : status === "beta" ? "Beta" : "Planned"}
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
    <As
      className={`rounded-sm border border-border bg-plane/40 backdrop-blur-md p-6 transition-colors hover:border-gold/40 sm:p-8 ${className}`}
    >
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
    <code className="rounded-sm border border-border bg-plane/40 backdrop-blur-md px-1.5 py-0.5 font-mono text-[0.85em] text-gold">
      {children}
    </code>
  );
}

export function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <figure className="overflow-hidden rounded-sm border border-border bg-plane/40 backdrop-blur-md">
      {label && (
        <figcaption className="border-b border-border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </figcaption>
      )}
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-foreground">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

// A CTA target is either an internal route (`to`, routed via TanStack
// Link) or an external target (`href`, a plain anchor — used for
// mailto: links so contact buttons open the user's real mail client
// instead of navigating within the app).
type CTATarget = { label: string } & ({ to: string; href?: never } | { href: string; to?: never });

function CTAButton({ target, className }: { target: CTATarget; className: string }) {
  if (target.href) {
    return (
      <a href={target.href} className={className}>
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

export function CTABlock({
  title,
  body,
  primary = { label: "Open Workspace", to: "/product" },
  secondary = { label: "Read the Docs", to: "/docs" },
  tertiary = { label: "Contact us", to: "/contact" },
}: {
  title: ReactNode;
  body?: string;
  primary?: CTATarget;
  secondary?: CTATarget;
  tertiary?: CTATarget | null;
}) {
  return (
    <Section className="bg-plane/40">
      <div className="max-w-3xl">
        <h2 className="font-serif text-4xl leading-tight text-foreground sm:text-5xl">{title}</h2>
        {body && <p className="mt-6 text-lg text-muted-foreground">{body}</p>}
        <div className="mt-10 flex flex-wrap gap-3">
          <CTAButton
            target={primary}
            className="inline-flex min-h-[48px] items-center rounded-sm bg-gold px-6 font-mono text-xs uppercase tracking-[0.2em] text-primary-foreground transition-opacity hover:opacity-85"
          />
          <CTAButton
            target={secondary}
            className="inline-flex min-h-[48px] items-center rounded-sm border border-border px-6 font-mono text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:border-gold hover:text-gold"
          />
          {tertiary && (
            <CTAButton
              target={tertiary}
              className="inline-flex min-h-[48px] items-center px-2 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-foreground"
            />
          )}
        </div>
      </div>
    </Section>
  );
}

export function PageHero({
  eyebrow,
  title,
  lede,
  meta,
}: {
  eyebrow: string;
  title: ReactNode;
  lede: string;
  meta?: string[];
}) {
  return (
    <section className="relative overflow-hidden">
      <div className="relative mx-auto max-w-7xl px-8 py-20 md:px-12 lg:px-20 lg:py-28">
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
    </section>
  );
}
