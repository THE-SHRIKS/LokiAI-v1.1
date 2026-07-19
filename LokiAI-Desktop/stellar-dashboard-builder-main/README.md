# LokiAI Dashboard

The web control plane for LokiAI: pair devices via QR code, chat with an AI assistant to pick a model that fits your phone, and deploy it — all backed by real data from the [LokiAI backend](../../LokiAI-backend).

Built with TanStack Start, React 19, Tailwind CSS, and shadcn/ui.

## Setup

```bash
npm install        # or: bun install
npm run dev         # http://localhost:8080
```

No environment variables are required. The dashboard talks to `http://localhost:8000` by default; override it at runtime from the app (stored in `localStorage` under `lokiai_backend_url`) if your backend runs elsewhere.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

## Structure

```
src/
├── routes/          File-based routes (TanStack Router) — login, devices, models, monitor, etc.
├── components/       UI components (shadcn/ui primitives + workspace panels)
└── lib/
    └── lokiai-api.ts  Typed client for the backend API, auth token handling, silent refresh
```

## Auth model

The access token is held in memory only (never `localStorage`); the refresh token lives in an httpOnly cookie set by the backend. On every page load, `ensureAuthReady()` silently exchanges the refresh cookie for a fresh access token before any route renders — so a signed-in user doesn't bounce through `/login` on reload. A mid-session `401` triggers one silent refresh-and-retry automatically.

## Pages

- `/login`, `/forgot-password`, `/reset-password` — auth flows
- `/` — workspace (chat panel, terminal, files, preview, background tasks)
- `/devices` — paired devices, Add Device (QR pairing)
- `/models` — model search + manual upload
- `/monitor` — live system status
