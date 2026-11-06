import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero, Section, SectionHeader, Panel, CTABlock } from "@/components/loki/primitives";
import { BulletList } from "@/components/loki/diagrams";

const TITLE = "Company — THE SHRIKS, the team behind LokiAI";
const DESC =
  "Why LokiAI exists, what we believe about local-first AI on real hardware, and how to reach THE SHRIKS for partnerships, press or investment.";

const PAGE_URL = "https://lokiai.theshriks.space/company";

export const Route = createFileRoute("/company")({
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
  component: Company,
});

function Company() {
  return (
    <>
      <PageHero
        eyebrow="Company"
        title="THE SHRIKS"
        lede="We build the layer between a coding agent and the hardware it works on. LokiAI exists because agents can edit firmware, but nothing safe sits between them and a real device."
        meta={["Founded by THE SHRIKS", "Open source", "Local-first by default"]}
      />

      <Section>
        <SectionHeader
          index="01"
          eyebrow="Mission"
          title="Let agents work on hardware without handing them the keys"
        />
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Panel key="The problem" className="h-full">
            <h3 className="font-serif text-2xl text-gold">The problem</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              A coding agent can change firmware, but raw shell or serial access is too broad, and
              ordinary monitoring tools do not connect evidence to code changes.
            </p>
          </Panel>
          <Panel key="Our approach" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Our approach</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Agents propose. LokiAI authenticates, executes, observes and records. People keep the
              final say on anything consequential.
            </p>
          </Panel>
          <Panel key="Why now" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Why now</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Agents are now writing real firmware. The step between a suggestion and a flashed
              board is where the risk sits.
            </p>
          </Panel>
        </div>
      </Section>

      <Section>
        <SectionHeader index="02" eyebrow="How we work" title="Principles we hold to" />
        <div className="mt-10 max-w-3xl">
          <BulletList
            items={[
              "State status honestly: say what works, what is in progress and what is only planned.",
              "Keep device authority in the runtime, never in the interface or in an agent.",
              "Record every consequential action, so an operator can answer questions months later.",
              "Add hardware by adding connectors, never by special-casing the shared layers.",
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
              Questions about LokiAI, device support or a project you are planning.
            </p>
          </Panel>
          <Panel key="Partnerships" className="h-full">
            <h3 className="font-serif text-2xl text-gold">Partnerships</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Hardware vendors and integrators who want a LokiAI connector for their platform.
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
              We are small. If you work on firmware, embedded systems or device fleets,
              introduce yourself.
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
