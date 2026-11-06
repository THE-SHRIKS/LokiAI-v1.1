import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { REPO_URL } from "@/lib/links";
import { Logo } from "./Logo";

const LEFT = [
  { label: "Product", to: "/product" },
  { label: "Hardware", to: "/hardware" },
  { label: "Security", to: "/security" },
] as const;

const RIGHT = [
  { label: "Developers", to: "/developers" },
  { label: "Docs", to: "/docs" },
  { label: "Company", to: "/company" },
] as const;

const ALL = [...LEFT, ...RIGHT];

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
      />
    </svg>
  );
}

export function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const linkClass = (active: boolean) =>
    `whitespace-nowrap px-2 py-2 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors ${
      active ? "text-gold" : scrolled ? "text-muted-foreground hover:text-foreground" : "text-foreground/85 hover:text-foreground"
    }`;

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 w-full transition-colors duration-300 ${
        scrolled || open ? "bg-background" : "bg-transparent"
      }`}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:bg-gold focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <div className="mx-auto grid h-[72px] max-w-[1400px] grid-cols-[1fr_auto_1fr] items-center px-6 md:px-10">
        {/* Left links: on small screens this column holds the menu button instead. */}
        <nav aria-label="Primary" className="hidden justify-self-end pr-10 xl:block 2xl:pr-16">
          <ul className="flex items-center gap-4">
            {LEFT.map((item) => (
              <li key={item.to}>
                <Link to={item.to} className={linkClass(pathname === item.to)}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <Link to="/" className="col-start-2 flex items-center justify-self-center" aria-label="LokiAI home">
          <Logo className="h-12 w-auto" />
        </Link>

        <div className="col-start-3 flex items-center justify-self-stretch">
          <nav aria-label="More" className="hidden pl-10 xl:block 2xl:pl-16">
            <ul className="flex items-center gap-4">
              {RIGHT.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className={linkClass(pathname === item.to)}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="LokiAI on GitHub"
            className="ml-auto hidden px-1 text-foreground opacity-85 transition-opacity hover:opacity-100 xl:inline-flex"
          >
            <GitHubIcon />
          </a>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="loki-mobile-nav"
            aria-label={open ? "Close navigation menu" : "Open navigation menu"}
            className="ml-auto flex h-11 w-11 items-center justify-center border border-border text-foreground xl:hidden"
          >
            <span className="relative block h-3 w-4" aria-hidden="true">
              <span
                className={`absolute left-0 block h-px w-4 bg-current transition-transform ${open ? "top-1.5 rotate-45" : "top-0"}`}
              />
              <span
                className={`absolute left-0 top-1.5 block h-px w-4 bg-current transition-opacity ${open ? "opacity-0" : ""}`}
              />
              <span
                className={`absolute left-0 block h-px w-4 bg-current transition-transform ${open ? "top-1.5 -rotate-45" : "top-3"}`}
              />
            </span>
          </button>
        </div>
      </div>

      {open && (
        <div
          id="loki-mobile-nav"
          className="fixed inset-x-0 bottom-0 top-[72px] z-50 overflow-y-auto border-t border-border bg-background px-5 py-8 xl:hidden"
        >
          <nav aria-label="Mobile">
            <ul className="flex flex-col">
              {ALL.map((item) => (
                <li key={item.to} className="border-b border-border/60">
                  <Link
                    to={item.to}
                    className="flex min-h-[56px] items-center justify-between font-serif text-2xl text-foreground"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li className="border-b border-border/60">
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-[56px] items-center justify-between font-serif text-2xl text-foreground"
                >
                  GitHub
                </a>
              </li>
            </ul>
          </nav>
        </div>
      )}
    </header>
  );
}
