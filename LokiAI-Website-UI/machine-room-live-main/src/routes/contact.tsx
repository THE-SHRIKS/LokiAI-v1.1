import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero, Section, SectionHeader, Panel, CTABlock } from "@/components/loki/primitives";

const TITLE = "Contact — LokiAI by THE SHRIKS";
const DESC =
  "Contact THE SHRIKS about LokiAI: product support, hardware partnerships, press and investor enquiries, or private security reports.";

export const Route = createFileRoute("/contact")({
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
  component: Contact,
});

const ROUTES = [
  ["Product & support", "Questions about deployments, device pairing or model compatibility."],
  ["Hardware partnerships", "You ship devices and want a LokiAI agent for your platform."],
  ["Press & investors", "Company background, product status and roadmap context."],
  ["Security reports", "Report a suspected vulnerability privately before public disclosure."],
];

function Contact() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to THE SHRIKS"
        lede="We answer specifics better than generalities. Tell us the hardware, the workload and the constraint you are stuck on."
        meta={["Product", "Partnerships", "Press", "Security"]}
      />
      <Section>
        <SectionHeader index="01" eyebrow="Where to write" title="Pick the closest match" />
        <ul className="mt-10 grid gap-6 md:grid-cols-2">
          {ROUTES.map(([t, d]) => (
            <Panel as="li" key={t} className="h-full">
              <h2 className="font-serif text-2xl text-gold">{t}</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{d}</p>
            </Panel>
          ))}
        </ul>
        <p className="mt-10 max-w-2xl text-sm text-muted-foreground">
          Include the device class, OS version and model you are trying to deploy. That is usually
          enough for us to answer in one reply.
        </p>
      </Section>
      <CTABlock
        title="Before you write, the docs may already answer it"
        body="Pairing, compatibility and troubleshooting cover most first questions."
        primary={{ label: "Read the docs", to: "/docs" }}
        secondary={{ label: "Security overview", to: "/security" }}
      />
    </>
  );
}
