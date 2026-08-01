import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero, Section, SectionHeader, Panel, CTABlock } from "@/components/loki/primitives";
import { BulletList, SecurityBoundaryMap } from "@/components/loki/diagrams";

const TITLE = "Security — tenant isolation, device credentials and local inference | LokiAI";
const DESC =
  "The LokiAI security model: tenant isolation, encrypted provider keys, device-scoped credentials, authenticated WebSockets, strict CORS, verified artifacts and rate limits.";

export const Route = createFileRoute("/security")({
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
  component: Security,
});

function Security() {
  return (
    <>
      <PageHero
        eyebrow="Security"
        title="Controls that are enforced in the product"
        lede="This page is maintained by THE SHRIKS to answer common security questions about LokiAI. It describes controls that are implemented today, not certifications."
        meta={["Local inference", "Device-scoped credentials", "Verified artifacts"]}
      />

      <Section>
        <SectionHeader index="01" eyebrow="Access and identity" title="Strict Security Boundaries" />
        <div className="mt-10">
          <SecurityBoundaryMap />
        </div>
      </Section>

      <Section>
        <SectionHeader index="02" eyebrow="Data handling" title="Where data goes" />
        <div className="mt-10 max-w-3xl">
          <BulletList
            items={[
              "Inference inputs — prompts, frames and audio — are processed on the device and are not routed through LokiAI infrastructure.",
              "Model weights are downloaded by the device directly from the source CDN; the control plane does not proxy them.",
              "Provider keys are stored encrypted at rest and are never returned to the browser in raw form.",
              "Deployment records store artifact metadata and state transitions, not payload content.",
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionHeader index="03" eyebrow="Shared responsibility" title="Where our boundary ends" />
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Panel key="LokiAI provides" className="h-full">
            <h3 className="font-serif text-2xl text-gold">LokiAI provides</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Isolation between accounts, credential issue and revocation, artifact verification and
              transport security.
            </p>
          </Panel>
          <Panel key="You are responsible for" className="h-full">
            <h3 className="font-serif text-2xl text-gold">You are responsible for</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Physical control of paired devices, who you grant account access to, and the models
              you choose to deploy.
            </p>
          </Panel>
          <Panel key="Reporting" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Reporting</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              If you believe you have found a vulnerability, contact us before disclosing it
              publicly.
            </p>
          </Panel>
        </div>
      </Section>

      <CTABlock
        title="Security questions before a deployment?"
        body="Ask us directly — we would rather answer specifics than publish absolutes."
        primary={{ label: "Contact us", to: "/contact" }}
        secondary={{ label: "Platform overview", to: "/platform" }}
      />
    </>
  );
}
