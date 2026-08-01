import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero, Section, SectionHeader, Panel, CTABlock } from "@/components/loki/primitives";
import { BulletList } from "@/components/loki/diagrams";

const TITLE = "Company — THE SHRIKS, the team behind LokiAI";
const DESC =
  "Why LokiAI exists, what we believe about local-first AI on real hardware, and how to reach THE SHRIKS for partnerships, press or investment.";

export const Route = createFileRoute("/company")({
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
  component: Company,
});

function Company() {
  return (
    <>
      <PageHero
        eyebrow="Company"
        title="THE SHRIKS"
        lede="We build the layer between a model repository and a device that has to run it. LokiAI started because that step is still done by hand, badly, almost everywhere."
        meta={["Founded by THE SHRIKS", "Local-first by default", "Hardware partnerships welcome"]}
      />

      <Section>
        <SectionHeader
          index="01"
          eyebrow="Mission"
          title="Make capable hardware useful without an embedded ML team"
        />
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Panel key="The problem" className="h-full">
            <h3 className="font-serif text-2xl text-gold">The problem</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Choosing a model, a quantisation, a runtime and a deployment path takes specialist
              knowledge most teams do not have in house.
            </p>
          </Panel>
          <Panel key="Our approach" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Our approach</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Profile the real device, verify the exact artifact, deploy it wirelessly and keep the
              evidence.
            </p>
          </Panel>
          <Panel key="Why now" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Why now</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Quantised models finally run usefully on commodity phones and boards, and the hardware
              is already deployed in the field.
            </p>
          </Panel>
        </div>
      </Section>

      <Section>
        <SectionHeader index="02" eyebrow="How we work" title="Principles we hold to" />
        <div className="mt-10 max-w-3xl">
          <BulletList
            items={[
              "State availability honestly: available, beta or planned, with no blurring between them.",
              "Keep inference local unless there is a stated reason not to.",
              "Record what was deployed, so an operator can answer questions months later.",
              "Add hardware by adding agents, never by special-casing the control plane.",
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionHeader index="03" eyebrow="Contact" title="Reach the right person" />
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Panel key="General & product" className="h-full">
            <h3 className="font-serif text-2xl text-gold">General & product</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Questions about the platform, device support or a deployment you are planning.
            </p>
          </Panel>
          <Panel key="Partnerships" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Partnerships</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Hardware vendors and integrators who want a LokiAI agent for their platform.
            </p>
          </Panel>
          <Panel key="Press & investors" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Press & investors</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Company background, product status and roadmap context.
            </p>
          </Panel>
          <Panel key="Careers" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Careers</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              We are small. If you work on runtimes, embedded systems or device fleets, introduce
              yourself.
            </p>
          </Panel>
        </div>
      </Section>

      <CTABlock
        title="Talk to THE SHRIKS"
        body="Tell us what hardware you have and what you want it to do."
        primary={{ label: "Contact us", to: "/contact" }}
        secondary={{ label: "Read the docs", to: "/docs" }}
      />
    </>
  );
}
