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

            {/* Interactive Hero Visual */}
            <div className="mt-20 flex justify-center">
              <div className="group relative w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-panel shadow-2xl">
                <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent z-10" />
                
                <div className="relative h-64 md:h-96 w-full overflow-hidden bg-[#030303]">
                  {/* Grid background */}
                  <div className="absolute inset-0 bg-[linear-gradient(to_right,#6b8c421a_1px,transparent_1px),linear-gradient(to_bottom,#6b8c421a_1px,transparent_1px)] bg-[size:2rem_2rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
                  
                  {/* Floating elements */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-8 md:gap-16 z-0">
                    {/* Server Node */}
                    <div className="relative flex h-24 w-24 flex-col items-center justify-center rounded-2xl border border-olive/30 bg-background/50 backdrop-blur-md shadow-[0_0_30px_-5px_var(--olive-glow)] transition-transform duration-700 group-hover:-translate-y-2">
                      <div className="absolute -top-3 -right-3 flex h-6 w-6 items-center justify-center rounded-full bg-olive-bright text-[10px] font-bold text-background shadow-lg">AI</div>
                      <Cpu className="h-10 w-10 text-olive-bright" />
                      <div className="mt-2 text-[10px] font-medium tracking-widest text-muted-foreground">LOKI CORE</div>
                    </div>

                    {/* Animated Connection */}
                    <div className="relative w-24 md:w-40 h-px bg-border">
                      <div className="absolute top-1/2 left-0 h-1 w-full -translate-y-1/2 overflow-hidden">
                        <div className="h-full w-1/3 animate-[slide_2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-olive-bright to-transparent" />
                      </div>
                    </div>

                    {/* Phone Node */}
                    <div className="relative flex h-28 w-20 flex-col items-center justify-center rounded-[1.5rem] border-2 border-olive/30 bg-background/50 backdrop-blur-md shadow-[0_0_30px_-5px_var(--olive-glow)] transition-transform duration-700 delay-100 group-hover:-translate-y-2">
                      <div className="absolute top-2 h-1 w-6 rounded-full bg-border" />
                      <div className="h-full w-full rounded-[1.3rem] border border-border/50 bg-panel/30 p-2 flex flex-col justify-center items-center">
                        <div className="h-8 w-8 rounded-full border border-olive-bright/50 flex items-center justify-center animate-pulse">
                          <Zap className="h-4 w-4 text-olive-bright" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
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
              {/* Feature 1: Local Inference */}
              <div className="group overflow-hidden rounded-lg border border-border bg-panel transition-all hover:border-olive/50 hover:shadow-[0_0_30px_-15px_var(--olive-glow)]">
                <div className="relative h-48 w-full overflow-hidden border-b border-border/50 bg-[#020202]">
                  {/* Interactive Visual */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="relative h-24 w-24">
                      {/* Outer spinning ring */}
                      <div className="absolute inset-0 rounded-full border border-dashed border-olive/30 animate-[spin_10s_linear_infinite]" />
                      <div className="absolute inset-2 rounded-full border border-olive/20 animate-[spin_15s_linear_infinite_reverse]" />
                      {/* Center chip */}
                      <div className="absolute inset-0 flex items-center justify-center transition-transform duration-500 group-hover:scale-110">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-olive-bright bg-olive/10 shadow-[0_0_15px_0_var(--olive-glow)]">
                          <Cpu className="h-6 w-6 text-olive-bright" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="p-8">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-olive/10 text-olive-bright">
                    <Cpu className="h-5 w-5" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-foreground">Local Inference</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Models run natively on your phone's hardware. Once downloaded, inference works completely offline with zero latency.
                  </p>
                </div>
              </div>

              {/* Feature 2: Absolute Privacy */}
              <div className="group overflow-hidden rounded-lg border border-border bg-panel transition-all hover:border-olive/50 hover:shadow-[0_0_30px_-15px_var(--olive-glow)]">
                <div className="relative h-48 w-full overflow-hidden border-b border-border/50 bg-[#020202]">
                  {/* Interactive Visual */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    {/* Concentric waves */}
                    <div className="absolute h-32 w-32 rounded-full border border-olive/20 opacity-0 animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite]" />
                    <div className="absolute h-24 w-24 rounded-full border border-olive/40 opacity-0 animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite_1s]" />
                    {/* Shield */}
                    <div className="relative flex h-16 w-16 items-center justify-center transition-transform duration-500 group-hover:scale-110">
                      <div className="absolute inset-0 bg-olive-bright/20 blur-xl" />
                      <ShieldCheck className="relative h-10 w-10 text-olive-bright drop-shadow-[0_0_10px_var(--olive-glow)]" />
                    </div>
                  </div>
                </div>
                <div className="p-8">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-olive/10 text-olive-bright">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-foreground">Absolute Privacy</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Your data never leaves your device. No cloud processing, no server logs, and no API subscriptions required.
                  </p>
                </div>
              </div>

              {/* Feature 3: Wireless Deployment */}
              <div className="group overflow-hidden rounded-lg border border-border bg-panel transition-all hover:border-olive/50 hover:shadow-[0_0_30px_-15px_var(--olive-glow)]">
                <div className="relative h-48 w-full overflow-hidden border-b border-border/50 bg-[#020202]">
                  {/* Interactive Visual */}
                  <div className="absolute inset-0 flex items-center justify-center gap-8">
                    {/* Laptop Icon */}
                    <div className="h-10 w-14 rounded-sm border-2 border-muted-foreground flex flex-col justify-between p-1 transition-transform group-hover:-translate-x-2">
                      <div className="h-4 w-full bg-muted/20 rounded-sm" />
                      <div className="h-1 w-full bg-muted-foreground rounded-full" />
                    </div>
                    {/* Wireless Waves */}
                    <div className="flex gap-1 items-center">
                      <div className="h-2 w-2 rounded-full bg-olive animate-[bounce_1s_infinite_0ms]" />
                      <div className="h-2 w-2 rounded-full bg-olive animate-[bounce_1s_infinite_200ms]" />
                      <div className="h-2 w-2 rounded-full bg-olive animate-[bounce_1s_infinite_400ms]" />
                    </div>
                    {/* Phone Icon */}
                    <div className="h-12 w-8 rounded-md border-2 border-olive-bright bg-olive/10 p-1 flex items-center justify-center shadow-[0_0_15px_0_var(--olive-glow)] transition-transform group-hover:translate-x-2">
                      <div className="h-4 w-4 bg-olive-bright/80 rounded-sm animate-pulse" />
                    </div>
                  </div>
                </div>
                <div className="p-8">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-olive/10 text-olive-bright">
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
