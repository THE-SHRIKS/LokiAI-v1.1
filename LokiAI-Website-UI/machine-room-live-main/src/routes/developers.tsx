import { createFileRoute, Link } from "@tanstack/react-router";
import { CodeBlock, CTABlock, Mono, PageHero, Section, SectionHeader } from "@/components/loki/primitives";
import { Float, PixelScene, Seam } from "@/components/loki/pixel";
import { REPO_BLOB, REPO_TREE } from "@/lib/links";

const TITLE = "Developers: the MCP server, the tools and the repository | LokiAI";
const DESC =
  "How coding agents connect to LokiAI v1.2 through one provider-neutral MCP server, which resources and tools they get, how the repository is laid out, and what is still to build.";

const PAGE_URL = "https://lokiai.theshriks.space/developers";

export const Route = createFileRoute("/developers")({
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
  component: Developers,
});

const FLOW = [
  ["Pick a client", "You choose a coding client in LokiAI Settings or onboarding."],
  ["Create a connection", "LokiAI makes a revocable agent connection with a workspace and capability scope."],
  ["Write the config", "LokiAI generates the client configuration with the exact executable path and a credential reference. It never prints a reusable plaintext secret into logs or the agent conversation."],
  ["Client starts the server", "The coding client launches the MCP server over local stdio. Remote HTTP is disabled until it is separately accepted and threat-modelled."],
  ["Each request describes itself", "Every request carries the protocol version and client identity. The server authenticates the workspace connection and exposes only what that connection is scoped to."],
  ["You can see and revoke it", "LokiAI shows the last handshake, the client, server and runtime versions, the scope, and a revoke control."],
];

const RESOURCES = [
  ["loki://workspaces/{id}/summary", "Workspace, runtime and capability summary."],
  ["loki://devices/{id}", "Device identity, connector, capability, health and freshness."],
  ["loki://devices/{id}/logs", "A bounded, redacted page of logs. Untrusted text."],
  ["loki://devices/{id}/telemetry", "A bounded signal query and its result, with quality."],
  ["loki://incidents/{id}", "State, affected scope, correlations and verification."],
  ["loki://incidents/{id}/evidence", "A bounded evidence manifest. Untrusted text."],
  ["loki://deployments/{id}", "Artifact, target, stage, verification and rollback."],
  ["loki://jobs/{id}", "A durable job: stage, result and error."],
  ["loki://agents/runs/{id}", "The run hierarchy and the tools and jobs tied to it."],
];

const TOOL_GROUPS: { risk: string; note: string; tools: string[] }[] = [
  {
    risk: "Inspection",
    note: "Low risk. Scoped to the workspace, paginated, redacted, and marked with source and freshness.",
    tools: [
      "loki_list_devices",
      "loki_get_device",
      "loki_get_device_health",
      "loki_read_device_logs",
      "loki_query_telemetry",
      "loki_list_incidents",
      "loki_get_incident",
      "loki_get_job",
      "loki_list_deployments",
      "loki_get_deployment",
    ],
  },
  {
    risk: "Diagnosis and build",
    note: "Low or medium risk, depending on policy. Build inputs are limited to an approved repository root, a revision, a target and a typed toolchain recipe.",
    tools: [
      "loki_run_health_check",
      "loki_run_preflight",
      "loki_collect_incident_evidence",
      "loki_register_agent_run",
      "loki_update_agent_run",
      "loki_request_build",
      "loki_cancel_job",
    ],
  },
  {
    risk: "Consequential operations",
    note: "High risk by default. Each one creates a request, checks policy, and returns a denial, an approval requirement or a durable job.",
    tools: [
      "loki_request_restart",
      "loki_request_flash",
      "loki_request_test_on_device",
      "loki_request_deployment",
      "loki_request_rollback",
    ],
  },
];

const RULES = [
  ["Typed parameters only", "Tools never accept raw commands, executables, scripts, URLs, environment maps or free paths."],
  ["Approval is not a flag", "No tool takes an approval boolean from the agent. An agent can request a flash. It cannot approve one."],
  ["Long calls return handles", "Slow or device-changing calls return a durable job id or approval_required. They do not block until the work looks finished."],
  ["Device text is untrusted", "Logs and evidence come back marked as untrusted text. Prompt content cannot set role, policy, approval, target or artifact digest."],
  ["Stable names and schemas", "Tool names use the loki_ prefix. Every input and output has a runtime schema and version. Final schemas are owned by the contracts package."],
];

const CRATES = [
  ["loki-runtime", "The runtime process."],
  ["loki-connectors-sdk", "The device-neutral connector contract."],
  ["loki-connector-registry", "Registers connectors; discovery goes only through it."],
  ["loki-connector-esp32-s3", "The first connector, for the ESP32-S3."],
  ["loki-ipc", "The versioned local IPC protocol."],
  ["loki-storage", "Local persisted state."],
  ["loki-jobs", "Durable jobs."],
  ["loki-approvals", "Approvals."],
  ["loki-agents", "Agent connections and runs."],
  ["loki-agent-delivery", "Handing incident work to agents."],
  ["loki-monitoring", "Telemetry and log collection."],
  ["loki-incidents", "Incidents."],
  ["loki-build-executor", "The contained firmware build executor."],
  ["loki-mutation-contract", "The contract for consequential changes."],
  ["loki-local-authority", "Local authority."],
  ["loki-local-devices", "Local devices."],
  ["loki-local-setup", "Local setup."],
  ["loki-local-notifications", "Local notifications."],
  ["loki-acceptance-store", "Storage for acceptance evidence."],
  ["loki-credential-native", "Native credential store access."],
];

const LAYOUT = [
  ["crates/", "The Rust workspace, listed on the left."],
  ["electron/", "The Electron shell: main process, preload bridge and scripts."],
  ["packages/contracts", "Shared TypeScript contracts."],
  ["packages/ipc-client", "Client for the local IPC protocol."],
  ["packages/native-credential-store", "Credential store binding."],
  ["services/mcp-server", "The MCP server, built as a standalone launcher."],
  ["LokiAI Desktop UI/", "The React and Vite renderer, the accepted visual baseline."],
  ["Docs/", "The specifications. Start with Docs/README.md."],
  ["tools/", "Repository scripts."],
];

const ENGINEERING = [
  "Spec first. The documents in Docs/ define the behaviour, and the code has to match them. A change to behaviour updates the spec and its tests in the same change.",
  "Bounded context. Each task names the few documents it needs. Nobody loads everything into every task.",
  "Source-of-truth order. The latest human instruction comes first, then the task packet, accepted decisions and architecture, the security, build, cloud and stack documents, the spec, and the product requirements. A contradiction that touches safety or contracts is raised, not guessed.",
];

function Developers() {
  return (
    <>
      <PageHero
        eyebrow="Developers"
        title="One MCP server. Scoped tools. No shell."
        lede="Coding agents reach LokiAI through a single, provider-neutral MCP server. This page covers how they connect, what they can call, how the repository is laid out and what is still to build."
        meta={["MCP server", "Rust runtime", "Electron shell", "In development"]}
        scene="gateway"
        sceneLabel="Pixel animation of a gateway computer linked to four devices, one of them flashing an alert"
        note={
          <>
            (01) Source is public.
            <br />
            Read before you rely.
          </>
        }
      />

      <Seam from="black" to="green" salt={11} />

      {/* CONNECT */}
      <Section id="connect" tone="field">
        <Float className="right-[4%] top-[6%]">
          (02) Same server for
          <br />
          every client.
        </Float>
        <div className="grid gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div className="min-w-0">
            <SectionHeader
              index="01"
              eyebrow="Connecting an agent"
              title="How a coding client connects"
              lede="Codex, Claude Code, Cursor and later clients use the same server and the same tools. Setup differs per client. The contract does not."
            />
            <ol className="mt-10">
              {FLOW.map(([t, d], i) => (
                <li key={t} className="grid grid-cols-[3rem_1fr] gap-4 border-t border-border py-4">
                  <span className="px text-xl">{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0">
                    <h3 className="font-serif text-xl text-foreground">{t}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-8 max-w-xl text-sm leading-relaxed text-muted-foreground">
              The server is planned as a standalone Node 24 distribution with its own launcher. It does not rely on
              Electron&apos;s embedded Node or a global install. LokiAI does not promise that every client can be
              woken automatically after an incident. That depends on the client and is labelled as such.
            </p>
          </div>
          <div className="min-w-0">
            <PixelScene
              scene="authority"
              cell={5}
              tone="field"
              ratio="16 / 11"
              label="Pixel animation: an agent sends a request, a gate waits for approval, then the device acts and the result is logged"
            />
          </div>
        </div>
      </Section>

      <Seam from="green" to="black" salt={12} />

      {/* RESOURCES */}
      <Section id="resources">
        <Float className="right-[4%] top-[7%]">
          (03) Projections, not
          <br />
          database rows.
        </Float>
        <SectionHeader
          index="02"
          eyebrow="Resources"
          title="What an agent can read"
          lede="Resources are projections of LokiAI state, never raw database rows or arbitrary files. The URIs below are the proposed families in the MCP spec."
        />
        <dl className="mt-12 grid gap-x-12 md:grid-cols-2">
          {RESOURCES.map(([uri, d]) => (
            <div key={uri} className="min-w-0 border-t border-border py-4">
              <dt className="break-all font-mono text-[13px] text-gold">{uri}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{d}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Seam from="black" to="green" salt={13} />

      {/* TOOLS */}
      <Section id="tools" tone="field">
        <Float className="left-[3%] top-[5%]">(04) Grouped by risk.</Float>
        <SectionHeader
          index="03"
          eyebrow="Tools"
          title="What an agent can call"
          lede="This is the proposed list. The final schemas are owned by the contracts package, so names may still change."
        />
        <div className="mt-12 grid gap-10 lg:grid-cols-3">
          {TOOL_GROUPS.map((g, i) => (
            <div key={g.risk} className="min-w-0 border-t border-border pt-5">
              <span className="px text-2xl">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-3 font-serif text-2xl text-foreground">{g.risk}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{g.note}</p>
              <ul className="mt-5 space-y-1">
                {g.tools.map((t) => (
                  <li key={t} className="break-all font-mono text-[13px] text-foreground">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Seam from="green" to="black" salt={14} />

      {/* RULES */}
      <Section id="rules">
        <Float className="right-[4%] top-[7%]">
          (05) Limits live in
          <br />
          the contract.
        </Float>
        <div className="grid gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div className="min-w-0">
            <SectionHeader
              index="04"
              eyebrow="Rules"
              title="What every tool call must obey"
              lede="These rules hold for every client. A prompt cannot change them."
            />
            <dl className="mt-10">
              {RULES.map(([t, d]) => (
                <div key={t} className="grid gap-1 border-t border-border py-5 sm:grid-cols-[13rem_1fr] sm:gap-8">
                  <dt className="font-serif text-xl text-gold">{t}</dt>
                  <dd className="text-base leading-relaxed text-muted-foreground">{d}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="min-w-0 space-y-8">
            <p className="text-sm leading-relaxed text-muted-foreground">
              The MCP spec writes the result shapes as below. They are the documented contract, not output from a
              running system.
            </p>
            <CodeBlock label="A successful read">{`{
  data,
  source,
  observed_at,
  freshness,
  correlation_id,
  next_cursor?
}`}</CodeBlock>
            <CodeBlock label="A consequential request">{`{
  outcome: "rejected" | "approval_required"
         | "accepted" | "deduplicated",
  approval_id?,
  job_id?,
  bound_request_digest?,
  policy_reason,
  correlation_id,
  status_resource?
}`}</CodeBlock>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Clients that support the MCP Tasks extension see long jobs through it. Others poll{" "}
              <Mono>loki_get_job</Mono> with the job id. Either way the runtime job stays the source of truth.
            </p>
          </div>
        </div>
      </Section>

      <Seam from="black" to="green" salt={15} />

      {/* REPOSITORY */}
      <Section id="repository" tone="field">
        <Float className="right-[4%] top-[6%]">
          (06) Rust, TypeScript,
          <br />
          one repo.
        </Float>
        <SectionHeader
          index="05"
          eyebrow="Repository"
          title="How the code is laid out"
          lede="Version 1.2.0 of the Rust workspace and the root package. The workspace has 20 crates, listed in Cargo.toml."
        />
        <div className="mt-12 grid gap-14 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="min-w-0">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Rust crates</h3>
            <ul className="mt-4 grid gap-x-10 sm:grid-cols-2">
              {CRATES.map(([n, d]) => (
                <li key={n} className="min-w-0 border-t border-border py-3">
                  <a
                    href={`${REPO_TREE}crates/${n}`}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all font-mono text-[13px] text-foreground underline underline-offset-4"
                  >
                    {n}
                  </a>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{d}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Other folders</h3>
            <dl className="mt-4">
              {LAYOUT.map(([k, v]) => (
                <div key={k} className="border-t border-border py-3">
                  <dt className="break-words font-mono text-[13px] text-foreground">{k}</dt>
                  <dd className="mt-1 text-xs leading-relaxed text-muted-foreground">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-8">
              <PixelScene
                scene="connectors"
                cell={5}
                tone="field"
                ratio="16 / 10"
                label="Pixel illustration: a device-neutral contract bar above six chip slots, one certified and five planned"
              />
            </div>
          </div>
        </div>
        <p className="mt-10 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Toolchain pins as the repository states them: Rust 1.97.1 stable with edition 2024 in{" "}
          <a href={`${REPO_BLOB}rust-toolchain.toml`} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            rust-toolchain.toml
          </a>
          , Node 24 (24.19.0 or newer, below 25) and pnpm 11 in the root package.json.
        </p>
      </Section>

      <Seam from="green" to="black" salt={16} />

      {/* WORKING ON IT */}
      <Section id="contribute">
        <Float className="right-[4%] top-[7%]">
          (07) Early. Honest
          <br />
          about it.
        </Float>
        <div className="grid gap-14 lg:grid-cols-[1fr_1fr]">
          <div className="min-w-0">
            <SectionHeader
              index="06"
              eyebrow="Working on it"
              title="The honest state of the code"
              lede="The interface baseline exists. Most of what sits behind it is implementation work."
            />
            <p className="mt-8 text-base leading-relaxed text-muted-foreground">
              To look at the interface, run <Mono>npm install</Mono> and then <Mono>npm run dev</Mono> inside the{" "}
              <Mono>LokiAI Desktop UI</Mono> folder. That starts a React and Vite preview. It is for visual
              inspection only. It does not prove sign-in, hardware access, monitoring, incidents, agent delivery,
              builds, deployments or updates.
            </p>
            <p className="mt-6 text-base leading-relaxed text-muted-foreground">
              The Electron shell, the trusted IPC, the runtime, storage, cloud integration, the MCP server and the
              real hardware paths are still to be built and verified. See the{" "}
              <Link to="/docs" hash="status" className="text-gold underline underline-offset-4">
                status section in the docs
              </Link>
              .
            </p>
          </div>
          <div className="min-w-0">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Engineering rules (AGENTS.md)
            </h3>
            <ul className="mt-4">
              {ENGINEERING.map((t) => (
                <li key={t} className="border-t border-border py-4 text-base leading-relaxed text-foreground">
                  {t}
                </li>
              ))}
            </ul>
            <p className="mt-6">
              <a
                href={`${REPO_BLOB}AGENTS.md`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs uppercase tracking-[0.2em] text-gold underline underline-offset-4"
              >
                Read AGENTS.md
              </a>
            </p>
            <div className="mt-8">
              <PixelScene
                scene="pipeline"
                cell={5}
                ratio="16 / 10"
                label="Pixel animation of a job moving through build, flash, restart, test and verify"
              />
            </div>
          </div>
        </div>
      </Section>

      <CTABlock
        title="Start with the spec, then the code."
        body="The MCP spec, the architecture and the tech stack are in the repository."
        primary={{ label: "Read the docs", to: "/docs" }}
        secondary={{ label: "View on GitHub", href: REPO_TREE }}
        tertiary={{ label: "Security model", to: "/security" }}
      />
    </>
  );
}
