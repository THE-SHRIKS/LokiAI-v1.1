import { Link } from "@tanstack/react-router";
import { Logo } from "./Logo";

const COLUMNS = [
  {
    title: "Platform",
    links: [
      { label: "Product", to: "/product" as const },
      { label: "Platform", to: "/platform" as const },
      { label: "Hardware", to: "/hardware" as const },
      { label: "Models", to: "/models" as const },
    ],
  },
  {
    title: "Build",
    links: [
      { label: "Applications", to: "/applications" as const },
      { label: "Developers", to: "/developers" as const },
      { label: "Docs", to: "/docs" as const },
      { label: "Security", to: "/security" as const },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", to: "/company" as const },
      { label: "Contact", to: "/contact" as const },
      { label: "Privacy", to: "/legal/privacy" as const },
      { label: "Terms", to: "/legal/terms" as const },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-transparent">
      <div className="mx-auto max-w-[1400px] px-5 py-16 sm:px-8">
        <div className="grid gap-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <div className="flex items-center gap-3">
              <Logo className="h-12 w-auto" />
            </div>
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              An AI-native deployment and operations layer for heterogeneous hardware. Built by THE
              SHRIKS.
            </p>
            <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Android agent available · more device classes in development
            </p>
          </div>
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.24em] text-gold-dim">
                {col.title}
              </h2>
              <ul className="mt-4 space-y-3">
                {col.links.map((l) => (
                  <li key={l.to}>
                    <Link
                      to={l.to}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-16 flex flex-col gap-3 border-t border-border pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            © {new Date().getFullYear()} THE SHRIKS · LokiAI
          </p>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Local inference · Verified artifacts · Device-scoped credentials
          </p>
        </div>
      </div>
    </footer>
  );
}
