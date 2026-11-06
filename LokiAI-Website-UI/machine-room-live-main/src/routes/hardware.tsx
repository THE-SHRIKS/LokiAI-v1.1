import { createFileRoute } from "@tanstack/react-router";
import { CTABlock, Mono, PageHero, Section, SectionHeader, StatusPill } from "@/components/loki/primitives";
import { Float, PixelScene, Seam } from "@/components/loki/pixel";
import { REPO_BLOB } from "@/lib/links";

const TITLE = "LokiAI v1.2 hardware: connectors, the ESP32-S3 reference path, honest support levels";
const DESC =
  "LokiAI v1.2 reaches devices through a device-neutral connector contract. The first certified target is the ESP32-S3 N1R8. This page explains what certified requires and what is not claimed.";
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
  component: HardwarePage,
});

const LEVELS: [string, string, "available" | "beta" | "planned"][] = [
  ["Certified", "The exact board, connector, toolchain and required physical scenarios pass in a LokiAI release. All certified capabilities may be offered under policy.", "available"],
  ["Supported", "The connector recognises the family and passes contract tests, but not every physical revision is certified. Only declared capabilities, with caveats shown.", "beta"],
  ["Custom", "A user or team supplies the connector. It is isolated and labelled, with no LokiAI certification claim.", "planned"],
  ["Unsupported", "A transport was seen but no connector matches. LokiAI shows the reason and offers no device-changing actions.", "planned"],
];

const MAY_NOT = [
  "Access OAuth or agent credentials.",
  "Decide authorisation or approval.",
  "Write the domain database or the activity stream directly.",
  "Accept shell fragments from the renderer or an agent.",
  "Touch undeclared targets or operations.",
  "Report that a deployment or incident is complete.",
  "Keep changing a device after losing the job lease.",
];

const CERT = [
  "Discovery, with stable chip and board evidence.",
  "Permission, busy and disconnect behaviour on the transport.",
  "Firmware and build metadata.",
  "Real health and log sources that the board and firmware provide.",
  "Image and partition compatibility checks.",
  "Boot, reset and flash sequence, with digest and readback checks where available.",
  "Restart, re-identification and test observation after a flash.",
  "Interruption and recovery at safe, controlled test points.",
  "A rollback or recovery policy, and a physical operator record.",
];

const CONFIRM = [
  "Exact module marking and board name and revision.",
  "Flash size and PSRAM configuration implied by the real SKU.",
  "USB interface or bridge, and boot and reset wiring.",
  "Permitted operating voltage and power setup.",
  "Build framework, partition and bootloader ownership.",
  "Recovery access and the known-good artifact policy.",
];

const HEALTH = [
  ["Status", "Each check is passed, warning, failed, unavailable or interrupted."],
  ["Evidence", "Value, unit, threshold, observed time, received time and a reference to the source."],
  ["Honesty", "If the board has no source for voltage, heat, memory or bus health, the check returns unavailable with a reason. It is never guessed."],
  ["Telemetry and logs", "Timestamped, bounded, and tagged with source quality. Connection gaps are shown, not hidden."],
];

const NOT_CLAIMED = [
  "Other device families in the interface are not certified. Showing a family is not support for it.",
  "Boards other than the confirmed ESP32-S3 N1R8 SKU are not promised.",
  "Cameras and fleet-scale edge assets are an architectural direction, not a v1.2 feature.",
  "The hardware path is implementation work. Nothing here says it has passed physical certification.",
];

function HardwarePage() {
  return (
    <>
      <PageHero
        eyebrow="Hardware · v1.2"
        title="One certified board, a contract for the rest"
        lede="Shared LokiAI code never knows what a chip is. Each device family lives in its own connector. The first connector targets the ESP32-S3 N1R8 board."
        meta={["ESP32-S3 N1R8 first", "Device-neutral contract", "Not yet certified"]}
        scene="connectors"
        sceneLabel="Pixel illustration: a device-neutral contract bar above six chip slots, one certified and five planned"
        note={<>(01) Only one slot<br />is the target.</>}
      />

      <Seam from="black" to="green" salt={21} />

      <Section id="contract" tone="field">
        <Float className="right-[4%] top-[6%]">(02) Shared layers stay<br />device-neutral.</Float>
        <div className="grid gap-14 lg:grid-cols-[1fr_1fr] lg:items-start">
          <div className="min-w-0">
            <SectionHeader
              index="01"
              eyebrow="The connector contract"
              title="Support many chips without bending the core"
              lede="A connector turns a declared LokiAI operation into verified behaviour for one device family and transport. It does not get general authority over the platform."
            />
            <p className="mt-6 text-base leading-relaxed text-muted-foreground">
              Chip-specific commands, partitions, probes and recovery steps stay in the connector package. No shared
              interface may be named or shaped around ESP32-only ideas.
            </p>
          </div>
          <div className="min-w-0">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">A connector must not</h3>
            <ul className="mt-3">
              {MAY_NOT.map((m) => (
                <li key={m} className="border-t border-border py-3 text-base leading-relaxed text-foreground">
                  {m}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <dl className="mt-16">
          {LEVELS.map(([t, d, s]) => (
            <div key={t} className="grid gap-2 border-t border-border py-5 md:grid-cols-[12rem_1fr_auto] md:items-start md:gap-8">
              <dt className="font-serif text-xl text-foreground">{t}</dt>
              <dd className="min-w-0 text-base leading-relaxed text-muted-foreground">{d}</dd>
              <div>
                <StatusPill status={s} labels={{ available: "Target", beta: "Later", planned: "Not claimed" }} />
              </div>
            </div>
          ))}
        </dl>
      </Section>

      <Seam from="green" to="black" salt={22} />

      <Section id="esp32">
        <Float className="right-[4%] top-[6%]">(03) Confirm the board,<br />then build the path.</Float>
        <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div className="min-w-0">
            <PixelScene
              scene="board"
              cell={5}
              ratio="16 / 11"
              label="Pixel illustration of an ESP32-S3 development board with a USB cable, header pins and blinking LEDs"
            />
            <p className="mt-4 font-mono text-[11px] uppercase leading-relaxed tracking-[0.14em] text-muted-foreground">
              Reference target: ESP32-S3 N1R8.
            </p>
          </div>
          <div className="min-w-0">
            <SectionHeader
              index="02"
              eyebrow="Reference path"
              title="What “certified” requires"
              lede="Implementation is blocked until a human confirms the exact board. After that, certification has to cover all of this on physical hardware."
            />
            <ol className="mt-10">
              {CERT.map((c, i) => (
                <li key={c} className="grid grid-cols-[3rem_1fr] gap-4 border-t border-border py-3">
                  <span className="px text-xl text-gold">{String(i + 1).padStart(2, "0")}</span>
                  <p className="min-w-0 text-base leading-relaxed text-muted-foreground">{c}</p>
                </li>
              ))}
            </ol>
            <h3 className="mt-12 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              To be confirmed first
            </h3>
            <ul className="mt-3">
              {CONFIRM.map((c) => (
                <li key={c} className="border-t border-border py-3 text-sm leading-relaxed text-foreground">
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Seam from="black" to="green" salt={23} />

      <Section id="identity" tone="field">
        <Float className="left-[3%] top-[5%]">(04) A COM port is<br />not an identity.</Float>
        <div className="grid gap-14 lg:grid-cols-2">
          <div className="min-w-0">
            <SectionHeader
              index="03"
              eyebrow="Discovery and identity"
              title="Find it, prove it, then re-check it"
              lede="Discovery has two steps. Neither one changes the device."
            />
            <dl className="mt-10">
              <div className="border-t border-border py-4">
                <dt className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  <Mono>probe</Mono>
                </dt>
                <dd className="mt-2 text-base leading-relaxed text-foreground">
                  Observe candidate transports and record the evidence and confidence.
                </dd>
              </div>
              <div className="border-t border-border py-4">
                <dt className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  <Mono>identify</Mono>
                </dt>
                <dd className="mt-2 text-base leading-relaxed text-foreground">
                  Ask the device bounded, family-specific questions. Return a stable identity or a structured
                  unsupported, permission, busy or error result.
                </dd>
              </div>
            </dl>
          </div>
          <ul className="min-w-0 self-end">
            <li className="border-t border-border py-4 text-base leading-relaxed text-foreground">
              A COM port, IP address, BLE address or probe index is never a stable identity.
            </li>
            <li className="border-t border-border py-4 text-base leading-relaxed text-foreground">
              Every identity records the connector, its version, the method, the time and the confidence.
            </li>
            <li className="border-t border-border py-4 text-base leading-relaxed text-foreground">
              Discovery makes a candidate, not an owned device. Consequential actions stay off until it is enrolled
              through a one-time, challenge-bound step.
            </li>
            <li className="border-t border-border py-4 text-base leading-relaxed text-foreground">
              Before any change, the connector re-identifies the target and the runtime compares it to the approved
              snapshot.
            </li>
          </ul>
        </div>
      </Section>

      <Seam from="green" to="black" salt={24} />

      <Section id="health">
        <Float className="right-[4%] top-[7%]">(05) Unavailable beats<br />a made-up number.</Float>
        <div className="grid gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="min-w-0">
            <SectionHeader
              index="04"
              eyebrow="Health, telemetry and logs"
              title="Only what the board can really tell us"
              lede="Health reports follow a fixed shape, so the interface and agents read every connector the same way."
            />
            <dl className="mt-10">
              {HEALTH.map(([k, v]) => (
                <div key={k} className="grid gap-1 border-t border-border py-4 sm:grid-cols-[10rem_1fr] sm:gap-8">
                  <dt className="font-serif text-xl text-gold">{k}</dt>
                  <dd className="text-base leading-relaxed text-muted-foreground">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="min-w-0">
            <PixelScene
              scene="telemetry"
              cell={5}
              ratio="16 / 9"
              label="Pixel animation of a telemetry signal crossing a threshold and raising a flag"
            />
          </div>
        </div>
      </Section>

      <Seam from="black" to="green" salt={25} />

      <Section id="gateway" tone="field">
        <Float className="right-[4%] top-[6%]">(06) The window is a view.<br />The runtime watches.</Float>
        <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div className="min-w-0">
            <PixelScene
              scene="gateway"
              cell={5}
              tone="field"
              ratio="16 / 12"
              label="Pixel animation of a gateway computer linked to four devices, one of them flashing an alert"
            />
          </div>
          <div className="min-w-0">
            <SectionHeader
              index="05"
              eyebrow="Gateway direction"
              title="Monitoring that does not need the window"
              lede="Hardware and long-running monitoring run in a separate Rust runtime, not in the desktop window. Jobs survive a reload or closing the app."
            />
            <ul className="mt-8 text-base leading-relaxed text-muted-foreground">
              <li className="border-t border-border py-4">
                Runtime health is shown apart from device health, so an offline observer is not reported as a healthy
                device.
              </li>
              <li className="border-t border-border py-4">
                The same runtime is meant to be deployable to an always-on gateway later. That is a direction, not a
                v1.2 deliverable.
              </li>
            </ul>
          </div>
        </div>
      </Section>

      <Seam from="green" to="black" salt={26} />

      <Section id="not-claimed">
        <Float className="right-[4%] top-[7%]">(07) Said plainly.</Float>
        <div className="grid gap-14 lg:grid-cols-2">
          <SectionHeader
            index="06"
            eyebrow="Not claimed"
            title="What this page does not promise"
            lede={
              <>
                The connector rules are in{" "}
                <a href={`${REPO_BLOB}Docs/CONNECTOR_SPEC.md`} target="_blank" rel="noreferrer" className="text-gold underline underline-offset-4">
                  CONNECTOR_SPEC.md
                </a>
                .
              </>
            }
          />
          <ul className="min-w-0">
            {NOT_CLAIMED.map((n) => (
              <li key={n} className="border-t border-border py-4 text-base leading-relaxed text-foreground">
                {n}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <CTABlock
        title="Bring a board, or read the contract"
        body="If you have an ESP32-S3 N1R8 and want to follow or test the reference path, start with the repository."
      />
    </>
  );
}
