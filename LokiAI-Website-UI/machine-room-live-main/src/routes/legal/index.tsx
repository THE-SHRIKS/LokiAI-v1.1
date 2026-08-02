import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero, Panel, Section } from "@/components/loki/primitives";

const TITLE = "Legal — LokiAI";
const DESC = "LokiAI legal information, including its Privacy Policy and Terms of Use.";

export const Route = createFileRoute("/legal/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
    ],
  }),
  component: Legal,
});

function Legal() {
  return (
    <>
      <PageHero
        eyebrow="LokiAI"
        title="Legal"
        lede="The policies and terms that explain how LokiAI is provided and how data is handled."
      />
      <Section>
        <div className="grid max-w-4xl gap-5 md:grid-cols-2">
          <Panel className="p-7">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-gold-dim">Privacy</p>
            <h2 className="mt-3 font-serif text-3xl text-gold">Privacy Policy</h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              How LokiAI handles account information, paired-device records, provider credentials and on-device inference inputs.
            </p>
            <Link to="/legal/privacy" className="mt-6 inline-block text-sm text-gold underline underline-offset-4">
              Read Privacy Policy
            </Link>
          </Panel>
          <Panel className="p-7">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-gold-dim">Service</p>
            <h2 className="mt-3 font-serif text-3xl text-gold">Terms of Use</h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              The terms for using LokiAI, including acceptable use, model licences, device responsibility and service availability.
            </p>
            <Link to="/legal/terms" className="mt-6 inline-block text-sm text-gold underline underline-offset-4">
              Read Terms of Use
            </Link>
          </Panel>
        </div>
        <p className="mt-10 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          These pages provide product information maintained by THE SHRIKS. For account, privacy or commercial questions, {" "}
          <Link to="/contact" className="text-gold underline underline-offset-4">contact us</Link>.
        </p>
      </Section>
    </>
  );
}
