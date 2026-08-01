import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Section,
  SectionHeader,
  Panel,
  StatusPill,
  CTABlock,
  Eyebrow,
  Mono,
} from "@/components/loki/primitives";
import {
  TopologyVisual,
  ExecutionPath,
  PlatformLayers,
  RoadmapPipeline,
  BulletList,
} from "@/components/loki/diagrams";
import { Reveal } from "@/components/loki/Reveal";
import { WORKSPACE_URL } from "@/lib/workspace";

const TITLE = "LokiAI - Edge AI made ridiculously simple!";
const DESC =
  "LokiAI discovers, validates and deploys AI models to real hardware — from phones to edge devices — without requiring users to understand model formats, runtimes or embedded systems.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
    ],
  }),
  component: Home,
});

const STEPS = [
  {
    label: "Ask",
    detail: "Describe the outcome in plain language: “detect people on this camera, offline.”",
    note: "No model names required",
  },
  {
    label: "Profile",
    detail: "The paired agent reports SoC, accelerators, memory headroom, OS and runtime support.",
    note: "Device-reported, not guessed",
  },
  {
    label: "Verify",
    detail: "Candidate artifacts are resolved to an exact file, format, size and download URL.",
    note: "Evidence recorded",
  },
  {
    label: "Deploy",
    detail: "The device pulls the artifact directly over HTTPS with a device-scoped credential.",
    note: "No cable, no ADB",
  },
  {
    label: "Run locally",
    detail: "Inference executes on the device. The control plane tracks state, not your data.",
    note: "Works offline",
  },
];

const AGENTS = [
  {
    name: "Android Agent",
    status: "available" as const,
    detail: "QR pairing, GGUF and TFLite runtimes, live deployment progress.",
  },
  {
    name: "Linux ARM Agent",
    status: "beta" as const,
    detail: "Headless daemon for ARM64 boards and gateways.",
  },
  {
    name: "Raspberry Pi Agent",
    status: "beta" as const,
    detail: "Pi 4 / Pi 5 profiles with quantised CPU runtimes.",
  },
  {
    name: "NVIDIA Jetson Agent",
    status: "planned" as const,
    detail: "CUDA and TensorRT runtime adapters under design.",
  },
  {
    name: "Camera / Gateway Agent",
    status: "planned" as const,
    detail: "Stream-attached inference for fixed installations.",
  },
  {
    name: "OEM & MCU Agents",
    status: "planned" as const,
    detail: "Embedded targets via partner integrations.",
  },
];

const VERIFY_ROWS = [
  { field: "Repository", value: "hf.co/<org>/<model>", verdict: "Resolved" },
  { field: "Exact file", value: "model-q4_k_m.gguf", verdict: "Pinned" },
  { field: "Format", value: "GGUF v3", verdict: "Supported" },
  { field: "Size", value: "1.94 GB", verdict: "Fits headroom" },
  { field: "Runtime", value: "llama.cpp adapter", verdict: "Available on agent" },
  { field: "Hardware fit", value: "arm64 · 8 GB RAM · 4 perf cores", verdict: "Compatible" },
  { field: "Download URL", value: "CDN direct, signed at request time", verdict: "Reachable" },
  { field: "Evidence", value: "Checks stored with the deployment record", verdict: "Recorded" },
];

const APPLICATIONS = [
  ["Offline assistants", "On-device chat and summarisation where connectivity is unreliable."],
  ["Object detection", "Counting, presence and zone logic on existing camera hardware."],
  ["Face detection", "Local detection for access flows, without uploading frames."],
  ["Audio classification", "Alarm, speech and machine-sound events on low-power boards."],
  ["Industrial inspection", "Defect spotting close to the line, with no cloud round trip."],
  ["Smart cameras", "Turning already-installed cameras into inference endpoints."],
  ["Anomaly detection", "Baseline drift alerts on sensor and vibration streams."],
  ["Robotics", "Perception loops that must keep running when the network drops."],
  ["Edge automation", "Local triggers and actions derived from on-device model output."],
];

const ROADMAP = [
  {
    title: "Available now",
    status: "available" as const,
    items: [
      "Android device agent with QR pairing",
      "Hugging Face model discovery and artifact verification",
      "GGUF and TFLite deployment with live progress",
      "Per-account tenant isolation and device-scoped credentials",
    ],
  },
  {
    title: "Beta",
    status: "beta" as const,
    items: [
      "Linux ARM and Raspberry Pi agents",
      "NIM-assisted model discovery and ranking",
      "Fleet views across multiple paired devices",
    ],
  },
  {
    title: "Next",
    status: "planned" as const,
    items: [
      "Jetson runtime adapters (CUDA / TensorRT)",
      "Camera and gateway agents",
      "Public API and SDK for programmatic deployment",
    ],
  },
  {
    title: "Long-term",
    status: "planned" as const,
    items: [
      "OEM and MCU device agents",
      "Signed artifact supply-chain attestation",
      "Partner-certified hardware profiles",
    ],
  },
];

function Home() {
  return (
    <>
      {/* HERO */}
      <section className="relative flex min-h-[100svh] flex-col justify-center overflow-hidden border-b border-border">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover opacity-60 z-0"
        >
          <source src="/timeline.mov" />
        </video>
        <div
          className="pointer-events-none absolute inset-0 loki-grid opacity-40 z-0"
          aria-hidden="true"
        />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-8 pt-12 pb-24 md:px-12 lg:px-20 lg:pt-16 lg:pb-32 lg:grid-cols-[1.05fr_1fr] lg:items-center z-10">
          <div className="min-w-0">
            <Eyebrow index="00">AI deployment for real hardware</Eyebrow>
            <h1 className="mt-4 font-serif text-5xl leading-[1.02] text-foreground sm:text-6xl lg:text-7xl">
              Give hardware the right
              <br />
              <span className="text-gold">local intelligence</span>.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
              LokiAI discovers, validates, and deploys AI models to real hardware, then tracks what
              runs, where it runs, and why it fits.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a
                href={WORKSPACE_URL}
                className="inline-flex min-h-[48px] items-center rounded-sm bg-gold px-6 font-mono text-xs uppercase tracking-[0.2em] text-primary-foreground transition-opacity hover:opacity-85"
              >
                Open Workspace
              </a>
              <a
                href="https://www.instagram.com/reel/DZuxLsINqJl/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[48px] items-center rounded-sm border border-border px-6 font-mono text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:border-gold hover:text-gold"
              >
                Watch Trailer
              </a>
            </div>

          </div>

          <Reveal className="min-w-0 w-full">
            <div className="w-full overflow-hidden rounded-sm border border-border bg-plane/70 p-5 shadow-[var(--shadow-chamber)] sm:p-7">
              <div className="mb-5 flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  Routing view
                </span>
                <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-live">
                  <span className="h-1.5 w-1.5 rounded-full bg-live [animation:loki-pulse_2s_ease-in-out_infinite]" />
                  1 agent online
                </span>
              </div>
              <TopologyVisual />
            </div>
          </Reveal>
        </div>
      </section>

      {/* 1. PRODUCT JOURNEY */}
      <Section id="journey">
        <SectionHeader
          index="01"
          eyebrow="Intent to execution"
          title="From objective to registered outcome"
          lede="Every deployment moves through the same sequence. Nothing is skipped, and each stage leaves a record you can inspect afterwards."
        />
        <div className="mt-12">
          <Reveal>
            <ExecutionPath />
          </Reveal>
        </div>
      </Section>

      {/* 2. PLATFORM LAYERS */}
      <Section id="platform-layers">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.3fr] lg:items-center">
          <SectionHeader
            index="02"
            eyebrow="Platform architecture"
            title="We track state, not just files"
            lede="LokiAI is deciding what model, which artifact, which runtime, whether it fits, how to deploy, and how to observe it."
          />
          <Reveal>
            <PlatformLayers />
          </Reveal>
        </div>
      </Section>

      {/* 3. CURRENT PRODUCT PROOF */}
      <Section id="proof">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_1fr] lg:items-start">
          <SectionHeader
            index="03"
            eyebrow="Current Product Proof"
            title="Real product evidence on Android"
            lede="We start where it's hard. Our Android agent proves out QR pairing, authenticated WSS, device credentials, direct HF CDN downloads (GGUF/TFLite), and isolated tenant local inference."
          />
          <div className="rounded-sm border border-border bg-plane p-6 font-mono text-[11px] uppercase tracking-widest text-muted-foreground flex flex-col gap-3">
            <span className="text-live">✔ AUTHENTICATED WSS</span>
            <span className="text-live">✔ EXACT MODEL FILES PINNED</span>
            <span className="text-live">✔ DEVICE-SCOPED CREDS</span>
            <span className="text-live">✔ TYPED PROVIDER ERRORS</span>
            <span className="text-live">✔ LIVE PROGRESS REPORTING</span>
          </div>
        </div>
      </Section>

      {/* 4. WIRELESS DEPLOYMENT */}
      <Section id="deployment">
        <div className="grid gap-12 lg:grid-cols-2">
          <SectionHeader
            index="04"
            eyebrow="Wireless deployment"
            title="Pair with a QR code. Deploy over the network."
            lede="The device authenticates itself, receives a scoped credential and pulls the artifact directly from the CDN. The control plane never proxies the weights."
          />
          <div className="space-y-8">
            <Reveal>
              <ol className="grid gap-px overflow-hidden rounded-sm border border-border bg-border">
                {[
                  ["QR pairing", "The agent scans a short-lived pairing code."],
                  ["HTTPS / WSS", "Transport is encrypted and authenticated in both directions."],
                  ["Device credential", "Scoped to one device, revocable, never shared."],
                  ["Direct CDN download", "The artifact goes straight to the device."],
                  ["Local inference", "Execution stays on the hardware."],
                ].map(([t, d], i) => (
                  <li key={t} className="flex gap-4 bg-plane/40 backdrop-blur-md px-6 py-5">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3 className="font-mono text-sm uppercase tracking-[0.16em] text-gold">
                        {t}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">{d}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Reveal>
            <ul className="flex flex-wrap gap-2">
              {["No USB", "No ADB", "No developer mode", "No cable deployment"].map((n) => (
                <li
                  key={n}
                  className="rounded-full border border-border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
                >
                  {n}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* 5. LOCAL-FIRST */}
      <Section id="local-first">
        <SectionHeader
          index="05"
          eyebrow="Local-first execution"
          title="The model runs where the data already is"
          lede="Running locally is not automatically faster for every workload. It is predictable, private and yours — and for many edge tasks that matters more than raw throughput."
        />
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            [
              "Privacy",
              "Inputs stay on the device. Frames, audio and prompts are not shipped to a third party by default.",
            ],
            [
              "Offline operation",
              "Once the artifact is on the device, deployment state and inference survive a dropped link.",
            ],
            [
              "Lower recurring cost",
              "You pay for hardware you own instead of per-token or per-frame API billing.",
            ],
            [
              "Resilience",
              "A control-plane outage does not stop a device that is already running.",
            ],
            [
              "Latency, where it applies",
              "No network hop for small models on capable hardware. Large models on weak hardware will still be slow.",
            ],
            [
              "Ownership",
              "The device, the artifact and the runtime are yours, and the record of what was deployed is exportable.",
            ],
          ].map(([t, d], i) => (
            <Reveal key={t} delay={i * 60}>
              <Panel className="h-full">
                <h3 className="font-serif text-2xl text-gold">{t}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{d}</p>
              </Panel>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 6. APPLICATIONS */}
      <Section id="applications">
        <SectionHeader
          index="06"
          eyebrow="Applications"
          title="What people put on the hardware"
          lede="These are the workload classes the current runtimes support. Availability depends on the device profile, not on the use case alone."
        />
        <ul className="mt-12 grid gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {APPLICATIONS.map(([t, d]) => (
            <li key={t} className="bg-plane p-6">
              <h3 className="font-mono text-sm uppercase tracking-[0.16em] text-gold">{t}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{d}</p>
            </li>
          ))}
        </ul>
        <Link
          to="/applications"
          className="mt-8 inline-flex font-mono text-xs uppercase tracking-[0.2em] text-gold underline-offset-4 hover:underline"
        >
          See applications by industry →
        </Link>
      </Section>

      {/* 7. SECURITY */}
      <Section id="security">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr]">
          <SectionHeader
            index="07"
            eyebrow="Security and trust"
            title="Controls that are enforced, not advertised"
            lede="LokiAI holds credentials for provider accounts and issues credentials to devices. Both are treated as sensitive by default."
          />
          <BulletList
            items={[
              "Tenant isolation — accounts cannot read each other's devices, models or deployment records.",
              "Encrypted provider keys — stored encrypted at rest and never returned to the browser in raw form.",
              "Device-scoped credentials — one credential per device, revocable independently.",
              "Authenticated WebSockets — every socket is bound to an authenticated session and a paired device.",
              "Strict CORS — the API accepts browser origins from an explicit allowlist.",
              <>
                Verified model artifacts — deployments reference a pinned file, not a floating tag.
                See <Mono>/security</Mono>.
              </>,
              "Rate limits — discovery, pairing and deployment endpoints are throttled per account.",
              "Local inference — inference inputs are not routed through LokiAI infrastructure.",
            ]}
          />
        </div>
        <Link
          to="/security"
          className="mt-10 inline-flex font-mono text-xs uppercase tracking-[0.2em] text-gold underline-offset-4 hover:underline"
        >
          Read the security overview →
        </Link>
      </Section>

      {/* 8. DEVELOPERS */}
      <Section id="developers">
        <SectionHeader
          index="08"
          eyebrow="Developers"
          title="The parts you can build against"
          lede="LokiAI is a control plane plus device agents. If you are integrating a new device class or automating deployments, these are the surfaces that matter."
        />
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[
            [
              "Architecture",
              "Control plane, agent protocol, artifact resolver, deployment engine.",
            ],
            ["APIs", "Account, device, model and deployment resources. Public API in development."],
            ["Model formats", "GGUF and TFLite today; ONNX and TensorRT under evaluation."],
            ["Runtime adapters", "A thin interface per runtime: load, warm, infer, release."],
            [
              "Deployment events",
              "State transitions streamed as they happen, with failure reasons.",
            ],
            ["WebSocket protocol", "Authenticated, device-scoped, resumable after reconnect."],
          ].map(([t, d]) => (
            <Panel key={t} className="h-full">
              <h3 className="font-serif text-2xl text-gold">{t}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{d}</p>
            </Panel>
          ))}
        </div>
        <Link
          to="/developers"
          className="mt-8 inline-flex font-mono text-xs uppercase tracking-[0.2em] text-gold underline-offset-4 hover:underline"
        >
          Developer overview →
        </Link>
      </Section>

      {/* 9. ROADMAP */}
      <Section id="roadmap">
        <SectionHeader
          index="09"
          eyebrow="Roadmap"
          title="Hardware trajectory"
          lede="Android is the current agent proof. The wider objective spans IoT, edge compute, and industrial routing. We separate these deliberately."
        />
        <div className="mt-12">
          <Reveal>
            <RoadmapPipeline />
          </Reveal>
        </div>
      </Section>

      <CTABlock
        title={
          <>
            The hardware already exists.
            <br />
            LokiAI gives it intelligence.
          </>
        }
        body="Pair a device, verify a model, deploy it wirelessly, and keep the inference local."
      />
    </>
  );
}
