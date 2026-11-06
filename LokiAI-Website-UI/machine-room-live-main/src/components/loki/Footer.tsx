import { Link } from "@tanstack/react-router";
import { Logo } from "./Logo";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Product", to: "/product" as const },
      { label: "Hardware", to: "/hardware" as const },
      { label: "Security", to: "/security" as const },
    ],
  },
  {
    title: "Build",
    links: [
      { label: "Developers", to: "/developers" as const },
      { label: "Docs", to: "/docs" as const },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", to: "/company" as const },
      { label: "Contact", to: "/contact" as const },
      { label: "Legal", to: "/legal" as const },
      { label: "Privacy", to: "/legal/privacy" as const },
      { label: "Terms", to: "/legal/terms" as const },
    ],
  },
];

// Same four accounts as the Organization schema's sameAs in __root.tsx —
// keep these two lists in sync if a handle ever changes.
const SOCIALS = [
  { label: "X", href: "https://x.com/theshriks1" },
  { label: "Instagram", href: "https://www.instagram.com/times.theshriks/" },
  { label: "Reddit", href: "https://www.reddit.com/user/ShrishLoki/" },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/laukik-rajput-95bb48300/" },
];

export function Footer() {
  return (
    <footer className="bg-transparent">
      <div className="mx-auto max-w-[1400px] px-5 py-16 sm:px-8">
        <div className="grid gap-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <div className="flex items-center gap-3">
              <Logo className="h-12 w-auto" />
            </div>
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              A desktop app and local runtime that lets coding agents work on real hardware with your approval. Open source. Built by THE SHRIKS.
            </p>
            <nav aria-label="Social" className="mt-6 flex flex-wrap gap-x-4 gap-y-2">
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="me noreferrer"
                  className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-gold"
                >
                  {s.label}
                </a>
              ))}
            </nav>
          </div>
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.24em] text-gold-dim">
                {column.title}
              </h2>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.to}>
                    <Link
                      to={link.to}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-16 border-t border-border pt-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            &copy; {new Date().getFullYear()} THE SHRIKS · LokiAI
          </p>
        </div>
      </div>
    </footer>
  );
}
