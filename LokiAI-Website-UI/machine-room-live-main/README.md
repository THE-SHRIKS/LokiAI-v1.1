# Machine Room Live

Build a never-seen-before single-page vertical website for LokiAI by THE SHRIKS.

This is not a normal SaaS landing page.
This is not a dashboard preview.
This is not an AI startup website.
This should feel like entering a black engineering chamber where a real ML/DL machine is being assembled, inspected, activated, and finally handed to the user as a desktop app.

The only CTA is:

Download LokiAI Desktop

No login.
No pricing.
No generic features grid.
No navbar.
No testimonials.
No fake screenshots.
No smiling people.
No 3D robot.
No AI brain.
No neon cyberpunk.
No purple-blue gradients.
No cards grid.
No “powered by AI” hype.

The site must feel like something designed by a serious technical studio that does not beg for attention.

Product truth:

LokiAI is a local-first ML/DL operating system.
The user describes an ML/DL goal in plain English.
LokiAI converts it into a validated workflow: problem specification, dataset checks, runtime checks, plan generation, approval-gated execution, experiment tracking, logs, metrics, checkpoints, artifacts, and provenance.

It must never imply fake results.
It must never imply fabricated metrics.
It must never imply cloud-only execution.
It must never imply chatbot-wrapper behavior.
It must communicate: real work, real validation, real execution, real artifacts.

Use this exact visual direction:

THE BLACK MACHINE ROOM

The entire website is a vertical descent through a silent machine room.
Every section reveals one layer of the LokiAI system.
The user is not reading marketing copy.
The user is watching a machine become operational.

The page should have 8 major vertical sections, each at least 100vh.
No horizontal scroll.
No traditional layout.
Each section should feel like a different chamber of the same machine.

Color palette:

--black: #030303
--deep-black: #080808
--olive: #6b8c42
--sage: #8ab55a
--light-sage: #a8c878
--cream: #e8d9a8
--cream-dim: rgba(232,217,168,0.16)
--cream-faint: rgba(232,217,168,0.06)
--olive-dim: rgba(107,140,66,0.14)

Strict rules:

Use black as the dominant color, at least 85% of the page.
Use cream only for text, lines, measurement labels, and quiet UI.
Use olive only for active system states, validation signals, and the final download emphasis.
No white.
No gray.
No colorful gradients.
No glowing blobs.
No generic glassmorphism.

Typography:

Load Google Fonts:

Display: “Cormorant Garamond” weights 300, 400, 600
Mono: “IBM Plex Mono” weights 300, 400, 500

Typography rules:

Huge serif headlines.
Tiny mono labels.
Sparse copy.
Use negative space heavily.
Most sections should have fewer than 45 words.
The visual system must carry the meaning.

Global page behavior:

Use Lenis smooth scroll.
Use GSAP and ScrollTrigger.
All movement must feel slow, expensive, mechanical, and intentional.
No bouncy startup animations.
No cartoon easing.
Use mostly expo.out, power3.out, and slow scrubbed motion.

The site should feel quiet, cinematic, technical, and dangerous in a controlled way.

Persistent UI:

No navbar.

Instead:

Left edge:
A fixed vertical label:
“LOKIAI / LOCAL-FIRST ML/DL OS”
Rotated -90deg.
IBM Plex Mono, 9px, cream at 18% opacity.

Right edge:
A fixed vertical download trigger:
“DOWNLOAD DESKTOP ↓”
Rotated 90deg.
IBM Plex Mono, 9px, cream at 22% opacity.
On click, smooth scroll to final section.

Bottom left:
A tiny live system status:
“STATUS: AWAITING GOAL”
It changes as sections scroll:
“INTAKE READY”
“DATASET CHECK”
“PLAN LOCKED”
“GPU REQUIRED”
“ARTIFACT MODE”
“READY TO DOWNLOAD”

This status update should be subtle, not flashy.

Custom cursor:

A small technical inspection reticle, not a circle.
It should look like a targeting/measuring tool:

1px horizontal line

1px vertical line

tiny center dot

cream at 70% opacity

Follow mouse with GSAP quickTo.
On hovering buttons or interactive machine elements, reticle expands slightly and four tiny corner brackets appear.

Global texture:

Add a fixed grain layer using SVG turbulence.
Opacity: 0.025.
Very subtle.
No visible noise pattern repetition.

Add a faint “scanline drift” overlay:
A single barely visible horizontal line moving down the screen every 14 seconds.
Opacity: 0.035.
This should feel like equipment calibration, not cyberpunk.

SECTION 01 — COLD OPEN / THE MACHINE IS OFF

Height: 100vh.

The screen begins almost empty.

Background: pure #030303.

Center of screen:
A massive typographic object, not normal text.

Text:
“LOKI”
on one line, huge Cormorant Garamond 300, clamp(120px, 18vw, 260px).

Below it, offset right:
“AI”
huge, but outlined only, transparent fill, 1px cream stroke at 18% opacity.

The letters should be partly cropped by viewport edges.

Very minimal supporting copy:

Top left, 7vw / 8vh:
“ML / DL OPERATING SYSTEM”
IBM Plex Mono 10px, cream 35%.

Bottom right, 7vw / 10vh:
“Plan. Validate. Execute. Register.”
IBM Plex Mono 10px, cream 28%.

Center behind the typography:
A barely visible mechanical iris made from 12 thin radial blades.
Build this with CSS or SVG.
The iris is closed at page load.

Animation:

On load:

black screen for 0.35s

tiny center dot appears

iris blades rotate open slightly, not fully

“LOKI” reveals from darkness using clip-path

“AI” outline draws itself slowly

no big hero copy

no CTA yet

The first screen should create curiosity, not explain everything.

SECTION 02 — THE USER GOAL ENTERS THE MACHINE

Height: 110vh.

Visual concept:
The visitor sees a single sentence enter the machine as raw intent.

Layout:
Left 40% has sparse text.
Right 60% has a vertical mechanical intake rail.

Left text:

Label:
“01 / INTAKE”

Headline:
“Say the goal.
The system builds the contract.”

Body:
“LokiAI starts from intent, but never stops at conversation.”

Right visual:

Create a tall vertical rail from top to bottom.
It should look like a precision transport channel, not a timeline.

Inside the rail, a single moving capsule contains this text:

“Train a churn-risk model on customer support data.”

The capsule slowly travels downward as user scrolls through the section.

As it moves, small mechanical labels attach to it:

TASK: CLASSIFICATION
MODALITY: TEXT
TARGET: CHURN_RISK
STATE: PROBLEM_SPEC_CREATED

These labels should slide out from the rail like inspection tags.

Use ScrollTrigger scrub so the capsule movement is tied to scroll.

No typewriter effect.
No terminal.
No chat bubble.

SECTION 03 — DATASET TRIAL CHAMBER

Height: 120vh.

Visual concept:
The dataset is treated like an object being inspected under a dark industrial scanner.

Background:
Deep black.

Center:
A large rectangular inspection table, 60vw wide, 46vh high.
It should look like a scientific scanning bed made of thin cream lines.

On the table:
Abstract dataset “blocks” represented by hundreds of tiny cream/olive dots arranged in irregular columns.
Not a chart. Not a table.
It should look like a material sample being scanned.

A thin olive scanning beam moves vertically across the sample as user scrolls.

As the beam passes, labels appear around the sample:

SCHEMA DETECTED
LABEL DISTRIBUTION CHECKED
LEAKAGE RISK: NONE
MISSING VALUES: ACCEPTABLE
TRAINABILITY: USABLE

Use small mono labels connected by thin leader lines.

Left side:
Huge faint background word:
“VALIDATE”
Cormorant 600, 18vw, cream at 3% opacity, cropped.

Foreground copy:

Label:
“02 / VALIDATION”

Headline:
“Bad data stops here.”

Body:
“Execution is blocked until the dataset is understood.”

Animation:
The scan beam moves with scroll.
Dots under the scan beam briefly shift from cream-faint to olive.
Validation labels appear only after the beam crosses their region.

SECTION 04 — THE PLAN FORGE

Height: 120vh.

Visual concept:
The RunSpec is forged from multiple system fragments.

No document card.
No normal JSON panel.

Center:
A dark circular forge-like composition made only of thin technical lines.
Around it float six fragments:

DATASET
OBJECTIVE
METRIC
RUNTIME
PARAMETERS
ARTIFACTS

Each fragment is a small mono label inside a thin rectangular outline.

As the user scrolls, the fragments move toward the center and lock into a single vertical “execution spine.”

The execution spine is a tall, thin, structured object made of stacked horizontal slots.

Each slot lights subtly olive when locked:

PROBLEM_SPEC
DATA_PROFILE
RUNTIME_CHECK
MODEL_PLAN
APPROVAL_GATE
ARTIFACT_SCHEMA

Text:

Label:
“03 / PLAN”

Headline:
“Nothing runs until the plan is explicit.”

Body:
“LokiAI turns intent into an inspectable execution contract.”

Motion:
Use GSAP ScrollTrigger scrub.
Fragments should not fly randomly.
They should move like magnetized mechanical parts sliding into alignment.
Precise. Slow. Controlled.

SECTION 05 — APPROVAL GATE

Height: 100vh.

Visual concept:
A giant locked gate made from typography and linework.

The screen is divided by a massive vertical gate in the center.
Left side says:

“NO”

Right side says:

“RUN”

Both are giant serif words, cream at low opacity.

In the center is a small approval mechanism.

It is not a modal.
It is not a normal button.
It should look like a physical authorization plate.

Plate text:

APPROVAL REQUIRED
RUNSPEC: LOCKED
DATASET: VALIDATED
GPU: REQUIRED
ARTIFACT TRACKING: ENABLED

Below:
Two tiny choices:

DECLINE
APPROVE EXECUTION

Only “APPROVE EXECUTION” has olive emphasis.

On hover:
The authorization plate reveals fine mechanical details: tiny ticks, borders, measurement lines.

On scroll entering this section:
The gate stays closed.
When the user scrolls past 65% of the section, the center approval plate moves slightly forward, and the gate opens only a small amount.

It should feel serious, not gamified.

Copy:

Label:
“04 / APPROVAL”

Headline:
“Compute waits for consent.”

Body:
“No silent execution. No hidden run. No surprise compute.”

SECTION 06 — GPU EXECUTION CORE

Height: 130vh.

Visual concept:
A machine core activates.

No terminal.
No fake dashboard.
No charts that look SaaS.

Center:
A large vertical core made of layered rectangles, thin linework, and heat-like olive pulses.

The core has 4 chambers:

RUNTIME
TRAINING
CHECKPOINTS
METRICS

Each chamber is represented as an abstract mechanical bay.

Inside each bay, tiny particles move along constrained paths.
Particles should look like data packets, not magic sparks.

Side labels:

CUDA CHECK
VRAM CHECK
RUNNER ONLINE
EPOCH STATE
CHECKPOINT WRITTEN
METRIC RECORDED

Important:
Do not show CPU training.
Do not write “CPU ready.”
Use GPU-oriented language only.

Use:
“GPU REQUIRED”
“CUDA AVAILABLE”
“VRAM CHECK PASSED”
“RUNNER ONLINE”

Text:

Label:
“05 / EXECUTION”

Headline:
“The run becomes physical.”

Body:
“Execution produces logs, metrics, checkpoints, and recoverable state.”

Animation:
As user scrolls:

core outline draws

chambers activate one by one

particles begin moving

olive pulse travels from top to bottom

side labels appear as each chamber activates

Motion must be restrained and mechanical.

SECTION 07 — ARTIFACT VAULT

Height: 120vh.

Visual concept:
A dark vault opens to reveal registered outputs.

No file table.
No cards.
No list UI.

Center:
A circular vault door seen from the front, built from rings and radial locks.
It occupies 55vw.

As the user scrolls, the vault rotates open slightly.
Inside are six floating artifact seals.

Each seal is a thin geometric symbol with a label:

LOGS
METRICS
CHECKPOINT
MODEL
EVALUATION
PROVENANCE

Each seal should look like an engraved technical stamp, not an icon pack.

Around the vault, use tiny mono metadata:

RUN_ID: run_8f4a2c
ARTIFACTS: REGISTERED
STATE: PERSISTED
FABRICATION: 0
RECOVERY: AVAILABLE

Copy:

Label:
“06 / ARTIFACTS”

Headline:
“If it exists, it is registered.”

Body:
“Every output is tied to a run, a path, a state, and a reason.”

Animation:
Vault rings rotate slowly at different speeds.
Artifact seals fade in one by one as the vault opens.
No glow burst.
No treasure chest effect.

SECTION 08 — FINAL DOWNLOAD / HANDOFF

Height: 100vh.

Visual concept:
The machine has completed assembly.
Now it gives the user the desktop app.

Background:
Almost pure black.

Center:
A monolithic black slab, slightly visible through cream outline.
It should look like a physical object standing upright.

On the slab:
Tiny mono text at top:
“THE SHRIKS / LOKIAI DESKTOP”

Main text:
“Take the machine.”
Cormorant Garamond 300, huge, cream.

Below:
Button:
“DOWNLOAD LOKIAI DESKTOP ↓”

Button style:
No fill by default.
1px cream border.
Cream text.
Large horizontal padding.
On hover:
border becomes olive.
text becomes olive.
a thin olive line travels around the button border like a circuit completing.
No background fill.
No blob.
No heavy shadow.

Below button:
“macOS · Windows · Linux”
IBM Plex Mono 9px, cream 24%.

Behind the slab:
The iris from Section 01 is now fully open, but very faint.
This creates visual closure.

Footer:
Bottom left:
“© 2026 THE SHRIKS”

Bottom right:
“LOCAL-FIRST ML/DL OPERATING SYSTEM”

Animation:
On section enter:

slab outline draws

iris opens fully

headline rises slowly from darkness

button appears last

persistent bottom-left status changes to “READY TO DOWNLOAD”

INTERACTIONS

Add 5 hidden micro-interactions:

Hovering the intake capsule slightly reveals its structured metadata.

Hovering dataset dots makes nearby dots connect with faint leader lines.

Hovering the approval plate shows a tiny checksum-like string.

Hovering the GPU core increases particle speed slightly.

Hovering artifact seals reveals tiny paths like:
/runs/run_8f4a2c/artifacts/model_final

These interactions must be subtle.
No popups.
No tooltips with boxes.
Just embedded detail appearing in the design.

ANIMATION TECHNICAL REQUIREMENTS

Use:

GSAP 3
ScrollTrigger
Lenis

All JavaScript inline.
All CSS inline.
Single HTML file.
No external images.
No canvas unless necessary.
Prefer SVG and CSS for all visuals.

Lenis setup:

Use smooth vertical scrolling.
Disable horizontal scrolling completely.
Scrollbar can be hidden.

GSAP:

Use ScrollTrigger for every major section.
Use scrubbed animations for mechanical movement.
Use normal reveal animations only for text.

Performance:

The page must be production-safe.
Avoid excessive DOM particles.
Use SVG groups where possible.
Keep animations transform/opacity based.
Respect prefers-reduced-motion by reducing scrub animations and disabling cursor effects.

Responsive behavior:

Desktop is the main target.
For tablet/mobile:

keep the same visual identity

reduce oversized machinery

stack text above visual

disable complex hover-only interactions

keep download CTA visible and usable

COPY RULES

Use minimal copy.
No marketing clichés.
Do not write:
“revolutionary”
“next-gen”
“unlock your potential”
“AI-powered”
“seamless”
“supercharge”
“game-changing”

Use direct serious language.

Allowed copy style:

“Bad data stops here.”
“Compute waits for consent.”
“If it exists, it is registered.”
“The run becomes physical.”
“Take the machine.”

The website should feel like LokiAI is not asking for trust.
It is demonstrating why it deserves it.

FINAL QUALITY BAR

The first screen should make the viewer stop.

The scroll should feel like a controlled descent through a technical system.

Every visual should be product-specific.

The final site should not look like something made from a landing-page template.

It should feel like a black-box ML/DL operating system made visible for the first time.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/29d0666d-8cbd-4afd-893b-6812feaf7a01).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
