import { Link } from "@tanstack/react-router";
import { ArrowRight, Cpu, ShieldCheck, Zap } from "lucide-react";

export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground font-sans selection:bg-olive/30 selection:text-olive-glow">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <img src="/lokiai-logo.png" alt="LokiAI" className="h-6" />
          </div>
          <div className="flex items-center gap-4">
            <Link
              to="/login"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Sign In
            </Link>
            <Link
              to="/login"
              className="inline-flex h-9 items-center justify-center rounded-md bg-olive px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-olive-bright"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden pt-24 pb-32 md:pt-32 md:pb-40">
          {/* Subtle background glow */}
          <div className="absolute top-1/4 left-1/2 -z-10 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-olive/20 opacity-50 blur-[120px]" />
          
          <div className="mx-auto max-w-6xl px-6 text-center">
            <h1 className="mx-auto max-w-4xl text-5xl font-bold tracking-tight text-foreground sm:text-7xl">
              Unleash AI on your phone. <br />
              <span className="text-olive-glow">Zero Cloud. Zero Cables.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              Deploy powerful local Large Language Models (LLMs) directly to your Android device over Wi-Fi. Experience true privacy, offline inference, and unmatched speed—no ADB required.
            </p>
            <div className="mt-10 flex items-center justify-center gap-4">
              <Link
                to="/login"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-olive px-8 text-base font-medium text-background transition-colors hover:bg-olive-bright"
              >
                Start Deploying <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {/* Hero Visual */}
            <div className="mt-20 flex justify-center">
              <div className="relative w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-panel shadow-2xl">
                <div className="absolute inset-0 bg-gradient-to-t from-background/40 to-transparent z-10" />
                <img 
                  src="/hero-visual.jpg" 
                  alt="LokiAI Neural Visual" 
                  className="w-full object-cover transition-transform duration-700 hover:scale-105"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="border-t border-border/50 bg-panel/30 py-24">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mb-16 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Built for the modern edge.
              </h2>
              <p className="mt-4 text-muted-foreground">
                Everything you need to manage on-device AI deployments effortlessly.
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-3">
              <div className="group overflow-hidden rounded-lg border border-border bg-panel transition-colors hover:border-olive/50">
                <div className="h-48 w-full overflow-hidden border-b border-border/50">
                  <img src="/feature_local_inference.jpg" alt="Local Inference Visualization" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                </div>
                <div className="p-8">
                  <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-md bg-olive/10 text-olive-bright">
                    <Cpu className="h-5 w-5" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-foreground">Local Inference</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Models run natively on your phone's hardware. Once downloaded, inference works completely offline with zero latency.
                  </p>
                </div>
              </div>

              <div className="group overflow-hidden rounded-lg border border-border bg-panel transition-colors hover:border-olive/50">
                <div className="h-48 w-full overflow-hidden border-b border-border/50">
                  <img src="/feature_privacy.jpg" alt="Absolute Privacy Visualization" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                </div>
                <div className="p-8">
                  <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-md bg-olive/10 text-olive-bright">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-foreground">Absolute Privacy</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Your data never leaves your device. No cloud processing, no server logs, and no API subscriptions required.
                  </p>
                </div>
              </div>

              <div className="group overflow-hidden rounded-lg border border-border bg-panel transition-colors hover:border-olive/50">
                <div className="h-48 w-full overflow-hidden border-b border-border/50">
                  <img src="/feature_wireless.jpg" alt="Wireless Deployment Visualization" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                </div>
                <div className="p-8">
                  <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-md bg-olive/10 text-olive-bright">
                    <Zap className="h-5 w-5" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-foreground">Wireless Deployment</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Just scan a QR code. Our proprietary WebSocket bridge pushes gigabyte-scale models over local Wi-Fi instantly.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-background py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} LokiAI. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">Powered by NVIDIA NIM</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
