import type { ReactNode } from "react";
import { StatusPill, type Availability } from "./primitives";
import { Link } from "@tanstack/react-router";

/**
 * A continuous execution path visual replacing the static step cards.
 * It visualizes: Ask → Profile → Verify → Route → Run → Register
 */
export function ExecutionPath() {
  const nodes = [
    { label: "Intent", desc: "Target capability", x: 50, y: 50 },
    { label: "Runtime Profile", desc: "Agent inspection", x: 180, y: 150 },
    { label: "Model Evidence", desc: "Artifact resolution", x: 310, y: 50 },
    { label: "Compatibility Decision", desc: "Resource match", x: 440, y: 150 },
    { label: "Deployment Route", desc: "CDN to device", x: 570, y: 50 },
    { label: "Local Execution", desc: "Offline inference", x: 700, y: 150 },
    { label: "Registered Outcome", desc: "State tracking", x: 830, y: 50 },
  ];

  return (
    <div className="relative w-full overflow-x-auto rounded-sm border border-border bg-plane/40 backdrop-blur-md pb-12 pt-8">
      <div className="min-w-[900px] px-8">
        <svg viewBox="0 0 900 200" className="w-full" aria-hidden="true">
          <defs>
            <linearGradient id="path-gradient" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="var(--gold)" stopOpacity="0.2" />
              <stop offset="0.5" stopColor="var(--live)" stopOpacity="0.8" />
              <stop offset="1" stopColor="var(--gold)" stopOpacity="0.2" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <path
            d="M 50 50 C 100 50, 130 150, 180 150 C 230 150, 260 50, 310 50 C 360 50, 390 150, 440 150 C 490 150, 520 50, 570 50 C 620 50, 650 150, 700 150 C 750 150, 780 50, 830 50"
            fill="none"
            stroke="var(--border)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          <path
            d="M 50 50 C 100 50, 130 150, 180 150 C 230 150, 260 50, 310 50 C 360 50, 390 150, 440 150 C 490 150, 520 50, 570 50"
            fill="none"
            stroke="url(#path-gradient)"
            strokeWidth="2"
            filter="url(#glow)"
            className="[stroke-dasharray:1000] [stroke-dashoffset:1000] [animation:loki-trace_4s_linear_infinite]"
          />
          {nodes.map((node, i) => (
            <g key={i}>
              <circle
                cx={node.x}
                cy={node.y}
                r="5"
                fill="var(--background)"
                stroke="var(--gold)"
                strokeWidth="2"
              />
              <text
                x={node.x}
                y={node.y - 15}
                fill="var(--foreground)"
                fontFamily="var(--font-mono)"
                fontSize="11"
                textAnchor="middle"
              >
                {node.label}
              </text>
              <text
                x={node.x}
                y={node.y + 20}
                fill="var(--muted-foreground)"
                fontFamily="var(--font-sans)"
                fontSize="10"
                textAnchor="middle"
              >
                {node.desc}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

/**
 * A deep horizontal routing diagram replacing the card-based roadmap.
 * Displays Current (Android) -> Next -> Later along an expanding pipeline.
 */
export function RoadmapPipeline() {
  const stages = [
    {
      time: "Available Now",
      status: "live",
      items: ["Android device agent", "Verified discovery", "WSS telemetry"],
    },
    {
      time: "Beta",
      status: "beta",
      items: ["Linux ARM daemon", "Raspberry Pi target", "NIM-assisted ranking"],
    },
    {
      time: "Next",
      status: "planned",
      items: ["IoT support", "Broader Edge AI support", "Additional runtimes"],
    },
    {
      time: "Later",
      status: "planned",
      items: ["Partner integrations", "Expanded runtimes", "Platform operations"],
    },
  ];

  return (
    <div className="relative rounded-sm border border-border bg-plane/40 backdrop-blur-md px-4 py-8 sm:px-10 sm:py-16">
      <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-gradient-to-r from-border via-gold to-border opacity-30" />
      <div className="relative grid grid-cols-1 gap-12 md:grid-cols-4 md:gap-6">
        {stages.map((stage, i) => (
          <div
            key={i}
            className="relative z-10 flex flex-col items-start bg-plane/90 p-4 shadow-sm backdrop-blur-sm border border-border rounded-sm"
          >
            <span
              className={`mb-4 inline-block h-2 w-2 rounded-full ${
                stage.status === "live"
                  ? "bg-live shadow-[0_0_8px_var(--live)]"
                  : stage.status === "beta"
                    ? "bg-gold"
                    : "bg-muted-foreground"
              }`}
            />
            <h4 className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground">
              {stage.time}
            </h4>
            <ul className="mt-4 space-y-2">
              {stage.items.map((item) => (
                <li key={item} className="text-sm text-muted-foreground flex gap-2">
                  <span className="text-gold-dim">›</span> {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Hero visual for the LokiAI control plane. */
export function TopologyVisual() {
  return (
    <svg
      viewBox="0 0 620 220"
      className="w-full h-auto"
      role="img"
      aria-label="LokiAI control plane connecting to Edge AI and IoT endpoints."
    >
      <defs>
        <linearGradient id="loki-beam" x1="0" x2="1">
          <stop offset="0" stopColor="var(--gold)" stopOpacity="0.1" />
          <stop offset="1" stopColor="var(--live)" stopOpacity="0.8" />
        </linearGradient>
      </defs>
      <g stroke="var(--grid-line)" strokeWidth="1">
        {Array.from({ length: 5 }).map((_, i) => (
          <line key={i} x1="0" x2="620" y1={i * 45} y2={i * 45} />
        ))}
      </g>

      {/* Control Plane Node */}
      <rect
        x="20"
        y="60"
        width="160"
        height="100"
        rx="2"
        fill="var(--background)"
        stroke="var(--gold)"
        strokeOpacity="0.5"
      />
      <text
        x="36"
        y="90"
        fill="var(--foreground)"
        fontFamily="var(--font-mono)"
        fontSize="11"
        letterSpacing="0.1em"
      >
        CONTROL PLANE
      </text>
      <line x1="20" y1="100" x2="180" y2="100" stroke="var(--border)" />
      <text
        x="36"
        y="125"
        fill="var(--muted-foreground)"
        fontFamily="var(--font-mono)"
        fontSize="10"
      >
        WSS Auth Validated
      </text>
      <text x="36" y="145" fill="var(--live)" fontFamily="var(--font-mono)" fontSize="10">
        Target OK
      </text>

      {/* Connector lines to edge devices */}
      <path
        d="M 180 110 L 260 110 L 290 50 L 350 50"
        fill="none"
        stroke="url(#loki-beam)"
        strokeWidth="2"
        className="[stroke-dasharray:400] [stroke-dashoffset:400] [animation:loki-trace_3s_linear_infinite]"
      />
      <path
        d="M 180 110 L 260 110 L 290 170 L 350 170"
        fill="none"
        stroke="var(--border)"
        strokeWidth="1"
        strokeDasharray="3 3"
      />

      {/* Device Node 1 (Active) */}
      <rect
        x="350"
        y="30"
        width="160"
        height="50"
        rx="2"
        fill="var(--plane-40)"
        style={{ backdropFilter: "blur(12px)" }}
        stroke="var(--live)"
        strokeWidth="1"
      />
      <circle
        cx="365"
        cy="55"
        r="4"
        fill="var(--live)"
        className="[animation:loki-pulse_2s_ease-in-out_infinite]"
      />
      <text x="380" y="59" fill="var(--foreground)" fontFamily="var(--font-mono)" fontSize="11">
        ANDROID PHONE
      </text>

      {/* Device Node 2 (Planned) */}
      <rect
        x="350"
        y="150"
        width="160"
        height="50"
        rx="2"
        fill="var(--plane-40)"
        style={{ backdropFilter: "blur(12px)" }}
        stroke="var(--border)"
        strokeWidth="1"
      />
      <circle cx="365" cy="175" r="4" fill="var(--muted-foreground)" />
      <text
        x="380"
        y="179"
        fill="var(--muted-foreground)"
        fontFamily="var(--font-mono)"
        fontSize="11"
      >
        IOT EDGE
      </text>
    </svg>
  );
}

/** System Architecture layers replacing static cards. */
export function PlatformLayers() {
  const layers = [
    { name: "Intent Layer", desc: "Translates human objective to capability." },
    { name: "Evidence Layer", desc: "Resolves abstract models to hashed CDN artifacts." },
    {
      name: "Compatibility Layer",
      desc: "Matches runtime requirements and available resources.",
    },
    { name: "Deployment Layer", desc: "Direct CDN retrieval with device-scoped credentials." },
    { name: "Execution Layer", desc: "Runs local inference offline." },
    { name: "State Layer", desc: "Tracks what runs, where it runs, and why it fits." },
  ];

  return (
    <div className="flex flex-col gap-2">
      {layers.map((layer, index) => (
        <div
          key={layer.name}
          className="group relative flex items-center gap-6 overflow-hidden rounded-sm border border-border bg-plane/40 backdrop-blur-md px-6 py-4 transition-colors hover:border-gold"
        >
          <div className="absolute inset-0 bg-gold opacity-0 transition-opacity group-hover:opacity-5" />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground w-6">
            L{index + 1}
          </span>
          <span className="font-mono text-sm uppercase tracking-[0.1em] text-gold w-48 shrink-0">
            {layer.name}
          </span>
          <span className="text-sm text-muted-foreground">{layer.desc}</span>
        </div>
      ))}
    </div>
  );
}

/** Security Boundary diagram */
export function SecurityBoundaryMap() {
  return (
    <div className="rounded-sm border border-border bg-plane/40 backdrop-blur-md p-8">
      <div className="grid gap-6 md:grid-cols-[1fr_auto_1fr] items-center">
        <div className="space-y-4">
          <h4 className="font-mono text-[11px] uppercase tracking-[0.2em] text-gold">
            Control Plane
          </h4>
          <ul className="text-sm text-muted-foreground space-y-2 font-mono">
            <li>[Encrypted Provider Keys]</li>
            <li>[Tenant Isolation]</li>
            <li>[Rate Limits]</li>
          </ul>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-border">← HTTPS / WSS →</span>
          <span className="font-mono text-[10px] text-live tracking-widest mt-1">STRICT CORS</span>
        </div>
        <div className="space-y-4">
          <h4 className="font-mono text-[11px] uppercase tracking-[0.2em] text-gold">
            Edge Device
          </h4>
          <ul className="text-sm text-muted-foreground space-y-2 font-mono">
            <li>[Device-Scoped Creds]</li>
            <li>[Local Execution]</li>
            <li>[Offline Inference]</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export function BulletList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-base text-muted-foreground">
          <span aria-hidden="true" className="mt-2 h-1 w-3 shrink-0 bg-gold-dim" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Verification checklist rendered as an instrument readout. */
export function VerificationReadout({
  rows,
}: {
  rows: { field: string; value: string; verdict: string }[];
}) {
  return (
    <div className="overflow-x-auto rounded-sm border border-border bg-plane/40 backdrop-blur-md">
      <table className="w-full min-w-[36rem] border-collapse text-left">
        <caption className="border-b border-border px-6 py-4 text-left font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Model verification record — example artifact
        </caption>
        <thead>
          <tr className="border-b border-border">
            {["Check", "Resolved value", "Verdict"].map((h) => (
              <th
                key={h}
                scope="col"
                className="px-6 py-3 font-mono text-[11px] uppercase tracking-[0.2em] text-gold-dim"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.field} className="border-b border-border/50 last:border-b-0">
              <th scope="row" className="px-6 py-3 text-sm font-normal text-foreground">
                {r.field}
              </th>
              <td className="px-6 py-3 font-mono text-[13px] text-muted-foreground">{r.value}</td>
              <td className="px-6 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-live">
                {r.verdict}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Control-plane → agents tree, drawn with rules rather than an image. */
export function AgentTree({
  agents,
}: {
  agents: { name: string; status: Availability; detail: string }[];
}) {
  return (
    <div className="rounded-sm border border-border bg-plane/40 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-5">
        <span className="font-serif text-2xl text-gold">LokiAI Control Plane</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-live">
          Discovery · Verification · Deployment · Telemetry
        </span>
      </div>
      <ul>
        {agents.map((a, i) => (
          <li
            key={a.name}
            className="grid grid-cols-[2rem_1fr] items-start gap-x-4 border-b border-border/60 px-6 py-5 last:border-b-0 sm:grid-cols-[2rem_14rem_1fr_auto] sm:items-center"
          >
            <span
              aria-hidden="true"
              className="font-mono text-sm text-border-foreground text-muted-foreground"
            >
              {i === agents.length - 1 ? "└─" : "├─"}
            </span>
            <span className="font-mono text-sm text-foreground">{a.name}</span>
            <span className="col-span-2 mt-2 text-sm text-muted-foreground sm:col-span-1 sm:mt-0">
              {a.detail}
            </span>
            <span className="col-start-2 mt-3 sm:col-start-auto sm:mt-0">
              <StatusPill status={a.status} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
