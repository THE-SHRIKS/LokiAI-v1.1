import { createFileRoute, Link } from "@tanstack/react-router";
import { CTABlock, Eyebrow, Section, SectionHeader } from "@/components/loki/primitives";
import { Float, PixelScene, Seam } from "@/components/loki/pixel";
import { Reveal } from "@/components/loki/Reveal";
import { REPO_URL } from "@/lib/links";

const TITLE = "LokiAI v1.2: coding agents propose, LokiAI executes, you approve";
const DESC =
  "LokiAI v1.2 is an open-source desktop app and local runtime that lets coding agents inspect, build, flash and test micro-devices through scoped tools, with your approval and a full activity trail.";

const PAGE_URL = "https://lokiai.theshriks.space/";

export const Route = createFileRoute("/")({
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
  component: Home,
});

const ROLES = [
  {
    n: "01",
    title: "Agents investigate and propose",
    body: "Codex, Claude Code, Cursor and other MCP clients read evidence and request changes. They never receive a shell, a serial port or your credentials.",
  },
  {
    n: "02",
    title: "LokiAI holds the authority",
    body: "It authenticates the request, checks policy, runs the job, watches the device and records what happened.",
  },
  {
    n: "03",
    title: "You make the final call",
    body: "Restarts, flashes, deployments and rollbacks are high risk by default. They wait for your approval.",
  },
];

const LOOP = [
  ["Collect evidence", "Telemetry and bounded, redacted logs come from the connected device."],
  ["Open an incident", "Rules turn that evidence into an incident, with its context attached."],
  ["Propose", "Your coding agent investigates and asks for a build or a change through typed tools."],
  ["Approve", "LokiAI shows exactly what will run. You accept it or refuse it."],
  ["Execute", "Builds, flashes, restarts and tests run as durable jobs with an audit trail."],
  ["Verify and record", "LokiAI checks the real outcome and writes it to the activity trail."],
];

const LIMITS = [
  ["No raw shell", "Tools take typed parameters. They do not accept commands, scripts, URLs or free paths."],
  ["Approval is not a flag", "An agent cannot pass approved: true. A consequential tool returns a denial, an approval request or a job."],
  ["Builds are contained", "Firmware builds run in an isolated executor that does not inherit LokiAI credentials or device access."],
  ["Secrets stay out of the interface", "The renderer gets a minimal session projection. Refresh tokens never sit in renderer storage."],
  ["Logs are untrusted text", "Device logs are redacted and bounded, and they are treated as untrusted input to an agent."],
];

const AREAS = [
  ["Dashboard", "What needs attention across the workspace."],
  ["Devices", "Connected hardware, its connector, capabilities and health."],
  ["Monitoring", "Telemetry and logs, collected by the runtime even when the window is closed."],
  ["Incidents", "Evidence-backed problems and where each one stands."],
  ["Agents", "Which coding agents are connected, and what they have run."],
  ["Deployments", "Artifacts, targets, stages and verification."],
  ["Activity", "The full trail of who asked for what, and what happened."],
  ["Settings", "Workspace, policy and connection settings."],
];

function Home() {
  return (
    <>
      {/* HERO. The film stays; the picture beside the text is new. */}
      <section className="relative flex min-h-[100svh] flex-col justify-center overflow-hidden">
        <video autoPlay loop muted playsInline className="absolute inset-0 z-0 h-full w-full object-cover opacity-60">
          <source src="/timeline.mov" />
        </video>
        <div className="absolute inset-0 z-[1] bg-black/40" aria-hidden="true" />
        <Float className="left-[3%] top-[22%] z-10">(01) v1.2 is the<br />current line.</Float>
        <Float className="bottom-[9%] right-[5%] z-10">No raw shell.<br />No bypassed approvals.</Float>
        <div className="relative z-10 mx-auto grid w-full max-w-7xl gap-12 px-8 pb-24 pt-12 md:px-12 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:px-20 lg:pb-32 lg:pt-16">
          <div className="min-w-0">
            <Eyebrow index="v1.2">Open source · In development</Eyebrow>
            <h1 className="mt-5 font-serif text-4xl leading-[1.08] text-foreground sm:text-5xl lg:text-6xl">
              Agents propose.
              <br />
              LokiAI executes.
              <br />
              <span className="text-gold">You approve.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
              LokiAI is a desktop app and local runtime that lets coding agents inspect, build, flash and test
              micro-devices through scoped tools. Every consequential action waits for you, and every step is recorded.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[48px] items-center bg-gold px-6 font-mono text-xs uppercase tracking-[0.2em] text-primary-foreground transition-opacity hover:opacity-85"
              >
                View on GitHub
              </a>
              <Link
                to="/docs"
                className="inline-flex min-h-[48px] items-center border border-border px-6 font-mono text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:border-gold hover:text-gold"
              >
                Read the docs
              </Link>
            </div>
          </div>
          <div className="min-w-0">
            <PixelScene
              scene="board"
              cell={5}
              ratio="16 / 11"
              label="Pixel illustration of an ESP32-S3 development board with a USB cable, header pins and blinking LEDs"
            />
          </div>
        </div>
      </section>

      <Seam from="black" to="green" salt={1} />

      {/* A. REASONING AND AUTHORITY */}
      <Section id="idea" tone="field">
        <Float className="right-[4%] top-[7%]">(02) Reasoning and<br />authority are separate.</Float>
        <SectionHeader
          index="01"
          eyebrow="The idea"
          title="The agent thinks. LokiAI holds the keys."
          lede="Coding agents can edit firmware, but they cannot safely operate the hardware it runs on. LokiAI sits in between."
        />
        <Reveal className="mt-14">
          <PixelScene
            scene="authority"
            cell={5}
            tone="field"
            ratio="16 / 8"
            label="Pixel animation: an agent sends a request, a gate waits for approval, then the device acts and the result is logged"
          />
        </Reveal>
        <ol className="mt-14 grid gap-10 md:grid-cols-3">
          {ROLES.map((r) => (
            <li key={r.n} className="border-t border-border pt-5">
              <span className="px text-2xl">{r.n}</span>
              <h3 className="mt-3 font-serif text-2xl leading-tight text-foreground">{r.title}</h3>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">{r.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Seam from="green" to="black" salt={2} />

      {/* B. THE LOOP */}
      <Section id="loop">
        <Float className="right-[4%] top-[8%]">(03) A symptom,<br />a bounded fix,<br />a verified result.</Float>
        <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <SectionHeader
              index="02"
              eyebrow="How it runs"
              title="From a symptom to a verified fix"
              lede="One loop, with a person in it. Nothing skips a step, and each step leaves a record."
            />
            <ol className="mt-10">
              {LOOP.map(([t, d], i) => (
                <li key={t} className="grid grid-cols-[3rem_1fr] gap-4 border-t border-border py-4">
                  <span className="px text-xl text-gold">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 className="font-serif text-xl text-foreground">{t}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <Reveal className="min-w-0">
            <PixelScene
              scene="pipeline"
              cell={5}
              ratio="16 / 12"
              label="Pixel animation of a job moving through build, flash, restart, test and verify"
            />
            <div className="mt-8">
              <PixelScene
                scene="telemetry"
                cell={5}
                ratio="16 / 8"
                label="Pixel animation of a telemetry signal crossing a threshold and raising a flag"
              />
            </div>
          </Reveal>
        </div>
      </Section>

      <Seam from="black" to="green" salt={3} />

      {/* C. HARDWARE */}
      <Section id="hardware" tone="field">
        <Float className="left-[3%] top-[6%]">(04) ESP32-S3 first.<br />Other families later.</Float>
        <div className="grid gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <Reveal className="min-w-0">
            <PixelScene
              scene="connectors"
              cell={5}
              tone="field"
              ratio="16 / 11"
              label="Pixel illustration: a device-neutral contract bar above six chip slots, one certified and five planned"
            />
          </Reveal>
          <div>
            <SectionHeader
              index="03"
              eyebrow="Hardware"
              title="One board, certified end to end"
              lede="The first target is the ESP32-S3 (N1R8 module). The connector contract is device-neutral, so other families can follow without changing the shared layers."
            />
            <ul className="mt-8 space-y-4 text-base leading-relaxed text-muted-foreground">
              <li className="border-t border-border pt-4">Discovery goes only through registered connectors, and every result names the connector and its evidence.</li>
              <li className="border-t border-border pt-4">ESP32-specific code lives in its own connector, never in the shared domain or transport layers.</li>
              <li className="border-t border-border pt-4">Only the ESP32-S3 path is being certified in v1.2. The interface shows more families than that.</li>
            </ul>
          </div>
        </div>
      </Section>

      <Seam from="green" to="black" salt={4} />

      {/* D. LIMITS */}
      <Section id="limits">
        <Float className="right-[4%] top-[7%]">(05) What an agent<br />cannot do.</Float>
        <div className="grid gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div>
            <SectionHeader
              index="04"
              eyebrow="Safety"
              title="Built so an agent cannot overreach"
              lede="The limits are in the contracts, not in a prompt. The runtime enforces them whichever agent is connected."
            />
            <dl className="mt-10">
              {LIMITS.map(([t, d]) => (
                <div key={t} className="grid gap-1 border-t border-border py-5 sm:grid-cols-[14rem_1fr] sm:gap-8">
                  <dt className="font-serif text-xl text-gold">{t}</dt>
                  <dd className="text-base leading-relaxed text-muted-foreground">{d}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-8">
              <Link to="/security" className="font-mono text-xs uppercase tracking-[0.2em] text-gold underline underline-offset-4">
                Read the security model
              </Link>
            </p>
          </div>
          <Reveal className="min-w-0">
            <PixelScene
              scene="gateway"
              cell={5}
              ratio="16 / 12"
              label="Pixel animation of a gateway computer linked to four devices, one of them flashing an alert"
            />
            <p className="mt-4 font-mono text-[11px] uppercase leading-relaxed tracking-[0.14em] text-muted-foreground">
              Monitoring runs in the runtime, not in the window, so it can later move to an always-on gateway.
            </p>
          </Reveal>
        </div>
      </Section>

      <Seam from="black" to="green" salt={5} />

      {/* E. THE DESKTOP APP */}
      <Section id="desktop" tone="field">
        <Float className="right-[4%] top-[7%]">(06) Interface baseline<br />accepted. Runtime<br />in progress.</Float>
        <SectionHeader
          index="05"
          eyebrow="The desktop app"
          title="Eight areas, one window"
          lede="The visual and interaction baseline is accepted. The Electron shell, the runtime and the real hardware paths are still being built."
        />
        <ul className="mt-14 grid gap-x-12 gap-y-0 md:grid-cols-2">
          {AREAS.map(([t, d], i) => (
            <li key={t} className="grid grid-cols-[3rem_1fr] gap-4 border-t border-border py-5">
              <span className="px text-xl">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3 className="font-serif text-2xl text-foreground">{t}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Seam from="green" to="black" salt={6} />

      {/* F. OPEN SOURCE */}
      <Section id="source">
        <Float className="right-[4%] top-[8%]">(07) Rust runtime.<br />Electron shell.<br />MCP server.</Float>
        <div className="grid gap-14 lg:grid-cols-[1fr_1fr]">
          <SectionHeader
            index="06"
            eyebrow="Open source"
            title="Early, and honest about it"
            lede="The repository is public so you can read how the limits are enforced before you rely on them."
          />
          <dl className="grid content-start gap-0">
            {[
              ["Runtime", "A Rust workspace of 20 crates: jobs, storage, approvals, monitoring, incidents, connectors and the build executor."],
              ["Desktop", "An Electron shell around the accepted React and TypeScript interface."],
              ["Agents", "One MCP server, so Codex, Claude Code, Cursor and later clients see the same tools."],
              ["Status", "In development. Treat anything not marked as verified in the repository as not yet working."],
              ["Version", "v1.2 is the current line. The Docs hold the earlier releases."],
            ].map(([k, v]) => (
              <div key={k} className="grid gap-1 border-t border-border py-4 sm:grid-cols-[7rem_1fr] sm:gap-6">
                <dt className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{k}</dt>
                <dd className="text-base leading-relaxed text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      <CTABlock
        title="Read the code. Judge the approach."
        body="Everything described here is in the repository, along with the documents that define it."
      />
    </>
  );
}
