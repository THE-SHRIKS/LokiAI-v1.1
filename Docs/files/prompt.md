# EdgeMind / LokiAI — Master Agent Prompt

Read every file in the Docs folder before doing anything:
1. `06_RULES.md` — your operating rules, follow without exception
2. `05_PLANNER.md` — your task list, work in order
3. `04_SPEC.md` — API endpoints, database schema, app behavior
4. `03_PRD.md` — product requirements
5. `02_USER_JOURNEY.md` — how users experience the product
6. `01_ARCHITECTURE.md` — system design
7. `REPORT.md` — check what is already done, write results here

You have exactly these files. They are your only source of truth. You do not think beyond these files. You do not create any additional planning files, implementation plans, notes, summaries, or any new markdown files. If it is not in these files, you do not do it.

This is a WIRELESS-ONLY architecture. There is NO USB cable. No ADB. No developer options. No Go discovery agent. The phone app installs via QR code + browser download, reads its own specs, connects to backend via WebSocket, and downloads models directly from HuggingFace CDN. If you find yourself writing ADB commands, stop — you are doing it wrong.

The mobile app codebase is at `S:\LokiAI\LokiAImobile UI` and nowhere else. Do not create new Flutter projects. Do not change the existing UI design. Only add functionality on top.

AI assistant uses NVIDIA NIM API only (meta/llama-3.1-70b-instruct). No Claude API in the backend.

Let the agents (the system components) do the work. The deployment pipeline downloads and serves. The phone app scans, registers, downloads, and runs inference. The backend orchestrates. You wire them up and verify they work. You do not manually simulate what the agents should be doing.

Find the first incomplete task in PLANNER.md. Start it. Follow RULES.md strictly. Write results to REPORT.md immediately after each task. Do not stop until the Final System Test passes or you hit a real blocker.

Begin now.
