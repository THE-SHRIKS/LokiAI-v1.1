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
    // The production service receives the public URL unchanged, so server and
    // browser must use the same mount for hydration to remain deterministic.
    router: { basepath: isVercelDeployment ? "/workspace" : "/" },
  },
  vite: {
    // The Vercel Services deployment mounts this application at /workspace.
    // Asset URLs must use that mount too; otherwise imported images resolve at
    // /assets and are handled by the marketing site instead of this service.
    base: isVercelDeployment ? "/workspace/" : "/",
    define: {
      "import.meta.env.VITE_WORKSPACE_MOUNTED": JSON.stringify(
        isVercelDeployment ? "true" : "false",
      ),
    },
    // No source maps in the shipped production bundle — don't hand out an
    // unminified map of the app's real source to anyone who opens DevTools.
    build: {
      sourcemap: false,
      assetsDir: "assets",
    },
  },
});
