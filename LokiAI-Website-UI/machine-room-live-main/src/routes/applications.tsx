import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero, Section, SectionHeader, Panel, CTABlock } from "@/components/loki/primitives";
import { BulletList } from "@/components/loki/diagrams";

const TITLE = "Applications — on-device AI by use case and industry | LokiAI";
const DESC =
  "Where LokiAI deployments are used: offline assistants, local analysis, audio classification, anomaly detection, IoT intelligence and Edge AI workflows.";

export const Route = createFileRoute("/applications")({
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
  component: Applications,
});

function Applications() {
  return (
    <>
      <PageHero
        eyebrow="Applications"
        title="Workloads that belong on the device, not in a datacentre"
        lede="Grouped by what the model does and by the industries that ask for it most. Availability always depends on the target device profile."
        meta={["Detection", "Classification", "Language", "Audio"]}
      />

      <Section>
        <SectionHeader index="01" eyebrow="By workload" title="What the model is asked to do" />
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Panel key="Offline assistants" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Offline assistants</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              On-device chat, summarisation and structured extraction where connectivity is
              unreliable or prohibited.
            </p>
          </Panel>
          <Panel key="Local analysis" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Local analysis</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Useful local understanding that remains in the environment where it is needed.
            </p>
          </Panel>
          <Panel key="Private workflows" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Private workflows</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              On-device AI workflows that keep sensitive inputs private by default.
            </p>
          </Panel>
          <Panel key="Audio classification" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Audio classification</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Alarm, speech and machine-sound events on low-power boards.
            </p>
          </Panel>
          <Panel key="Anomaly detection" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Anomaly detection</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Baseline drift on sensor, vibration and current streams, evaluated locally.
            </p>
          </Panel>
          <Panel key="Local automation" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Local automation</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Local triggers and actions derived directly from on-device model output.
            </p>
          </Panel>
        </div>
      </Section>

      <Section>
        <SectionHeader index="02" eyebrow="By environment" title="Where local AI is useful" />
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Panel key="IoT environments" className="h-full">
            <h3 className="font-serif text-2xl text-gold">IoT environments</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Connected devices that benefit from private, responsive local intelligence.
            </p>
          </Panel>
          <Panel key="Private operations" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Private operations</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Local workflows that avoid sending sensitive inputs to external services.
            </p>
          </Panel>
          <Panel key="Field operations" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Field operations</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Offline assistants on phones carried into sites without reliable networks.
            </p>
          </Panel>
          <Panel key="Edge AI" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Edge AI</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Reliable local model execution when connectivity is limited or unavailable.
            </p>
          </Panel>
          <Panel key="Retail & logistics" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Retail & logistics</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Counting, presence and condition checks on existing handheld hardware.
            </p>
          </Panel>
          <Panel key="Research & prototyping" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Research & prototyping</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              A fast path from a model repository to a real device for evaluation.
            </p>
          </Panel>
        </div>
      </Section>

      <Section>
        <SectionHeader index="03" eyebrow="Honest scope" title="What we do not claim" />
        <div className="mt-10 max-w-3xl">
          <BulletList
            items={[
              "LokiAI does not train models — it deploys and operates existing ones.",
              "A workload is only viable if the device profile can actually load and run the artifact.",
              "Large language models on constrained boards remain slow; quantisation is a trade, not a fix.",
              "Planned device classes cannot run any of these workloads yet.",
            ]}
          />
        </div>
      </Section>

      <CTABlock
        title="Tell us the workload and the hardware"
        body="We will say honestly whether a current device class and runtime can carry it."
        primary={{ label: "Contact us", to: "/contact" }}
        secondary={{ label: "See hardware status", to: "/hardware" }}
      />
    </>
  );
}
