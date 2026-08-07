import { createFileRoute } from "@tanstack/react-router";
import { PageHero, Section, SectionHeader, Panel, CTABlock } from "@/components/loki/primitives";
import { AgentTree, BulletList } from "@/components/loki/diagrams";

const TITLE = "Platform — LokiAI control plane and device agents";
const DESC =
  "The LokiAI platform: control plane, device agents, model verification, hardware profiling, runtime selection, deployment engine, observability and recovery.";

const PAGE_URL = "https://lokiai.theshriks.space/platform";

export const Route = createFileRoute("/platform")({
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
  component: Platform,
});

const SUBSYSTEMS = [
  [
    "Control plane",
    "Holds accounts, devices, model records and deployment state. Issues credentials, never handles inference data.",
  ],
  [
    "Device agents",
    "Per-platform clients that report capability, receive instructions and execute deployments locally.",
  ],
  [
    "Model verification",
    "Resolves a repository to one exact artifact and records format, size, runtime and URL evidence.",
  ],
  [
    "Hardware profiling",
    "Reads chipset, memory headroom, accelerators, OS version and runtime support from the device itself.",
  ],
  [
    "Runtime selection",
    "Chooses the adapter that can actually load the artifact on that profile, or refuses.",
  ],
  [
    "Deployment engine",
    "Sequences credential issue, direct download, integrity check, load and activation.",
  ],
  [
    "Observability",
    "Streams state transitions and failures per deployment, retained as an auditable record.",
  ],
  [
    "Recovery",
    "Resumable transfers, safe re-pairing, credential revocation and rollback to the last good artifact.",
  ],
];

const AGENTS = [
  {
    name: "Android Agent",
    status: "available" as const,
    detail: "Reference implementation of the agent protocol.",
  },
  {
    name: "Linux ARM Agent",
    status: "beta" as const,
    detail: "Headless daemon, same protocol, systemd unit.",
  },
  {
    name: "Raspberry Pi Agent",
    status: "beta" as const,
    detail: "Pi-specific profiles and thermal reporting.",
  },
  {
    name: "Edge AI Agent",
    status: "planned" as const,
    detail: "Local runtime support in design.",
  },
  {
    name: "IoT Agent",
    status: "planned" as const,
    detail: "Local AI support for connected IoT environments.",
  },
  {
    name: "Partner Agents",
    status: "planned" as const,
    detail: "Additional support through partner integrations.",
  },
];

function Platform() {
  return (
    <>
      <PageHero
        eyebrow="Platform"
        title="One control plane. Many device agents. No cables."
        lede="The platform separates decision-making from execution. The control plane decides what should run where; the agent on the device does the running."
        meta={["Device-agnostic protocol", "Verified artifacts", "Streamed deployment state"]}
      />

      <Section>
        <SectionHeader
          index="01"
          eyebrow="Subsystems"
          title="Eight parts, one deployment path"
          lede="Each subsystem has a narrow job. A deployment fails loudly at the first one that cannot proceed."
        />
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {SUBSYSTEMS.map(([t, d], i) => (
            <Panel key={t} className="h-full">
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-2 font-serif text-2xl text-gold">{t}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{d}</p>
            </Panel>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeader
          index="02"
          eyebrow="Agent surface"
          title="Every device class speaks the same protocol"
          lede="Adding hardware means adding an agent, not rewriting the platform."
        />
        <div className="mt-12">
          <AgentTree agents={AGENTS} />
        </div>
      </Section>

      <Section>
        <div className="grid gap-12 lg:grid-cols-2">
          <SectionHeader
            index="03"
            eyebrow="Boundaries"
            title="What the control plane never does"
          />
          <BulletList
            items={[
              "It does not proxy model weights — devices download directly from the source CDN.",
              "It does not receive inference inputs — prompts, frames and audio stay on the device.",
              "It does not return raw provider secrets to the browser.",
              "It does not silently substitute a different artifact than the one recorded.",
              "It does not assume hardware capability that the agent has not reported.",
            ]}
          />
        </div>
      </Section>

      <CTABlock
        title="Understand the architecture before you integrate"
        body="The developer overview covers the agent protocol, runtime adapters and deployment events."
        primary={{ label: "Developer overview", to: "/developers" }}
        secondary={{ label: "Security model", to: "/security" }}
      />
    </>
  );
}
