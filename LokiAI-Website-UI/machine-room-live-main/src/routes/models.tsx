import { createFileRoute } from "@tanstack/react-router";
import { PageHero, Section, SectionHeader, Panel, CTABlock } from "@/components/loki/primitives";
import { VerificationReadout, BulletList } from "@/components/loki/diagrams";

const TITLE = "Models — discovery, verification and formats | LokiAI";
const DESC =
  "How LokiAI resolves a Hugging Face repository to one verified GGUF or TFLite artifact, checks it against the device profile and selects a local runtime.";

const PAGE_URL = "https://lokiai.theshriks.space/models";

export const Route = createFileRoute("/models")({
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
  component: Models,
});

const ROWS = [
  { field: "Repository", value: "hf.co/<org>/<model>", verdict: "Resolved" },
  { field: "Exact file", value: "model-q4_k_m.gguf", verdict: "Pinned" },
  { field: "Format", value: "GGUF v3", verdict: "Supported" },
  { field: "Size", value: "1.94 GB", verdict: "Fits headroom" },
  { field: "Runtime", value: "llama.cpp adapter", verdict: "Available" },
  { field: "Hardware fit", value: "arm64 · 8 GB RAM", verdict: "Compatible" },
  { field: "Download URL", value: "CDN direct", verdict: "Reachable" },
];

function Models() {
  return (
    <>
      <PageHero
        eyebrow="Models"
        title="A repository is not a deployment"
        lede="Model hubs list repositories. Devices load files. LokiAI closes that gap and records how it did so."
        meta={["Hugging Face integration", "GGUF", "TFLite", "Compatibility checks"]}
      />

      <Section>
        <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr]">
          <SectionHeader
            index="01"
            eyebrow="Verification"
            title="Every deployment names one file"
            lede="Discovery may return dozens of quantisations. Only one is deployed, and the record says which."
          />
          <VerificationReadout rows={ROWS} />
        </div>
      </Section>

      <Section>
        <SectionHeader index="02" eyebrow="Formats" title="What LokiAI can load today" />
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {[
            [
              "GGUF",
              "Quantised language models via the llama.cpp adapter. Available on Android and the beta Linux agents.",
            ],
            [
              "TFLite",
              "Detection, classification and audio models. CPU everywhere, NNAPI where the device exposes it.",
            ],
            [
              "More formats",
              "Under evaluation. Not deployable yet — listed so the direction is clear.",
            ],
          ].map(([t, d]) => (
            <Panel key={t} className="h-full">
              <h3 className="font-serif text-2xl text-gold">{t}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{d}</p>
            </Panel>
          ))}
        </div>
      </Section>

      <Section>
        <div className="grid gap-12 lg:grid-cols-2">
          <SectionHeader
            index="03"
            eyebrow="Compatibility"
            title="Checks that run before a single byte is downloaded"
          />
          <BulletList
            items={[
              "Artifact size against reported free storage and memory headroom.",
              "Format against the runtimes the agent has actually registered.",
              "Architecture and OS version against the runtime's requirements.",
              "Accelerator availability, when the runtime can use one.",
              "Source reachability, so a broken URL fails fast instead of mid-transfer.",
            ]}
          />
        </div>
      </Section>

      <CTABlock
        title="Deploy a verified model to a paired device"
        primary={{ label: "Read the docs", to: "/docs" }}
        secondary={{ label: "See applications", to: "/applications" }}
      />
    </>
  );
}
