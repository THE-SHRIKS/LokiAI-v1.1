import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero, Section, SectionHeader, Panel, CTABlock } from "@/components/loki/primitives";

const TITLE = "Terms — LokiAI";
const DESC =
  "The terms on which LokiAI is provided today, including service status labelling, acceptable use and model licence responsibility.";

export const Route = createFileRoute("/legal/terms")({
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
  component: Terms,
});

const CLAUSES = [
  [
    "Service status",
    "Parts of LokiAI are labelled beta or planned. Only capabilities labelled available should be relied on in production.",
  ],
  [
    "Acceptable use",
    "Do not use LokiAI to deploy models for unlawful surveillance, harassment or any purpose prohibited by the model's own licence.",
  ],
  [
    "Model licences",
    "You are responsible for complying with the licence of any model you deploy through LokiAI.",
  ],
  [
    "Your devices",
    "You are responsible for physical control of paired devices and for revoking credentials for devices you no longer control.",
  ],
  [
    "Availability",
    "We do not guarantee uninterrupted availability of the control plane. Devices already running continue to operate locally.",
  ],
  [
    "Changes",
    "These terms may change as the product changes. Material changes will be communicated to account holders.",
  ],
];

function Terms() {
  return (
    <>
      <PageHero eyebrow="Legal" title="Terms" lede="The basis on which LokiAI is provided today." />
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
