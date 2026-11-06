import { createFileRoute, Link } from "@tanstack/react-router";
import { CTABlock, Mono, PageHero, Section, SectionHeader, StatusPill } from "@/components/loki/primitives";
import { Float, PixelScene, Seam } from "@/components/loki/pixel";
import { REPO_BLOB, REPO_TREE } from "@/lib/links";
import { WORKSPACE_URL } from "@/lib/workspace";

const TITLE = "Docs: the LokiAI v1.2 documentation map | LokiAI";
const DESC =
  "A guide to the LokiAI v1.2 specifications in the repository, in reading order, plus the current build status and a reference section for the earlier hosted product.";

const PAGE_URL = "https://lokiai.theshriks.space/docs";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: PAGE_URL },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
    ],
    links: [{ rel: "canonical", href: PAGE_URL }],
  }),
  component: Docs,
});

const ANCHORS = [
  ["#map", "Documentation map"],
  ["#status", "Status"],
  ["#v1-1", "Earlier product (v1.1)"],
];

type Doc = { file: string; kind: "blob" | "tree"; purpose: string };

const DOCS: Doc[] = [
  { file: "CONTEXT.md", kind: "blob", purpose: "Current facts, decisions, constraints and open questions. Start here." },
  { file: "PRD.md", kind: "blob", purpose: "Who the product is for, what it must do, and how success is measured." },
  { file: "SPEC.md", kind: "blob", purpose: "Exact behaviour: state machines, entities, events and acceptance rules." },
  { file: "ARCHITECTURE.md", kind: "blob", purpose: "The processes, trust boundaries, data flow and the target repository layout." },
  { file: "TECH_STACK.md", kind: "blob", purpose: "The chosen platforms, versions, packaging and dependency rules." },
  { file: "SECURITY.md", kind: "blob", purpose: "Threats, permissions, approvals, secrets, artifacts and Electron controls." },
  { file: "CLOUD_CONTRACT.md", kind: "blob", purpose: "What the website and control plane must provide: APIs, sync, enrollment and notifications." },
  { file: "BUILD_EXECUTION.md", kind: "blob", purpose: "How firmware builds are isolated, contained and traced back to their inputs." },
  { file: "UI_SPEC.md", kind: "blob", purpose: "Desktop navigation, interaction, visual tokens, states and accessibility." },
  { file: "MCP_SPEC.md", kind: "blob", purpose: "What agents can read and call through the MCP server, and the result contracts." },
  { file: "CONNECTOR_SPEC.md", kind: "blob", purpose: "The device-neutral connector contract and the ESP32-S3 certification rules." },
  { file: "TESTING.md", kind: "blob", purpose: "The verification layers and the evidence each one must produce." },
  { file: "RELEASE.md", kind: "blob", purpose: "Packaging, signing, rollout, rollback and the human release gate." },
  { file: "graph/", kind: "tree", purpose: "The task graph, planner, integration rules, traceability, prompts, templates and evidence folders used to run the work." },
];

const BUILT = [
  "The accepted visual and interaction baseline: a React and Vite renderer in the LokiAI Desktop UI folder.",
  "The specification set listed above.",
  "A Cargo workspace with 20 crates and a pnpm workspace with the contracts, IPC client and credential store packages, the MCP server service and the Electron folders.",
];

const TO_BUILD = [
  "Production Electron main and preload processes, and trusted IPC.",
  "The Rust runtime, durable encrypted storage and the isolated build executor.",
  "The cloud contracts, the working MCP server and a verified ESP32-S3 connector.",
  "Signed packaging and release evidence.",
];

const V11_FLOW = [
  ["Ask", "You describe the outcome you want."],
  ["Profile", "The paired agent reports the device: SoC, accelerators, memory headroom, OS and runtime support."],
  ["Verify", "Candidate artifacts are resolved to an exact file, format, size and download URL, then checked against the device."],
  ["Deploy", "The device pulls the artifact directly over HTTPS with a device-scoped credential."],
  ["Run locally", "Inference runs on the device. The control plane tracks state, not your data."],
];

const V11_AGENTS: [string, "available" | "beta" | "planned", string][] = [
  ["Android Agent", "available", "QR pairing, GGUF and TFLite runtimes, live deployment progress."],
  ["Linux ARM Agent", "beta", "Linux on ARM devices."],
  ["Raspberry Pi Agent", "beta", "Pi 4 and Pi 5 profiles with quantised CPU runtimes."],
  ["Edge AI agent", "planned", "Not built yet."],
  ["IoT agent", "planned", "Not built yet."],
  ["Partner agents", "planned", "Not built yet."],
];

const V11_NOW: [string, "available" | "beta", string][] = [
  ["Hugging Face model discovery and artifact verification", "available", ""],
  ["GGUF and TFLite deployment with live progress", "available", ""],
  ["Per-account tenant isolation and device-scoped credentials", "available", ""],
  ["NIM-assisted model discovery and ranking", "beta", ""],
  ["Fleet views across paired devices", "beta", ""],
];

const V11_TOPICS = [
  "Getting started",
  "Architecture",
  "Device pairing",
  "Model compatibility",
  "Deployments",
  "Security",
  "API reference (in development)",
  "Troubleshooting",
  "Changelog",
];

function Docs() {
  return (
    <>
      <PageHero
        eyebrow="Docs"
        title="The LokiAI documentation"
        lede="LokiAI v1.2 is specified in the repository before it is built. This page is a map of those documents, an honest status, and a reference section for the earlier hosted product."
        meta={["Specs in the repo", "Read in order", "In development"]}
        scene="board"
        sceneLabel="Pixel illustration of an ESP32-S3 development board with a USB cable, header pins and blinking LEDs"
        note={
          <>
            (01) Documents define
            <br />
            the code, not the
            <br />
            other way round.
          </>
        }
      />

      <nav aria-label="On this page" className="mx-auto max-w-7xl px-8 pb-10 md:px-12 lg:px-20">
        <ul className="flex flex-wrap gap-x-8 gap-y-3 border-t border-border pt-5">
          {ANCHORS.map(([href, label]) => (
            <li key={href}>
              <a
                href={href}
                className="font-mono text-xs uppercase tracking-[0.2em] text-gold underline underline-offset-4"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Seam from="black" to="green" salt={21} />

      {/* MAP */}
      <Section id="map" tone="field">
        <Float className="right-[4%] top-[5%]">
          (02) Read top to
          <br />
          bottom, in order.
        </Float>
        <SectionHeader
          index="01"
          eyebrow="Documentation map"
          title="LokiAI v1.2 documentation map"
          lede="These are the real documents in the Docs folder, in the order the repository recommends reading them. Each link opens the file on GitHub."
        />
        <ol className="mt-12 grid gap-x-12 lg:grid-cols-2">
          {DOCS.map((d, i) => {
            const href = d.kind === "tree" ? `${REPO_TREE}Docs/${d.file}` : `${REPO_BLOB}Docs/${d.file}`;
            return (
              <li key={d.file} className="grid grid-cols-[3rem_1fr] gap-4 border-t border-border py-5">
                <span className="px text-xl">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="break-words font-serif text-xl text-foreground underline underline-offset-4"
                  >
                    {d.file}
                  </a>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d.purpose}</p>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-10 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          The folder also holds{" "}
          <a href={`${REPO_BLOB}Docs/README.md`} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            README.md
          </a>
          , the index with the full read order, and{" "}
          <a href={`${REPO_BLOB}Docs/RESEARCH.md`} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            RESEARCH.md
          </a>
          , which explains why this engineering method was chosen. Agents also follow{" "}
          <a href={`${REPO_BLOB}AGENTS.md`} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            AGENTS.md
          </a>{" "}
          at the repository root. For the agent-facing parts, see{" "}
          <Link to="/developers" className="underline underline-offset-4">
            Developers
          </Link>
          .
        </p>
      </Section>

      <Seam from="green" to="black" salt={22} />

      {/* STATUS */}
      <Section id="status">
        <Float className="right-[4%] top-[7%]">
          (03) Treat anything
          <br />
          unverified as not
          <br />
          yet working.
        </Float>
        <div className="grid gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div className="min-w-0">
            <SectionHeader
              index="02"
              eyebrow="Status"
              title="What exists and what is still to build"
              lede="The repository describes a system that is mostly not built yet. This is the plain version."
            />
            <div className="mt-10 grid gap-10 md:grid-cols-2">
              <div className="min-w-0">
                <h3 className="font-serif text-2xl text-gold">In the repository</h3>
                <ul className="mt-4">
                  {BUILT.map((t) => (
                    <li key={t} className="border-t border-border py-3 text-sm leading-relaxed text-muted-foreground">
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="min-w-0">
                <h3 className="font-serif text-2xl text-gold">Still to build</h3>
                <ul className="mt-4">
                  {TO_BUILD.map((t) => (
                    <li key={t} className="border-t border-border py-3 text-sm leading-relaxed text-muted-foreground">
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="mt-8 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              The desktop UI is a renderer only. It holds presentation data and browser-local session behaviour. It
              does not prove working sign-in, hardware access, monitoring, incidents, agent delivery, builds,
              deployments or updates. To preview it, run <Mono>npm install</Mono> and <Mono>npm run dev</Mono> in the{" "}
              <Mono>LokiAI Desktop UI</Mono> folder. The first certified hardware target is the ESP32-S3 N1R8, and the
              exact board still has to be confirmed before any flash layout is written.
            </p>
          </div>
          <div className="min-w-0">
            <PixelScene
              scene="pipeline"
              cell={5}
              ratio="16 / 12"
              label="Pixel animation of a job moving through build, flash, restart, test and verify"
            />
          </div>
        </div>
      </Section>

      <Seam from="black" to="green" salt={23} />

      {/* V1.1 */}
      <Section id="v1-1" tone="field">
        <Float className="right-[4%] top-[4%]">
          (04) A different product.
          <br />
          Kept for reference.
        </Float>
        <SectionHeader
          index="03"
          eyebrow="Earlier product"
          title="LokiAI v1.1: hosted model deployment"
          lede="Before v1.2, LokiAI was a hosted workspace that discovers, verifies and deploys AI models to devices. It is kept here for reference."
        />
        <p className="mt-6 max-w-3xl border-l-2 border-foreground pl-4 text-sm leading-relaxed text-foreground">
          Note: v1.1 is not what the rest of this site describes. Everything else here is about v1.2.
        </p>

        <h3 className="mt-14 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">How it works</h3>
        <ol className="mt-4 grid gap-x-8 md:grid-cols-5">
          {V11_FLOW.map(([t, d], i) => (
            <li key={t} className="min-w-0 border-t border-border py-4">
              <span className="px text-xl">{String(i + 1).padStart(2, "0")}</span>
              <h4 className="mt-2 font-serif text-xl text-foreground">{t}</h4>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d}</p>
            </li>
          ))}
        </ol>

        <div className="mt-14 grid gap-14 lg:grid-cols-2">
          <div className="min-w-0">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Device agents</h3>
            <ul className="mt-4">
              {V11_AGENTS.map(([name, status, note]) => (
                <li key={name} className="grid gap-2 border-t border-border py-4 sm:grid-cols-[1fr_auto] sm:items-start">
                  <div className="min-w-0">
                    <h4 className="font-serif text-xl text-foreground">{name}</h4>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{note}</p>
                  </div>
                  <div>
                    <StatusPill status={status} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Capabilities</h3>
            <ul className="mt-4">
              {V11_NOW.map(([name, status]) => (
                <li key={name} className="grid gap-2 border-t border-border py-4 sm:grid-cols-[1fr_auto] sm:items-start">
                  <span className="min-w-0 text-base leading-relaxed text-foreground">{name}</span>
                  <div>
                    <StatusPill status={status} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <h3 className="mt-14 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Its documentation topics
        </h3>
        <ul className="mt-4 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
          {V11_TOPICS.map((t) => (
            <li key={t} className="border-t border-border py-3 text-base text-foreground">
              {t}
            </li>
          ))}
        </ul>

        <p className="mt-10">
          <a
            href={WORKSPACE_URL}
            className="inline-flex min-h-[48px] items-center border border-foreground px-6 font-mono text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-primary-foreground"
          >
            Open the workspace
          </a>
        </p>
      </Section>

      <CTABlock
        seamFrom="green"
        title="Read the specs. Check them against the code."
        body="Everything on this page points to a file in the repository."
        primary={{ label: "View on GitHub", href: REPO_TREE }}
        secondary={{ label: "For developers", to: "/developers" }}
      />
    </>
  );
}
