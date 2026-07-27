import { Link } from "@tanstack/react-router";
import { ArrowRight, Cpu, ShieldCheck, Zap, Smartphone, Box, Bot, Mic, Scan, Code, Layers, ChevronDown } from "lucide-react";
import { useState } from "react";

export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground font-sans selection:bg-olive/30 selection:text-olive-glow overflow-x-hidden">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <img src="/lokiai-logo.png" alt="LokiAI" className="h-6" />
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
            <a href="#features" className="hover:text-olive-bright transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-olive-bright transition-colors">How it Works</a>
            <a href="#capabilities" className="hover:text-olive-bright transition-colors">Capabilities</a>
            <a href="#faq" className="hover:text-olive-bright transition-colors">FAQ</a>
          </div>
          <div className="flex items-center gap-4">
            <Link
              to="/login"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hidden sm:block"
            >
              Sign In
            </Link>
            <Link
              to="/login"
              className="inline-flex h-9 items-center justify-center rounded-md bg-olive px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-olive-bright shadow-[0_0_15px_-3px_var(--olive-glow)]"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden pt-24 pb-20 md:pt-32 md:pb-28">
          {/* Subtle background glow */}
          <div className="absolute top-1/4 left-1/2 -z-10 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-olive/20 opacity-50 blur-[120px]" />
          
          <div className="mx-auto max-w-7xl px-6 text-center">
            <div className="inline-flex items-center rounded-full border border-olive/30 bg-olive/10 px-3 py-1 text-sm text-olive-bright mb-8 shadow-[0_0_10px_0_var(--olive-glow)]">
              <span className="flex h-2 w-2 rounded-full bg-olive-bright mr-2 animate-pulse"></span>
              LokiAI v3 is now live
            </div>
            <h1 className="mx-auto max-w-5xl text-5xl font-extrabold tracking-tight text-foreground sm:text-7xl">
              Unleash AI on your phone. <br className="hidden sm:block" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-olive-bright to-olive-glow">Zero Cloud. Zero Cables.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              Deploy powerful local Large Language Models (LLMs) and Vision models directly to your Android device over Wi-Fi. Experience true privacy, offline inference, and unmatched speed.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/login"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-olive px-8 text-base font-medium text-background transition-all hover:bg-olive-bright hover:shadow-[0_0_20px_0_var(--olive-glow)] w-full sm:w-auto"
              >
                Start Deploying <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-border bg-panel px-8 text-base font-medium text-foreground transition-colors hover:bg-accent w-full sm:w-auto"
              >
                <Code className="h-4 w-4" /> View Architecture
              </a>
            </div>

            {/* Interactive Hero Visual */}
            <div className="mt-20 flex justify-center">
              <div className="group relative w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-panel shadow-2xl">
                <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent z-10" />
                
                <div className="relative h-64 md:h-96 w-full overflow-hidden bg-[#030303]">
                  {/* Grid background */}
                  <div className="absolute inset-0 bg-[linear-gradient(to_right,#6b8c421a_1px,transparent_1px),linear-gradient(to_bottom,#6b8c421a_1px,transparent_1px)] bg-[size:2rem_2rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
                  
                  {/* Floating elements */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-8 md:gap-24 z-0 w-full justify-center px-4">
                    {/* Server Node */}
                    <div className="relative flex h-24 w-24 md:h-32 md:w-32 flex-col items-center justify-center rounded-2xl border border-olive/30 bg-background/80 backdrop-blur-md shadow-[0_0_30px_-5px_var(--olive-glow)] transition-transform duration-700 group-hover:-translate-y-2">
                      <div className="absolute -top-3 -right-3 flex h-6 w-6 items-center justify-center rounded-full bg-olive-bright text-[10px] font-bold text-background shadow-lg">AI</div>
                      <Cpu className="h-10 w-10 md:h-14 md:w-14 text-olive-bright" />
                      <div className="mt-3 text-[10px] md:text-xs font-medium tracking-widest text-muted-foreground">LOKI CORE</div>
                    </div>

                    {/* Animated Connection */}
                    <div className="relative w-24 md:w-48 h-px bg-border">
                      <div className="absolute top-1/2 left-0 h-1 w-full -translate-y-1/2 overflow-hidden">
                        <div className="h-full w-1/3 animate-[slide_2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-olive-bright to-transparent" />
                      </div>
                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] text-olive-bright bg-olive/10 px-2 py-0.5 rounded-full border border-olive/20 whitespace-nowrap hidden md:block">
                        WSS:// (Local Wi-Fi)
                      </div>
                    </div>

                    {/* Phone Node */}
                    <div className="relative flex h-32 w-20 md:h-40 md:w-24 flex-col items-center justify-center rounded-[1.5rem] md:rounded-[2rem] border-2 border-olive/30 bg-background/80 backdrop-blur-md shadow-[0_0_30px_-5px_var(--olive-glow)] transition-transform duration-700 delay-100 group-hover:-translate-y-2">
                      <div className="absolute top-2 md:top-3 h-1 w-6 rounded-full bg-border" />
                      <div className="h-full w-full rounded-[1.3rem] md:rounded-[1.8rem] border border-border/50 bg-panel/50 p-2 flex flex-col justify-center items-center overflow-hidden">
                         {/* Mock phone screen */}
                         <div className="w-full h-full bg-[#050505] rounded-md md:rounded-lg flex flex-col pt-4 px-2">
                            <div className="w-full flex gap-1 mb-2">
                                <div className="h-1.5 w-1/2 bg-olive-bright/80 rounded-full animate-pulse" />
                                <div className="h-1.5 w-1/4 bg-border rounded-full" />
                            </div>
                            <div className="h-8 w-full border border-olive-bright/30 rounded bg-olive/5 flex items-center justify-center mt-auto mb-2">
                                <Zap className="h-4 w-4 text-olive-bright animate-pulse" />
                            </div>
                         </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Integration / Trust Banner */}
        <section className="border-y border-border/50 bg-panel/30 py-10">
          <div className="mx-auto max-w-7xl px-6 text-center">
            <p className="text-sm font-medium text-muted-foreground mb-6 uppercase tracking-widest">Seamlessly integrated with the AI ecosystem</p>
            <div className="flex flex-wrap justify-center gap-10 md:gap-20 items-center opacity-60 grayscale hover:grayscale-0 transition-all duration-500">
              <div className="flex items-center gap-2 font-bold text-xl"><Box className="h-6 w-6 text-yellow-500" /> HuggingFace</div>
              <div className="flex items-center gap-2 font-bold text-xl"><Cpu className="h-6 w-6 text-green-500" /> NVIDIA NIM</div>
              <div className="flex items-center gap-2 font-bold text-xl text-foreground">llama.cpp</div>
              <div className="flex items-center gap-2 font-bold text-xl text-blue-400">TFLite</div>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section id="how-it-works" className="py-24 relative">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-20 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                From cloud to edge in seconds.
              </h2>
              <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
                No complex ADB setups or manual APK builds. Our pipeline handles the heavy lifting so you can focus on building.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-12 relative">
              {/* Connecting line for desktop */}
              <div className="hidden md:block absolute top-12 left-1/6 right-1/6 h-0.5 bg-border -z-10" />

              {/* Step 1 */}
              <div className="flex flex-col items-center text-center group">
                <div className="h-24 w-24 rounded-full border-2 border-olive/30 bg-background flex items-center justify-center mb-6 shadow-[0_0_15px_0_var(--olive-glow)] group-hover:scale-110 transition-transform duration-500">
                  <Scan className="h-10 w-10 text-olive-bright" />
                </div>
                <h3 className="text-xl font-semibold mb-3">1. Pair via QR</h3>
                <p className="text-muted-foreground text-sm">Download the LokiAI Android app and scan the dashboard QR code. Your device hardware specs are automatically registered.</p>
              </div>

              {/* Step 2 */}
              <div className="flex flex-col items-center text-center group">
                <div className="h-24 w-24 rounded-full border-2 border-olive/30 bg-background flex items-center justify-center mb-6 shadow-[0_0_15px_0_var(--olive-glow)] group-hover:scale-110 transition-transform duration-500 delay-100">
                  <Bot className="h-10 w-10 text-olive-bright" />
                </div>
                <h3 className="text-xl font-semibold mb-3">2. AI Recommends</h3>
                <p className="text-muted-foreground text-sm">Tell Loki what you want to build. Powered by NVIDIA NIM, it searches HuggingFace and filters models that physically fit your phone's RAM.</p>
              </div>

              {/* Step 3 */}
              <div className="flex flex-col items-center text-center group">
                <div className="h-24 w-24 rounded-full border-2 border-olive/30 bg-background flex items-center justify-center mb-6 shadow-[0_0_15px_0_var(--olive-glow)] group-hover:scale-110 transition-transform duration-500 delay-200">
                  <Smartphone className="h-10 w-10 text-olive-bright" />
                </div>
                <h3 className="text-xl font-semibold mb-3">3. Deploy & Run</h3>
                <p className="text-muted-foreground text-sm">Hit deploy. The phone pulls the model directly from the CDN over Wi-Fi. It runs 100% locally with zero cloud dependencies.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="border-t border-border/50 bg-panel/30 py-24 relative overflow-hidden">
          {/* Decorative glow */}
          <div className="absolute top-0 right-0 -z-10 h-96 w-96 rounded-full bg-olive/10 opacity-50 blur-[100px]" />
          
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-16 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Built for the modern edge.
              </h2>
              <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
                Everything you need to manage on-device AI deployments effortlessly in a production-grade environment.
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-3">
              {/* Feature 1: Local Inference */}
              <div className="group overflow-hidden rounded-xl border border-border bg-background transition-all hover:border-olive/50 hover:shadow-[0_0_30px_-15px_var(--olive-glow)]">
                <div className="relative h-48 w-full overflow-hidden border-b border-border/50 bg-[#020202]">
                  {/* Interactive Visual */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="relative h-24 w-24">
                      <div className="absolute inset-0 rounded-full border border-dashed border-olive/30 animate-[spin_10s_linear_infinite]" />
                      <div className="absolute inset-2 rounded-full border border-olive/20 animate-[spin_15s_linear_infinite_reverse]" />
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
                  <h3 className="mb-2 text-xl font-semibold text-foreground">Local Inference</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Models run natively on your phone's hardware. Once downloaded, inference works completely offline with zero latency, utilizing on-device NPU/GPU acceleration where available.
                  </p>
                </div>
              </div>

              {/* Feature 2: Absolute Privacy */}
              <div className="group overflow-hidden rounded-xl border border-border bg-background transition-all hover:border-olive/50 hover:shadow-[0_0_30px_-15px_var(--olive-glow)]">
                <div className="relative h-48 w-full overflow-hidden border-b border-border/50 bg-[#020202]">
                  {/* Interactive Visual */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="absolute h-32 w-32 rounded-full border border-olive/20 opacity-0 animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite]" />
                    <div className="absolute h-24 w-24 rounded-full border border-olive/40 opacity-0 animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite_1s]" />
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
                  <h3 className="mb-2 text-xl font-semibold text-foreground">Absolute Privacy</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Your data never leaves your device. No cloud processing, no server logs, and no API subscriptions required. Perfect for enterprise deployments handling sensitive PII data.
                  </p>
                </div>
              </div>

              {/* Feature 3: Wireless Deployment */}
              <div className="group overflow-hidden rounded-xl border border-border bg-background transition-all hover:border-olive/50 hover:shadow-[0_0_30px_-15px_var(--olive-glow)]">
                <div className="relative h-48 w-full overflow-hidden border-b border-border/50 bg-[#020202]">
                  {/* Interactive Visual */}
                  <div className="absolute inset-0 flex items-center justify-center gap-8">
                    <div className="h-10 w-14 rounded-sm border-2 border-muted-foreground flex flex-col justify-between p-1 transition-transform group-hover:-translate-x-2">
                      <div className="h-4 w-full bg-muted/20 rounded-sm" />
                      <div className="h-1 w-full bg-muted-foreground rounded-full" />
                    </div>
                    <div className="flex gap-1 items-center">
                      <div className="h-2 w-2 rounded-full bg-olive-bright animate-[bounce_1s_infinite_0ms]" />
                      <div className="h-2 w-2 rounded-full bg-olive-bright animate-[bounce_1s_infinite_200ms]" />
                      <div className="h-2 w-2 rounded-full bg-olive-bright animate-[bounce_1s_infinite_400ms]" />
                    </div>
                    <div className="h-12 w-8 rounded-md border-2 border-olive-bright bg-olive/10 p-1 flex items-center justify-center shadow-[0_0_15px_0_var(--olive-glow)] transition-transform group-hover:translate-x-2">
                      <div className="h-4 w-4 bg-olive-bright/80 rounded-sm animate-pulse" />
                    </div>
                  </div>
                </div>
                <div className="p-8">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-olive/10 text-olive-bright">
                    <Zap className="h-5 w-5" />
                  </div>
                  <h3 className="mb-2 text-xl font-semibold text-foreground">Wireless Deployment</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Just scan a QR code. Our proprietary WebSocket bridge pushes gigabyte-scale models over local Wi-Fi instantly. No USB cables, no ADB debugging menus.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Bento Box Capabilities */}
        <section id="capabilities" className="py-24">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-16 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Run any modality, anywhere.
              </h2>
            </div>
            
            <div className="grid md:grid-cols-2 gap-6">
              {/* Vision Card */}
              <div className="rounded-2xl border border-border bg-panel p-8 flex flex-col h-full group hover:border-olive/30 transition-colors">
                <div className="h-40 w-full rounded-xl bg-background border border-border/50 mb-6 flex items-center justify-center relative overflow-hidden">
                  <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10" />
                  <div className="relative border-2 border-dashed border-olive/50 h-24 w-32 rounded flex items-center justify-center group-hover:border-olive transition-colors">
                    <div className="absolute -top-3 -right-3 bg-olive-bright text-background text-xs px-2 py-0.5 rounded font-bold">99%</div>
                    <Scan className="h-8 w-8 text-olive/50 group-hover:text-olive-bright transition-colors" />
                  </div>
                </div>
                <h3 className="text-2xl font-bold mb-2">Computer Vision</h3>
                <p className="text-muted-foreground flex-1">Deploy TFLite models for real-time object detection, image classification, and pose estimation directly utilizing the smartphone's camera feed at 30+ FPS.</p>
              </div>

              {/* Chat Card */}
              <div className="rounded-2xl border border-border bg-panel p-8 flex flex-col h-full group hover:border-olive/30 transition-colors">
                <div className="h-40 w-full rounded-xl bg-background border border-border/50 mb-6 flex flex-col justify-end p-4 relative overflow-hidden">
                  <div className="w-3/4 h-8 bg-muted rounded-lg rounded-tl-none mb-2 self-start flex items-center px-3 text-xs text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity">Write a python script...</div>
                  <div className="w-3/4 h-12 bg-olive/10 border border-olive/20 rounded-lg rounded-br-none self-end flex items-center px-3 text-xs text-olive-bright opacity-80 group-hover:opacity-100 transition-opacity">import os...</div>
                </div>
                <h3 className="text-2xl font-bold mb-2">Large Language Models</h3>
                <p className="text-muted-foreground flex-1">Chat natively with GGUF format LLMs powered by the embedded llama.cpp runtime. Fully uncensored, offline intelligence in your pocket.</p>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="border-t border-border/50 bg-panel/30 py-24">
          <div className="mx-auto max-w-4xl px-6">
            <h2 className="text-3xl font-bold tracking-tight text-center mb-12">Frequently Asked Questions</h2>
            <div className="space-y-4">
              <details className="group rounded-lg border border-border bg-background p-6 [&_summary::-webkit-details-marker]:hidden cursor-pointer hover:border-olive/50 transition-colors">
                <summary className="flex items-center justify-between font-semibold text-lg">
                  Do I need an active internet connection to use the models?
                  <ChevronDown className="h-5 w-5 transition-transform group-open:-rotate-180 text-muted-foreground" />
                </summary>
                <p className="mt-4 text-muted-foreground leading-relaxed">
                  No. Internet is only required to download the model initially via the LokiAI dashboard. Once the model is transferred to your phone, inference runs entirely offline without any network requests.
                </p>
              </details>
              <details className="group rounded-lg border border-border bg-background p-6 [&_summary::-webkit-details-marker]:hidden cursor-pointer hover:border-olive/50 transition-colors">
                <summary className="flex items-center justify-between font-semibold text-lg">
                  What kind of hardware do I need on my phone?
                  <ChevronDown className="h-5 w-5 transition-transform group-open:-rotate-180 text-muted-foreground" />
                </summary>
                <p className="mt-4 text-muted-foreground leading-relaxed">
                  LokiAI checks your device's RAM before deployment. We recommend at least 6GB of RAM for lightweight LLMs (GGUF), and 4GB of RAM for standard vision/audio models (TFLite).
                </p>
              </details>
              <details className="group rounded-lg border border-border bg-background p-6 [&_summary::-webkit-details-marker]:hidden cursor-pointer hover:border-olive/50 transition-colors">
                <summary className="flex items-center justify-between font-semibold text-lg">
                  How does the AI assistant work?
                  <ChevronDown className="h-5 w-5 transition-transform group-open:-rotate-180 text-muted-foreground" />
                </summary>
                <p className="mt-4 text-muted-foreground leading-relaxed">
                  Our dashboard uses a free NVIDIA NIM API key to provide an intelligent assistant. You simply tell the assistant what you want to do (e.g., "detect fire"), and it dynamically queries HuggingFace, filters out incompatible models based on your specific phone's specs, and gives you a 1-click deploy button.
                </p>
              </details>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-32 relative overflow-hidden">
          <div className="absolute inset-0 bg-olive-bright/10" />
          <div className="absolute top-1/2 left-1/2 -z-10 h-full w-[200%] -translate-x-1/2 -translate-y-1/2 bg-[linear-gradient(to_right,#8ab55a22_1px,transparent_1px),linear-gradient(to_bottom,#8ab55a22_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]" />
          
          <div className="mx-auto max-w-4xl px-6 text-center relative z-10">
            <h2 className="text-4xl font-bold tracking-tight sm:text-6xl text-foreground mb-6">
              Ready to edge deploy?
            </h2>
            <p className="text-xl text-muted-foreground mb-10">
              Join the platform that is bringing true decentralized AI to thousands of edge devices.
            </p>
            <Link
              to="/login"
              className="inline-flex h-14 items-center justify-center gap-2 rounded-lg bg-olive px-10 text-lg font-bold text-background transition-all hover:bg-olive-bright shadow-[0_0_30px_0_var(--olive-glow)] hover:scale-105"
            >
              Get Started for Free <ArrowRight className="h-5 w-5" />
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-panel pt-16 pb-8">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
            <div className="col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <img src="/lokiai-logo.png" alt="LokiAI" className="h-6 opacity-80 grayscale" />
              </div>
              <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                The zero-USB, zero-ADB, WiFi-only AI deployment system for Android phones. Built by The Shriks.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4 text-foreground">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-olive-bright transition-colors">Features</a></li>
                <li><a href="#how-it-works" className="hover:text-olive-bright transition-colors">How it Works</a></li>
                <li><a href="#capabilities" className="hover:text-olive-bright transition-colors">Capabilities</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4 text-foreground">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-olive-bright transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-olive-bright transition-colors">Terms of Service</a></li>
                <li><a href="#" className="hover:text-olive-bright transition-colors">Contact</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border/50 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} LokiAI. All rights reserved.
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-background px-3 py-1.5 rounded-full border border-border">
              <Cpu className="h-3 w-3" /> Powered by NVIDIA NIM
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
