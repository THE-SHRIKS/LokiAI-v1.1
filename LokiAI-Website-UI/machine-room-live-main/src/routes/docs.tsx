import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero, Section, SectionHeader, Panel, CTABlock } from "@/components/loki/primitives";

const TITLE = "Docs — LokiAI documentation";
const DESC =
  "LokiAI documentation: getting started, architecture, device pairing, model compatibility, deployments, security, API reference, troubleshooting and changelog.";

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

const SECTIONS = [
  [
    "Getting started",
    "Create an account, install the Android agent and pair your first device with a QR code.",
  ],
  ["Architecture", "How the control plane, agents, resolver and runtime adapters fit together."],
  ["Device pairing", "Pairing codes, device credentials, re-pairing and revocation."],
  [
    "Model compatibility",
    "Formats, size and memory headroom, runtime availability and why a model may be rejected.",
  ],
  [
    "Deployments",
    "Requesting a deployment, reading progress events and rolling back to a previous artifact.",
  ],
  ["Security", "Isolation, credentials, transport, CORS and what never leaves the device."],
  ["API reference", "Account, device, model and deployment resources. In development."],
  ["Troubleshooting", "Pairing failures, stalled downloads, load errors and thermal throttling."],
  ["Changelog", "Agent and control-plane releases, with breaking changes called out."],
];

function Docs() {
  return (
    <>
      <PageHero
        eyebrow="Docs"
        title="Documentation"
        lede="Written alongside the agent. Where a section is still in progress it says so rather than describing something that does not exist."
        meta={["Android agent", "Pairing", "Deployments", "API in development"]}
      />
      <Section>
        <SectionHeader index="01" eyebrow="Contents" title="Start where your problem is" />
        <ul className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {SECTIONS.map(([t, d], i) => (
            <Panel as="li" key={t} className="h-full">
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h2 className="mt-2 font-serif text-2xl text-gold">{t}</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{d}</p>
            </Panel>
          ))}
        </ul>
        <p className="mt-10 max-w-2xl text-sm text-muted-foreground">
          Sections are being published progressively. If you need something that is not here yet,{" "}
          <Link to="/contact" className="text-gold underline underline-offset-4">
            ask us
          </Link>{" "}
          and we will send it directly.
        </p>
      </Section>
      <CTABlock
        title="Pair a device and deploy your first model"
        body="The Android agent is the fastest path from zero to a model running locally."
        primary={{ label: "Open Workspace", to: "/product" }}
        secondary={{ label: "See hardware status", to: "/hardware" }}
      />
    </>
  );
}
