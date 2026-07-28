# Providing test credentials for live verification

You offered a NIM key, a real phone, and Neon branch access. Here is how to
hand each one over **without it appearing in chat, in git, or in any report**.

Everything below is gitignored (`test_infra/.gitignore` covers `.env.test*`).
I will read these values, use them, and never print them — only whether they
were present and what the result was.

---

## 1. NVIDIA NIM API key (unblocks the full chat verification)

Create `LokiAI-backend/test_infra/.env.secrets` containing exactly:

```
NIM_TEST_API_KEY=nvapi-...your key...
```

Then tell me it's there. I will:
- save it through the real `PUT /auth/nim-key` on a throwaway test account,
- run the 15 chat scenarios (greeting, code request, model search, direct HF
  URL, incompatible repo, invalid key, timeout, malformed response, ...),
- confirm no internal prompt text leaks from *real* NIM output,
- delete the key from the test account afterwards.

The key stays in that one file. It is never echoed, logged, or written to a
report — reports will say "a real key was configured" and nothing more.

**Use a key you can rotate.** A throwaway/dev key is ideal.

---

## 2. Neon branch (unblocks testing against real pre-production data shape)

Create a **branch** of the pre-production database in the Neon console
(Branches → New branch). That gives an isolated copy-on-write copy — nothing I
do can affect the parent.

Add its connection string to the same file:

```
NEON_BRANCH_DATABASE_URL=postgresql://...
```

I will point the backend at the **branch only**, never the parent. I will not
truncate, reset, or run destructive migrations. If you would rather not do
this, my local disposable Postgres already covers the same schema and all 25
regression checks — this only adds realism, it is not required.

---

## 3. Real Android phone (unblocks the last unproven part of the original bug)

This one needs you at the keyboard for a few minutes; I cannot install to a
phone from here unless it is attached to this machine via ADB.

**If the phone can be plugged into this PC:**
1. Enable Developer Options → USB debugging.
2. Plug it in and accept the "Allow USB debugging" prompt.
3. Tell me — I will verify with `adb devices`, install the APK I built, and
   drive the reconnect tests myself.

**If not**, install this APK manually and I will walk you through the checks:
```
LokiAImobile UI/build/app/outputs/flutter-apk/app-debug.apk
```
The sequence I need observed is in
`Docs/test/LOKIAI_REAL_DEVICE_VALIDATION_REPORT.md` — pair, confirm online,
power the phone off, watch it go offline within ~70s, power on, confirm it
returns to online without relaunching the app.

Note: the phone must reach the backend. If you are testing against a locally
run backend, both must be on the same Wi-Fi. Against the deployed Render
backend, any network works.

---

## What I will not do

- Print, echo, or commit any of these values.
- Put them in a report, a log, or a commit message.
- Use the parent Neon database for anything destructive.
- Keep the NIM key on the test account after the run.
