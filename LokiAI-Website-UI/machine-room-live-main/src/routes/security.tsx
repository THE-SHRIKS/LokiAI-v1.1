import { createFileRoute } from "@tanstack/react-router";
import { CTABlock, Mono, PageHero, Section, SectionHeader } from "@/components/loki/primitives";
import { Float, PixelScene, Seam } from "@/components/loki/pixel";
import { REPO_BLOB } from "@/lib/links";

const TITLE = "LokiAI v1.2 security: separating reasoning from authority";
const DESC =
  "How LokiAI v1.2 is designed to keep coding agents away from hardware authority: trust boundaries, an approval contract, device safety, MCP limits, untrusted logs, secrets and build containment. Design intent, not an audit.";
const PAGE_URL = "https://lokiai.theshriks.space/security";

export const Route = createFileRoute("/security")({
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
  component: SecurityPage,
});

const BOUNDARIES = [
  ["Renderer", "Untrusted presentation code. Sandboxed, no Node.js, no filesystem, shell, serial or credential access."],
  ["Electron main", "Owns the window, external-browser sign-in, updates and a narrow, typed preload bridge. Validates every IPC sender."],
  ["Rust runtime", "The authority boundary. Policy, approvals, durable jobs, connectors and encrypted local storage."],
  ["MCP server", "One provider-neutral server. Authenticates every runtime connection and exposes fixed, scoped tools."],
  ["Build executor", "Separate and contained. Runs repository code and toolchains with no secrets, devices or runtime access."],
];

const APPROVAL_INPUT = [
  "Operation name and schema version",
  "Workspace and environment",
  "The exact device target snapshot",
  "The exact artifact, config or model digest",
  "Normalised parameters",
  "Requester and agent run",
  "Policy version and risk",
  "Preflight result digest",
  "Expected effect and downtime",
  "Verification and rollback plan",
  "Creation and expiry time",
];

const APPROVAL_RULES = [
  "The request is hashed. Execution recomputes the hash and compares it.",
  "An approval is single-use and consumed when execution begins.",
  "An agent cannot approve its own request.",
  "A button click without a stored approval record is not enough.",
  "Expired, denied, used, changed or differently scoped approvals fail closed.",
  "Emergency recovery is its own explicit policy, never a quiet bypass.",
];

const DEVICE_STEPS = [
  "Re-identify the physical target.",
  "Confirm connector, version, capability and an exclusive lease.",
  "Check power, transport, boot and recovery preconditions.",
  "Verify artifact type, digest, compatibility, provenance and size.",
  "Re-evaluate policy and the approval binding.",
  "Save a recoverable job checkpoint.",
  "Run with timeouts, progress bounds and safe cancellation points.",
  "Reconcile identity after restart or reconnect.",
  "Run operation-specific tests and observation.",
  "Release the lease only at a terminal state or quarantine.",
];

const MCP = [
  "Local clients use stdio. Remote MCP stays off until it has its own threat model.",
  "Every tool has a fixed schema, risk class, payload limit, timeout and audit policy.",
  "No tool takes arbitrary commands, scripts, URLs, ports, device paths or free filesystem paths.",
  "Repository paths resolve against an approved workspace root with canonical path and symlink checks.",
  "Tool text from the client cannot change policy or approval state.",
  "Results are bounded and redacted. Rate and concurrency limits apply per connection, workspace and device.",
];

const SECRETS = [
  ["Sign-in", "Authorization Code with PKCE in the system browser, never in a privileged window."],
  ["Renderer", "Gets a non-secret session projection only. Refresh tokens stay in OS-protected storage."],
  ["Agents", "Use separate, revocable, workspace-scoped credentials. They never reuse the human token."],
  ["Local data", "Runtime database is fully encrypted, with the key protected by the operating system."],
  ["Logs", "Record credential references and fingerprints, never values."],
];

const SUPPLY = [
  "Builds run from an exact source revision with a typed, allowlisted recipe. Command strings are not an input.",
  "Toolchains are pinned and checksummed or verified by provenance.",
  "Artifacts are content-addressed by digest. The runtime re-checks digest and target before transfer and apply.",
  "Signing is separate from the build. Build success does not authorise deployment.",
  "Releases produce an SBOM and dependency record. Update checks fail closed.",
];

const ELECTRON = [
  "Node integration off and context isolation on, in every renderer.",
  "Renderer sandbox on, with a strict content security policy.",
  "No remote code, remote preload or runtime-downloaded scripts.",
  "Unexpected navigation, permissions, downloads and new windows are denied.",
  "External links open only for HTTPS URLs on exact approved origins.",
  "No raw ipcRenderer is exposed. One narrow method per use case, with validated input and output.",
];

function SecurityPage() {
  return (
    <>
      <PageHero
        eyebrow="Security · v1.2"
        title="The agent proposes. Deterministic code decides."
        lede="LokiAI separates reasoning from authority. Coding agents investigate and propose. LokiAI authenticates, authorises, executes, observes and records. People keep final authority over consequential actions."
        meta={["Design document", "Draft for human acceptance", "No external audit cited"]}
        scene="authority"
        sceneLabel="Pixel animation: an agent sends a request, a gate waits for approval, then the device acts and the result is logged"
        note={<>(01) Authorisation lives<br />in code, not in a prompt.</>}
      />

      <Seam from="black" to="green" salt={31} />

      <Section id="boundaries" tone="field">
        <Float className="right-[4%] top-[6%]">(02) Crossing a boundary<br />means validating.</Float>
        <SectionHeader
          index="01"
          eyebrow="Trust boundaries"
          title="Five places, each with its own limits"
          lede="Anything crossing a boundary needs runtime schema validation, authorisation, size and time bounds, redaction and structured errors."
        />
        <ol className="mt-14 grid gap-x-12 md:grid-cols-2">
          {BOUNDARIES.map(([t, d], i) => (
            <li key={t} className="grid grid-cols-[3rem_1fr] gap-4 border-t border-border py-5">
              <span className="px text-xl">{String(i + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                <h3 className="font-serif text-2xl text-foreground">{t}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Seam from="green" to="black" salt={32} />

      <Section id="approval">
        <Float className="right-[4%] top-[7%]">(03) One approval,<br />one exact action.</Float>
        <div className="grid gap-14 lg:grid-cols-[1fr_1fr]">
          <div className="min-w-0">
            <SectionHeader
              index="02"
              eyebrow="Approval contract"
              title="Approval is bound to what will run"
              lede="Approval depends on the operation, target, environment, scope, digest and policy. It does not depend on which button or agent asked."
            />
            <h3 className="mt-10 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              What the hash covers
            </h3>
            <ul className="mt-3 columns-1 sm:columns-2">
              {APPROVAL_INPUT.map((a) => (
                <li key={a} className="break-inside-avoid border-t border-border py-2 text-sm leading-relaxed text-foreground">
                  {a}
                </li>
              ))}
            </ul>
          </div>
          <ul className="min-w-0 lg:pt-4">
            {APPROVAL_RULES.map((r) => (
              <li key={r} className="border-t border-border py-4 text-base leading-relaxed text-muted-foreground">
                {r}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Seam from="black" to="green" salt={33} />

      <Section id="device" tone="field">
        <Float className="left-[3%] top-[5%]">(04) Unknown is safer<br />than false success.</Float>
        <div className="grid gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div className="min-w-0">
            <SectionHeader
              index="03"
              eyebrow="Device-operation safety"
              title="Ten steps before and after any change"
              lede="A device that ends in an unknown state is quarantined. It accepts no further destructive job until identity and state are reconciled."
            />
            <ol className="mt-10">
              {DEVICE_STEPS.map((s, i) => (
                <li key={s} className="grid grid-cols-[3rem_1fr] gap-4 border-t border-border py-3">
                  <span className="px text-xl">{String(i + 1).padStart(2, "0")}</span>
                  <p className="min-w-0 text-base leading-relaxed text-foreground">{s}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="min-w-0">
            <PixelScene
              scene="pipeline"
              cell={5}
              tone="field"
              ratio="16 / 12"
              label="Pixel animation of a job moving through build, flash, restart, test and verify"
            />
          </div>
        </div>
      </Section>

      <Seam from="green" to="black" salt={34} />

      <Section id="mcp">
        <Float className="right-[4%] top-[7%]">(05) No raw shell.</Float>
        <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div className="min-w-0">
            <SectionHeader
              index="04"
              eyebrow="MCP security"
              title="Tools with fixed shapes"
              lede="Agents reach LokiAI only through typed tools. Read tools are scoped to the workspace and device. Consequential tools return an approval request or a job ID, never an implied success."
            />
          </div>
          <ul className="min-w-0">
            {MCP.map((m) => (
              <li key={m} className="border-t border-border py-4 text-base leading-relaxed text-muted-foreground">
                {m}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Seam from="black" to="green" salt={35} />

      <Section id="logs" tone="field">
        <Float className="right-[4%] top-[6%]">(06) A log line is data,<br />not an order.</Float>
        <div className="grid gap-14 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div className="min-w-0">
            <SectionHeader
              index="05"
              eyebrow="Logs and prompt injection"
              title="Device text is untrusted"
              lede="Device logs, repository files, build output, agent messages and cloud labels can all carry instructions meant to trick an agent."
            />
            <ul className="mt-8">
              <li className="border-t border-border py-4 text-base leading-relaxed text-foreground">
                Evidence is labelled with its source and trust class, and delimited when shown to an agent.
              </li>
              <li className="border-t border-border py-4 text-base leading-relaxed text-foreground">
                It is never joined into policy instructions. Authorisation stays in deterministic code, not model judgement.
              </li>
              <li className="border-t border-border py-4 text-base leading-relaxed text-foreground">
                Control characters, encoding and size are filtered. Text renders without running HTML.
              </li>
              <li className="border-t border-border py-4 text-base leading-relaxed text-foreground">
                Configured secrets and sensitive identifiers are redacted before storage or export.
              </li>
            </ul>
          </div>
          <div className="min-w-0">
            <PixelScene
              scene="telemetry"
              cell={5}
              tone="field"
              ratio="16 / 10"
              label="Pixel animation of a telemetry signal crossing a threshold and raising a flag"
            />
          </div>
        </div>
      </Section>

      <Seam from="green" to="black" salt={36} />

      <Section id="secrets">
        <Float className="right-[4%] top-[7%]">(07) Tokens stay out<br />of the window.</Float>
        <SectionHeader
          index="06"
          eyebrow="Secrets and session"
          title="Who holds what"
          lede="Logout removes renderer access and usable local session state at once, even if revoking in the cloud has to retry."
        />
        <dl className="mt-12">
          {SECRETS.map(([k, v]) => (
            <div key={k} className="grid gap-1 border-t border-border py-4 sm:grid-cols-[10rem_1fr] sm:gap-8">
              <dt className="font-serif text-xl text-gold">{k}</dt>
              <dd className="min-w-0 text-base leading-relaxed text-muted-foreground">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-20 grid gap-14 lg:grid-cols-[0.9fr_1.1fr]">
          <SectionHeader
            index="08"
            eyebrow="Electron baseline"
            title="A locked-down window"
            lede="The design treats these Electron settings as release-blocking. The desktop shell is not built yet."
          />
          <ul className="min-w-0">
            {ELECTRON.map((e) => (
              <li key={e} className="border-t border-border py-4 text-base leading-relaxed text-muted-foreground">
                {e}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Seam from="black" to="green" salt={37} />

      <Section id="supply" tone="field">
        <Float className="right-[4%] top-[6%]">(08) Contained builds.<br />Content-addressed output.</Float>
        <div className="grid gap-14 lg:grid-cols-2">
          <div className="min-w-0">
            <SectionHeader
              index="07"
              eyebrow="Build and supply chain"
              title="Repository code never runs in the runtime"
              lede="Firmware builds run in a dedicated, ephemeral, least-privilege executor with limits on files, network, processes, resources, output and time."
            />
            <p className="mt-6 text-base leading-relaxed text-muted-foreground">
              Flash, serial, USB, credential, signing and runtime IPC access is never given to that executor. Its
              output is quarantined and validated from outside before it becomes an artifact.
            </p>
          </div>
          <ul className="min-w-0">
            {SUPPLY.map((s) => (
              <li key={s} className="border-t border-border py-4 text-base leading-relaxed text-foreground">
                {s}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Seam from="green" to="black" salt={38} />

      <Section id="not-claimed">
        <Float className="right-[4%] top-[6%]">(10) Intent is not<br />proof.</Float>
        <div className="grid gap-14 lg:grid-cols-[1fr_1fr]">
          <SectionHeader
            index="09"
            eyebrow="What is not claimed"
            title="Design intent, not verified gates"
            lede="The security document is a draft that still needs human acceptance. Everything above describes controls the design requires."
          />
          <div className="min-w-0 text-base leading-relaxed text-foreground">
            <ul>
              <li className="border-t border-border py-4">No independent security audit is cited. The design lists one as a release gate, not as done.</li>
              <li className="border-t border-border py-4">
                The release gates (Electron, IPC, OAuth, approval, artifact, MCP, database and build tests, plus
                tests on physical hardware) are requirements to pass, not results.
              </li>
              <li className="border-t border-border py-4">
                The Electron shell, runtime, MCP server and hardware paths are still implementation work, so these
                controls are not yet running.
              </li>
              <li className="border-t border-border py-4">
                See <Mono>SECURITY.md</Mono> section 14 for the full gate list. Treat anything not shown as verified
                there as unverified.
              </li>
            </ul>
            <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.2em]">
              <a href={`${REPO_BLOB}Docs/SECURITY.md`} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                Read SECURITY.md
              </a>
            </p>
          </div>
        </div>
      </Section>

      <CTABlock
        title="Check the design against the code"
        body="The security architecture is public so you can read it, question it and hold the implementation to it."
      />
    </>
  );
}
