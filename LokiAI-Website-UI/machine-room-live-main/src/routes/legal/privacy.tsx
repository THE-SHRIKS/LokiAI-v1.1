import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero, Section, SectionHeader, Panel, CTABlock } from "@/components/loki/primitives";

const TITLE = "Privacy — LokiAI";
const DESC =
  "How LokiAI handles account data, device telemetry, provider credentials and inference inputs, which stay on the device.";

export const Route = createFileRoute("/legal/privacy")({
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
  component: Privacy,
});

const CLAUSES = [
  [
    "Inference data stays local",
    "Prompts, frames and audio processed by a deployed model are handled on the device and are not routed through LokiAI infrastructure.",
  ],
  [
    "Account data",
    "We store the information needed to operate your account: identity, paired devices, model records and deployment history.",
  ],
  [
    "Provider credentials",
    "Keys you supply for model providers are stored encrypted at rest and are never returned to the browser in raw form.",
  ],
  [
    "Device telemetry",
    "Agents report hardware profile and deployment state. This is operational metadata, not payload content.",
  ],
  [
    "Retention and deletion",
    "Deployment records are retained while your account is active. Contact us to request export or deletion.",
  ],
  [
    "Third parties",
    "Model artifacts are downloaded from the source provider by your device. Their terms and logging apply to that request.",
  ],
];

function Privacy() {
  return (
    <>
      <PageHero
        eyebrow="Legal"
        title="Privacy"
        lede="How LokiAI handles account data, device records and inference inputs."
      />
      <Section>
        <div className="max-w-3xl space-y-10">
          {CLAUSES.map(([t, d], i) => (
            <article key={t}>
              <h2 className="font-serif text-3xl text-gold">
                <span className="mr-3 font-mono text-sm text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {t}
              </h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">{d}</p>
            </article>
          ))}
          <p className="border-t border-border pt-6 text-sm text-muted-foreground">
            This summary is maintained by THE SHRIKS and may be updated as the product changes. For
            the binding version applicable to a commercial agreement,{" "}
            <Link to="/contact" className="text-gold underline underline-offset-4">
              contact us
            </Link>
            .
          </p>
        </div>
      </Section>
    </>
  );
}
