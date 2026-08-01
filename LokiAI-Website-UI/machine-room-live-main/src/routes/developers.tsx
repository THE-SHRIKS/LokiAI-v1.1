import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero, Section, SectionHeader, Panel, CTABlock } from "@/components/loki/primitives";
import { BulletList } from "@/components/loki/diagrams";

const TITLE = "Developers — architecture, APIs and the agent protocol | LokiAI";
const DESC =
  "LokiAI for engineers: control-plane architecture, agent protocol, runtime adapters, supported model formats, deployment events and the WebSocket lifecycle.";

export const Route = createFileRoute("/developers")({
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
  component: Developers,
});

function Developers() {
  return (
    <>
      <PageHero
        eyebrow="Developers"
        title="The surfaces you build against"
        lede="LokiAI is a control plane, a device agent protocol and a set of runtime adapters. Everything else is a consequence of those three."
        meta={["Agent protocol", "Runtime adapters", "Deployment events", "API in development"]}
      />

      <Section>
        <SectionHeader index="01" eyebrow="Architecture" title="Four moving parts" />
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Panel key="Control plane" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Control plane</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Accounts, devices, model records, deployment state and credential issue. Stateless
              with respect to inference.
            </p>
          </Panel>
          <Panel key="Device agent" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Device agent</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Registers capability, holds a device-scoped credential, executes deployments and
              streams state.
            </p>
          </Panel>
          <Panel key="Artifact resolver" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Artifact resolver</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Turns a repository reference into one pinned file with recorded format, size and URL
              evidence.
            </p>
          </Panel>
          <Panel key="Runtime adapter" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Runtime adapter</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              A narrow interface per runtime: load, warm, infer, release. Adding a runtime does not
              touch the control plane.
            </p>
          </Panel>
        </div>
      </Section>

      <Section>
        <SectionHeader index="02" eyebrow="Lifecycle" title="A deployment, step by step" />
        <div className="mt-10 max-w-3xl">
          <BulletList
            items={[
              "Agent authenticates over WSS with its device credential and publishes its capability profile.",
              "Control plane resolves the requested outcome to a candidate artifact and runs compatibility checks.",
              "On pass, a short-lived download instruction is issued to that device only.",
              "Agent downloads directly from the CDN, verifies integrity, then loads through the matching runtime adapter.",
              "State transitions and failure reasons are streamed back and stored with the deployment record.",
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionHeader index="03" eyebrow="Integration" title="What is open, and when" />
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Panel key="Model formats" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Model formats</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              GGUF and TFLite are deployable today. Additional formats are under evaluation.
            </p>
          </Panel>
          <Panel key="Public API" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Public API</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Account, device, model and deployment resources. In development — contact us for early
              access.
            </p>
          </Panel>
          <Panel key="SDK direction" className="h-full">
            <h3 className="font-serif text-2xl text-gold">SDK direction</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Thin clients over the same API, starting with TypeScript and Python.
            </p>
          </Panel>
          <Panel key="New device classes" className="h-full">
            <h3 className="font-serif text-2xl text-gold">New device classes</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Implement the agent protocol for your platform; the control plane needs no change.
            </p>
          </Panel>
          <Panel key="Events" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Events</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Deployment state changes are streamed, with structured failure reasons rather than
              opaque errors.
            </p>
          </Panel>
          <Panel key="Docs" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Docs</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Getting started, pairing, compatibility and troubleshooting are maintained alongside
              the agent.
            </p>
          </Panel>
        </div>
      </Section>

      <CTABlock
        title="Building on LokiAI or porting an agent?"
        body="Start with the docs, then contact us with the platform you are targeting."
        primary={{ label: "Read the docs", to: "/docs" }}
        secondary={{ label: "Security model", to: "/security" }}
      />
    </>
  );
}
