import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { GET_STARTED_URL, SIGN_IN_URL } from "@/lib/workspace";
import { Logo } from "./Logo";

const NAV = [
  { label: "Product", to: "/product" },
  { label: "Platform", to: "/platform" },
  { label: "Hardware", to: "/hardware" },
  { label: "Models", to: "/models" },
  { label: "Applications", to: "/applications" },
  { label: "Developers", to: "/developers" },
  { label: "Docs", to: "/docs" },
  { label: "Company", to: "/company" },
] as const;

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

  return (
    <header
      className={`sticky top-0 z-50 w-full border-b transition-colors duration-300 ${
        scrolled
          ? "border-border bg-background/92 backdrop-blur-xl"
          : "border-transparent bg-transparent"
      }`}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-sm focus:bg-gold focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-8 md:px-12 lg:px-20">
        <Link to="/" className="flex items-center gap-3 shrink-0" aria-label="LokiAI home">
          <Logo className="h-12 w-auto" />
        </Link>

        <nav aria-label="Primary" className="ml-auto hidden xl:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = pathname === item.to;
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className={`whitespace-nowrap rounded-sm px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors ${
                      active ? "text-gold" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto hidden items-center gap-2 xl:ml-0 xl:flex shrink-0">
          <a
            href={SIGN_IN_URL}
            className="whitespace-nowrap rounded-sm px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </a>

          <a
            href={GET_STARTED_URL}
            className="whitespace-nowrap rounded-sm bg-gold px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-primary-foreground transition-opacity hover:opacity-85"
          >
            Get Started
          </a>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="loki-mobile-nav"
          aria-label={open ? "Close navigation menu" : "Open navigation menu"}
          className="ml-auto flex h-11 w-11 items-center justify-center rounded-sm border border-border text-foreground xl:hidden"
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

      {open && (
        <div
          id="loki-mobile-nav"
          className="fixed inset-x-0 bottom-0 top-16 z-50 overflow-y-auto border-t border-border bg-background px-5 py-8 xl:hidden"
        >
          <nav aria-label="Mobile">
            <ul className="flex flex-col">
              {NAV.map((item) => (
                <li key={item.to} className="border-b border-border/60">
                  <Link
                    to={item.to}
                    className="flex min-h-[56px] items-center justify-between font-serif text-2xl text-foreground"
                  >
                    {item.label}
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      {item.to}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="mt-8 flex flex-col gap-3">
            <a
              href={GET_STARTED_URL}
              className="flex min-h-[48px] items-center justify-center rounded-sm bg-gold font-mono text-xs uppercase tracking-[0.2em] text-primary-foreground"
            >
              Get Started
            </a>
            <a
              href={SIGN_IN_URL}
              className="flex min-h-[48px] items-center justify-center font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground"
            >
              Sign in
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
