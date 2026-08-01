// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const isVercelDeployment = process.env.VERCEL === "1";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // Vercel Services removes /workspace before invoking this service. The
    // browser-facing router mount is selected from Vite's BASE_URL in router.tsx.
    router: { basepath: "/" },
  },
  vite: {
    // The Vercel Services deployment mounts this application at /workspace.
    // Keep the local developer server at / so existing local workflows work.
    base: isVercelDeployment ? "/workspace/" : "/",
    // No source maps in the shipped production bundle — don't hand out an
    // unminified map of the app's real source to anyone who opens DevTools.
    build: { sourcemap: false },
  },
});
