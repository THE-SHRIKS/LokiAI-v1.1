import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero, Section, SectionHeader, Panel, CTABlock } from "@/components/loki/primitives";
import { BulletList } from "@/components/loki/diagrams";

const TITLE = "Applications — on-device AI by use case and industry | LokiAI";
const DESC =
  "Where LokiAI deployments are used: offline assistants, detection, audio classification, industrial inspection, smart cameras, anomaly detection, robotics and edge automation.";

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
          <Panel key="Object detection" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Object detection</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Presence, counting and zone logic running on cameras and phones already installed on
              site.
            </p>
          </Panel>
          <Panel key="Face detection" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Face detection</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Local detection for access and safety flows, with frames never leaving the device.
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
          <Panel key="Edge automation" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Edge automation</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Local triggers and actions derived directly from on-device model output.
            </p>
          </Panel>
        </div>
      </Section>

      <Section>
        <SectionHeader index="02" eyebrow="By industry" title="Who asks for these deployments" />
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Panel key="Manufacturing" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Manufacturing</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Inspection and anomaly detection close to the line, with no cloud round trip per part.
            </p>
          </Panel>
          <Panel key="Physical security" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Physical security</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Smart cameras that classify locally and forward events instead of video.
            </p>
          </Panel>
          <Panel key="Field operations" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Field operations</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Offline assistants on phones carried into sites without reliable networks.
            </p>
          </Panel>
          <Panel key="Robotics" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Robotics</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Perception loops that must keep running when the uplink drops.
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
