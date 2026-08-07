import { createFileRoute } from "@tanstack/react-router";
import {
  PageHero,
  Section,
  SectionHeader,
  Panel,
  StatusPill,
  CTABlock,
  type Availability,
} from "@/components/loki/primitives";

const TITLE = "Hardware — supported and planned device classes | LokiAI";
const DESC =
  "Honest status for every LokiAI device class: Android is available today, with broader IoT and Edge AI support planned.";

const PAGE_URL = "https://lokiai.theshriks.space/hardware";

export const Route = createFileRoute("/hardware")({
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
  component: Hardware,
});

type HardwareClass = {
  name: string;
  status: Availability;
  profile: string;
  runtimes: string;
  notes: string;
};

const HARDWARE_CLASSES: HardwareClass[] = [
  {
    name: "Mobile Hardware (Android)",
    status: "available",
    profile: "arm64, Android 10+, 4+ GB RAM",
    runtimes: "GGUF (CPU), TFLite (CPU / NNAPI)",
    notes: "Our current product proof. A full reference agent with QR pairing and live telemetry.",
  },
  {
    name: "IoT Hardware",
    status: "beta",
    profile: "arm64 Linux (e.g. Pi OS 64-bit)",
    runtimes: "GGUF (CPU), TFLite (CPU)",
    notes: "Headless daemons for connected endpoints. Protocol is stable, packaging is iterating.",
  },
  {
    name: "Edge AI Devices",
    status: "planned",
    profile: "Connected devices with local AI capability",
    runtimes: "Runtime support under evaluation",
    notes: "Local AI support for compatible Edge AI environments. Currently in the architecture phase.",
  },
  {
    name: "IoT Hardware",
    status: "planned",
    profile: "Connected IoT devices and gateways",
    runtimes: "Compatible local model formats",
    notes: "Private, local AI for connected environments.",
  },
  {
    name: "Lightweight IoT Devices",
    status: "planned",
    profile: "Resource-conscious IoT endpoints",
    runtimes: "Lightweight local runtimes",
    notes: "Offline AI designed for practical, connected devices.",
  },
  {
    name: "Partner Devices",
    status: "planned",
    profile: "Vendor-specific architectures",
    runtimes: "TBD per platform",
    notes: "Native integrations shipped out of the box with our hardware partners.",
  },
];

function Hardware() {
  return (
    <>
      <PageHero
        eyebrow="Hardware Trajectory"
        title="Android is the proof. Hardware is the direction."
        lede="Edge AI claims age badly. We label precisely what is available right now, what is in beta, and what represents our long-term trajectory."
        meta={["1 class available", "1 class in beta", "4 classes planned"]}
      />

      <Section>
        <SectionHeader
          index="01"
          eyebrow="Device classes"
          title="From mobile to IoT"
          lede="Compatibility is decided from the device-reported profile at deployment time, not manually guessed."
        />
        <div className="mt-12 space-y-4">
          {HARDWARE_CLASSES.map((d, i) => (
            <div key={d.name} className="grid md:grid-cols-[1fr_2fr] gap-6 items-start rounded-sm border border-border bg-plane p-6 lg:p-8">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="font-serif text-2xl text-gold">{d.name}</h3>
                </div>
                <StatusPill status={d.status} />
              </div>
              <div className="grid gap-6 sm:grid-cols-2">
                <dl className="space-y-4">
                  <div>
                    <dt className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      Target Profile
                    </dt>
                    <dd className="mt-1 text-sm font-mono text-foreground">{d.profile}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      Intended Runtimes
                    </dt>
                    <dd className="mt-1 text-sm font-mono text-foreground">{d.runtimes}</dd>
                  </div>
                </dl>
                <div className="border-t border-border pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {d.notes}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeader index="02" eyebrow="How we label" title="Three words, used strictly" />
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {[
            [
              "Available",
              "Shipping, supported and safe to build on. Breaking changes are versioned.",
            ],
            [
              "Beta",
              "Usable, but the agent, packaging or profile may change without a migration path.",
            ],
            ["Planned", "Design or research only. No agent exists you can install."],
          ].map(([t, d]) => (
            <Panel key={t} className="h-full">
              <h3 className="font-serif text-2xl text-foreground">{t}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{d}</p>
            </Panel>
          ))}
        </div>
      </Section>

      <CTABlock
        title="Have hardware we should support?"
        body="If you ship devices and want a LokiAI agent for them, tell us the platform, the runtime constraints and the volume."
        primary={{ label: "Contact us", to: "/contact" }}
        secondary={{ label: "Read the platform overview", to: "/platform" }}
        tertiary={null}
      />
    </>
  );
}
