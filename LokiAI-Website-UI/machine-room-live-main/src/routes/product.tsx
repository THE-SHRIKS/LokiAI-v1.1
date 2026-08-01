import { createFileRoute } from "@tanstack/react-router";
import {
  PageHero,
  Section,
  SectionHeader,
  Panel,
  CTABlock,
  KeyValue,
} from "@/components/loki/primitives";
import { ExecutionPath, BulletList } from "@/components/loki/diagrams";

const TITLE = "Product — LokiAI intent-to-execution workflow";
const DESC =
  "How a LokiAI deployment works end to end: describe the outcome, profile the device, verify the artifact, deploy wirelessly and run locally.";

export const Route = createFileRoute("/product")({
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
  component: Product,
});

function Product() {
  return (
    <>
      <PageHero
        eyebrow="Product"
        title="From a sentence to a model running on your hardware"
        lede="LokiAI removes the part of edge AI that stops most teams: choosing a model that will actually load, on a device that will actually run it, without wiring anything up."
        meta={["Android agent available", "QR pairing", "GGUF · TFLite", "Local inference"]}
      />

      <Section>
        <SectionHeader
          index="01"
          eyebrow="The journey"
          title="One workflow, five inspectable stages"
          lede="Every stage can be reviewed after the fact. If a deployment failed, the record says which check failed and why."
        />
        <div className="mt-12">
          <ExecutionPath />
        </div>
      </Section>

      <Section>
        <div className="grid gap-12 lg:grid-cols-2">
          <SectionHeader
            index="02"
            eyebrow="Who it is for"
            title="Built for people who own hardware, not model formats"
          />
          <div className="grid gap-6">
            {[
              [
                "Product teams",
                "You have devices in the field and want on-device intelligence without hiring a specialist AI team.",
              ],
              [
                "Solo builders",
                "You have one Android phone and an idea, and you want a model on it this afternoon.",
              ],
              [
                "Hardware partners",
                "You ship devices and want a deployment story customers can use on day one.",
              ],
              [
                "Operations",
                "You need to know exactly which artifact is on which device, and when it changed.",
              ],
            ].map(([t, d]) => (
              <Panel key={t}>
                <h3 className="font-serif text-2xl text-gold">{t}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{d}</p>
              </Panel>
            ))}
          </div>
        </div>
      </Section>

      <Section>
        <div className="grid gap-12 lg:grid-cols-2">
          <SectionHeader
            index="03"
            eyebrow="What is different"
            title="Deployment is treated as an engineering record, not a button"
            lede="Most tooling stops at “here is a model.” LokiAI carries the decision through to a verified artifact on a specific device, and keeps the evidence."
          />
          <BulletList
            items={[
              "Compatibility is checked against the reported device profile before download begins.",
              "Deployments reference a pinned file, so the same deployment repeated gives the same bytes.",
              "Progress and failures are streamed, not polled from a black box.",
              "Nothing requires a cable, a developer-mode toggle or a workstation.",
              "Inference inputs never traverse LokiAI infrastructure.",
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionHeader
          index="04"
          eyebrow="What you can do today"
          title="Current capability, stated plainly"
        />
        <dl className="mt-10 grid max-w-4xl gap-x-12 sm:grid-cols-2">
          <KeyValue label="Device agent" value="Android — available" />
          <KeyValue label="Pairing" value="QR code over HTTPS/WSS" />
          <KeyValue label="Model source" value="Hugging Face repositories, verified per file" />
          <KeyValue label="Formats" value="GGUF, TFLite" />
          <KeyValue label="Discovery" value="NIM-assisted candidate ranking" />
          <KeyValue label="Isolation" value="Per-account tenancy, device-scoped credentials" />
        </dl>
      </Section>

      <CTABlock
        title="Pair a device and deploy your first model"
        body="Start with the Android agent. The workflow is the same for every device class we add."
        primary={{ label: "Read the docs", to: "/docs" }}
        secondary={{ label: "See supported hardware", to: "/hardware" }}
      />
    </>
  );
}
