# EdgeMind / LokiAI — Agent Rules v3

## Identity

You are the AI coding agent building EdgeMind / LokiAI.
You work with the EdgeMind codebase.
You follow these rules without exception.
These rules apply whether you are Anti-Gravity (Gemini), Fable 5 (Claude), Cursor, or any other AI agent.

---

## Rule 1: No Mock Data. Ever.

You are NOT allowed to:
- Hardcode API responses
- Return fake device specs
- Simulate model downloads
- Use placeholder data in any endpoint
- Hardcode chat responses in the mobile app
- Hardcode camera labels in the mobile app
- Simulate WebSocket messages
- Return `{"status": "ok", "mock": true}` or anything similar
- Pre-write AI assistant responses

Every component must connect to real services:
- Real Railway PostgreSQL database
- Real Custom JWT Auth
- Real HuggingFace API
- Real NVIDIA NIM API (meta/llama-3.1-70b-instruct) — this is the ONLY AI backend
- Real WebSocket connections
- Real model downloads from HuggingFace CDN

No Claude API calls in the backend. NVIDIA NIM only.

If a real service is not available, you STOP and report the blocker. You do not fake it.

---

## Rule 2: Task Sequencing Is Strict

You work on ONE task at a time.

You do NOT start Task N+1 until:
1. Task N code is written
2. Task N verification test is run
3. Task N verification test PASSES with real data
4. Task N is logged in REPORT.md

If Task N verification fails:
- Fix the issue
- Run the test again
- Only move forward when it actually passes

You do NOT skip verification tests. You do NOT mark a task complete without running the test.

---

## Rule 3: Test With Real Inputs

When a task says "Verification Test", you must run it exactly as written.

For API endpoints: use real HTTP calls (curl or Python requests), not code assertions.
For database tasks: query the real Railway Postgres database.
For WebSocket tasks: connect a real WebSocket client.
For Android app tasks: run on the real Redmi Note 8 Pro, not emulator.
For model downloads: download from real HuggingFace CDN URLs.

---

## Rule 4: Report Every Task Immediately

When a task completes, you write to REPORT.md immediately.

Do NOT batch reports. Do NOT wait until end of phase.
Write the report entry the moment the task passes verification.

Report format:
```
### Task [NUMBER] — [TASK NAME]
Status: COMPLETE | FAILED | BLOCKED
Date: [real timestamp]

Input: [exact command or trigger]
Output: [exact raw output — unedited terminal, JSON, logcat]
Verified: YES | NO
Notes: [what happened, what was fixed if anything]
```

Raw output only. Do not summarize. Do not paraphrase.

---

## Rule 5: No Hallucinated Tasks

You only work on tasks defined in PLANNER.md.

You do NOT invent new tasks.
You do NOT add features not in SPEC.md or PLANNER.md.
You do NOT create implementation plans, roadmaps, or new planning files.
You do NOT refactor working code unless a task explicitly requires it.

If you think something needs to be added, write it as a suggestion in REPORT.md under "Suggestions" — you do not just do it.

---

## Rule 6: Phase Gates

At the end of each phase, run the Phase End-to-End Test defined in PLANNER.md.

If the end-to-end test fails:
- Identify which task is the root cause
- Fix that task
- Re-run that task's verification test
- Re-run the full phase end-to-end test
- Only then mark the phase complete

You do NOT move to Phase N+1 until Phase N end-to-end test passes.

---

## Rule 7: Code Quality Standards

Every file you write must:
- Have no commented-out code blocks
- Have no TODO comments left unresolved
- Have error handling on every external call (API, WebSocket, database, file I/O)
- Return meaningful error messages that explain what failed and why
- Be runnable — not theoretical
- Have no hardcoded secrets (API keys, tokens, passwords)

---

## Rule 8: Environment Variables Only

No API keys, tokens, or passwords in code files.
All secrets go in .env file.
.env file is in .gitignore.

Required .env variables:
```
DATABASE_URL=postgresql://...
JWT_SECRET_KEY=random-64-char-string
NVIDIA_API_KEY=nvapi-...
HF_API_TOKEN=hf_...
```

---

## Rule 9: When Stuck

If you are blocked on a task for more than 3 attempts:
1. Write the blocker clearly in REPORT.md
2. Do NOT try a workaround that involves mocking data
3. Stop and wait for human input

Blockers that require human input:
- Physical hardware not available
- API credentials missing or expired
- Phone won't connect or app won't install
- Third-party service (HuggingFace, NVIDIA) is down
- Permission issue on the development machine

---

## Rule 10: Document Files Are Sacred

The 6 files in `S:\LokiAI\Docs` are your only source of truth:
1. `01_ARCHITECTURE.md` — system design, what talks to what
2. `02_USER_JOURNEY.md` — user experience flow
3. `03_PRD.md` — product requirements
4. `04_SPEC.md` — API endpoints, schemas, app behavior
5. `05_PLANNER.md` — task list in order
6. `REPORT.md` — where you write results

When to use which file:
- Starting work → read PLANNER.md, find first incomplete task
- Need endpoint details → read SPEC.md
- Need to understand user flow → read USER_JOURNEY.md
- Need to understand system components → read ARCHITECTURE.md
- Need to understand what's required → read PRD.md
- Got stuck → re-read RULES.md (this file)
- Task complete → write to REPORT.md immediately

Do NOT create new planning files, implementation plans, roadmaps, or strategy documents. If it's not in these 6 files, you don't need it.

---

## Rule 11: Mobile App Codebase

The Flutter app codebase is at `S:\LokiAI\LokiAImobile UI` and NOWHERE else.

- Do NOT create a new Flutter project
- Do NOT copy files into a different directory
- Do NOT replace the existing UI design
- Only ADD inference logic, WebSocket handling, config reading, and QR scanning on top of the existing UI
- The existing design (colors, layout, typography, widget structure) is locked — do not modify it

---

## Rule 12: No USB, No ADB

This architecture has zero USB dependency.
- APK is installed via QR code + browser download
- Device specs are read by the app itself (Flutter APIs)
- Models are downloaded by the app from HuggingFace CDN
- Deployment instructions arrive via WebSocket
- There is no Discovery Agent, no Go binary, no ADB commands, no platform-tools

If you find yourself writing `adb` commands, you are doing it wrong. Stop and re-read ARCHITECTURE.md.

---

## Rule 13: Switching AI Agents

This project may switch between AI agents (Anti-Gravity/Gemini, Fable 5/Claude, Cursor, etc.).

To ensure continuity:
- REPORT.md is always the source of truth for what is done
- PLANNER.md is always the source of truth for what to do next
- Any new agent must read ALL 6 docs before starting any work
- Any new agent must identify the next incomplete task in PLANNER.md
- Any new agent follows these same rules without exception

When handing off to another agent, write a HANDOFF section in REPORT.md:
```
## HANDOFF NOTE
Date: [date]
Last completed task: [task number and name]
Next task: [task number and name]
Current blockers: [none | describe]
Files modified in last session: [list]
```

---

## What Success Looks Like

The product is complete when the Final System Test in PLANNER.md passes all 12 steps on real hardware with airplane mode verified on the phone.

Nothing else matters until that test passes.
