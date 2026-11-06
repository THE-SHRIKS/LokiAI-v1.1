import { createFileRoute, Link } from "@tanstack/react-router";
import { CTABlock, PageHero, Section, SectionHeader, StatusPill } from "@/components/loki/primitives";
import { Float, PixelScene, Seam } from "@/components/loki/pixel";
import { REPO_BLOB } from "@/lib/links";

const TITLE = "LokiAI v1.2 product: what it does, who it is for, what it is not";
const DESC =
  "LokiAI v1.2 is a desktop control center and local runtime that lets coding agents work with micro-devices under your approval. See who it is for, the loop it runs, the eight desktop areas and the honest status.";
const PAGE_URL = "https://lokiai.theshriks.space/product";

export const Route = createFileRoute("/product")({
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
  component: ProductPage,
});

const USERS = [
  {
    id: "P-01",
    title: "Independent hardware developer",
    body: "One desktop app to connect a board, read its health and logs, let a coding agent help with firmware, and build, flash and test without a different toolchain for every job.",
    status: "available" as const,
    label: "Primary user",
  },
  {
    id: "P-02",
    title: "Small hardware team",
    body: "Shared workspaces, consistent device records, incident evidence, visible agent runs, approvals, deployment history and repeatable verification.",
    status: "beta" as const,
    label: "Supported goal",
  },
  {
    id: "P-03",
    title: "Industrial fleet operator",
    body: "Many gateways, many devices, fleet policy and staged rollout. This is an architectural target only. v1.2 does not promise fleet features, but its contracts are meant not to block them.",
    status: "planned" as const,
    label: "Target only",
  },
];

const GOALS = [
  "Turn the accepted desktop interface into a secure Windows application.",
  "Discover and validate connected hardware through a device-neutral connector contract.",
  "Certify one physical ESP32-S3 reference path from discovery to recovery.",
  "Expose safe tools to Codex, Claude Code, Cursor and later clients through one MCP server.",
  "Collect telemetry and bounded logs, evaluate rules and open incidents with evidence.",
  "Run builds, flashes, restarts, tests and rollbacks as durable, auditable jobs.",
  "Keep monitoring independent of the open window, so the runtime can later sit on an always-on gateway.",
  "Block unapproved or unverified high-risk hardware actions.",
];

const LOOP = [
  ["Evidence", "The runtime collects timestamped telemetry and bounded logs, and shows gaps in the data."],
  ["Incident", "A rule you configured matches. LokiAI opens or joins an incident with an evidence snapshot."],
  ["Agent proposal", "Your coding agent reads the evidence and asks for a build or change through typed tools."],
  ["Approval", "High-risk actions show target, risk, downtime, preflight, verification and rollback. You approve or refuse."],
  ["Durable job", "The work runs as a job with stages. It survives a window reload or closing the app."],
  ["Verification", "LokiAI checks the real outcome. An incident does not resolve until its verification conditions pass."],
  ["Activity trail", "Every device-changing and security-relevant event is written to an append-only record."],
];

const AREAS = [
  ["Dashboard", "What needs attention across the workspace."],
  ["Devices", "Connected hardware, connector, capabilities and health."],
  ["Monitoring", "Telemetry, logs and rules. Runtime health is shown apart from device health."],
  ["Incidents", "Evidence-backed problems, with explicit states from open to closed."],
  ["Agents", "Connected coding agents and their runs, tools and outcomes."],
  ["Deployments", "Artifacts, targets, stages, verification and rollback plans."],
  ["Activity", "Who asked for what, what was approved, and what happened."],
  ["Settings", "Workspace, agents, runtime, permissions, monitoring, notifications and data."],
];

const NOT = [
  "Designing or manufacturing physical hardware.",
  "A general-purpose remote shell for agents.",
  "Autonomous fixes on production devices without policy and approval.",
  "Certifying every device family the interface shows.",
  "A complete multi-site industrial management product.",
  "A built-in code editor that replaces your coding agent.",
];

const STATUS: [string, string, "available" | "beta" | "planned"][] = [
  ["React interface baseline", "Accepted as the visual and interaction reference. It is a React and Vite renderer, not yet a production desktop system.", "available"],
  ["Electron shell and trusted IPC", "Implementation work.", "planned"],
  ["Rust runtime and persistence", "Implementation work.", "planned"],
  ["Cloud integration and MCP server", "Implementation work.", "planned"],
  ["Real hardware paths", "Implementation work. The ESP32-S3 board must be confirmed before any flash layout is built.", "planned"],
];

function ProductPage() {
  return (
    <>
      <PageHero
        eyebrow="Product · v1.2"
        title="A control center between your coding agent and your hardware"
        lede="LokiAI is a desktop app and local runtime. Agents investigate and propose. LokiAI authenticates, runs, watches and records. You keep the final say on anything that changes a device."
        meta={["Open source", "Windows 11 x64 first", "In development"]}
        scene="authority"
        sceneLabel="Pixel animation: an agent sends a request, a gate waits for approval, then the device acts and the result is logged"
        note={<>(01) Reasoning and<br />authority are separate.</>}
      />

      <Seam from="black" to="green" salt={11} />

      <Section id="users" tone="field">
        <Float className="right-[4%] top-[6%]">(02) Built for one person<br />first. A team second.</Float>
        <SectionHeader
          index="01"
          eyebrow="Who it is for"
          title="Three kinds of user, one of them only a direction"
          lede="The product requirements name these users. They are not equally served in v1.2."
        />
        <ol className="mt-14 grid gap-10 md:grid-cols-3">
          {USERS.map((u) => (
            <li key={u.id} className="min-w-0 border-t border-border pt-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="px text-2xl">{u.id}</span>
                <StatusPill status={u.status} labels={{ [u.status]: u.label }} />
              </div>
              <h3 className="mt-3 font-serif text-2xl leading-tight text-foreground">{u.title}</h3>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">{u.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Seam from="green" to="black" salt={12} />

      <Section id="goals">
        <Float className="right-[4%] top-[7%]">(03) Plain goals,<br />no promises beyond them.</Float>
        <div className="grid gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div className="min-w-0">
            <SectionHeader
              index="02"
              eyebrow="What it does"
              title="The goals, in plain words"
              lede="Success means going from install to a connected device, working with an agent, catching a real problem, approving a bounded fix and watching LokiAI verify recovery."
            />
            <ul className="mt-10">
              {GOALS.map((g, i) => (
                <li key={g} className="grid grid-cols-[3rem_1fr] gap-4 border-t border-border py-4">
                  <span className="px text-xl text-gold">{String(i + 1).padStart(2, "0")}</span>
                  <p className="min-w-0 text-base leading-relaxed text-muted-foreground">{g}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0">
            <PixelScene
              scene="board"
              cell={5}
              ratio="16 / 11"
              label="Pixel illustration of an ESP32-S3 development board with a USB cable, header pins and blinking LEDs"
            />
            <p className="mt-4 font-mono text-[11px] uppercase leading-relaxed tracking-[0.14em] text-muted-foreground">
              First certified target: the ESP32-S3 N1R8 board.
            </p>
          </div>
        </div>
      </Section>

      <Seam from="black" to="green" salt={13} />

      <Section id="loop" tone="field">
        <Float className="left-[3%] top-[5%]">(04) A symptom,<br />a bounded fix,<br />a verified result.</Float>
        <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div className="min-w-0">
            <SectionHeader
              index="03"
              eyebrow="The loop"
              title="Seven steps, none skipped"
              lede="Each step leaves a record. A tool that changes a device returns an approval request or a job, never an early success."
            />
            <ol className="mt-10">
              {LOOP.map(([t, d], i) => (
                <li key={t} className="grid grid-cols-[3rem_1fr] gap-4 border-t border-border py-4">
                  <span className="px text-xl">{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0">
                    <h3 className="font-serif text-xl text-foreground">{t}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="min-w-0 space-y-8">
            <PixelScene
              scene="pipeline"
              cell={5}
              tone="field"
              ratio="16 / 12"
              label="Pixel animation of a job moving through build, flash, restart, test and verify"
            />
            <PixelScene
              scene="telemetry"
              cell={5}
              tone="field"
              ratio="16 / 8"
              label="Pixel animation of a telemetry signal crossing a threshold and raising a flag"
            />
          </div>
        </div>
      </Section>

      <Seam from="green" to="black" salt={14} />

      <Section id="areas">
        <Float className="right-[4%] top-[7%]">(05) Eight areas,<br />one window.</Float>
        <SectionHeader
          index="04"
          eyebrow="The desktop app"
          title="Eight areas of the interface"
          lede="The design requires every area to use real service data and to show an honest unavailable state when there is none."
        />
        <ul className="mt-14 grid gap-x-12 md:grid-cols-2">
          {AREAS.map(([t, d], i) => (
            <li key={t} className="grid grid-cols-[3rem_1fr] gap-4 border-t border-border py-5">
              <span className="px text-xl text-gold">{String(i + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                <h3 className="font-serif text-2xl text-foreground">{t}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Seam from="black" to="green" salt={15} />

      <Section id="not" tone="field">
        <Float className="right-[4%] top-[6%]">(06) Said plainly.</Float>
        <div className="grid gap-14 lg:grid-cols-2">
          <SectionHeader
            index="05"
            eyebrow="Scope"
            title="What v1.2 is not"
            lede="These are the non-goals in the product requirements. If you need one of them, v1.2 is the wrong tool."
          />
          <ul className="min-w-0">
            {NOT.map((n) => (
              <li key={n} className="border-t border-border py-4 text-base leading-relaxed text-foreground">
                {n}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Seam from="green" to="black" salt={16} />

      <Section id="status">
        <Float className="right-[4%] top-[7%]">(07) Early.<br />Not yet usable<br />end to end.</Float>
        <div className="grid gap-14 lg:grid-cols-[1fr_1fr]">
          <SectionHeader
            index="06"
            eyebrow="Status"
            title="Where the work actually stands"
            lede={
              <>
                The repository&apos;s engineering rules state which parts exist and which are still to be built. Treat
                anything not listed as done as not done. The{" "}
                <Link to="/docs" className="text-gold underline underline-offset-4">
                  docs
                </Link>{" "}
                hold the full document set.
              </>
            }
          />
          <ul className="min-w-0">
            {STATUS.map(([t, d, s]) => (
              <li key={t} className="grid gap-2 border-t border-border py-5 sm:grid-cols-[1fr_auto] sm:gap-6">
                <div className="min-w-0">
                  <h3 className="font-serif text-xl text-foreground">{t}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d}</p>
                </div>
                <div>
                  <StatusPill status={s} labels={{ available: "Accepted", planned: "To build" }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.2em]">
          <a href={`${REPO_BLOB}AGENTS.md`} target="_blank" rel="noreferrer" className="text-gold underline underline-offset-4">
            Read AGENTS.md
          </a>
          <span className="mx-3 text-muted-foreground">/</span>
          <a href={`${REPO_BLOB}Docs/PRD.md`} target="_blank" rel="noreferrer" className="text-gold underline underline-offset-4">
            Read the PRD
          </a>
        </p>
      </Section>

      <CTABlock
        title="Read the requirements, then the code"
        body="The product requirements, specification and security architecture are in the repository."
      />
    </>
  );
}
