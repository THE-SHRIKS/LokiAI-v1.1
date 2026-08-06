// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const isVercelDeployment = process.env.VERCEL === "1";

// Build identity compiled into the bundle. The incident review could not
// prove which commit the live dashboard was built from, because nothing in
// the served JavaScript carried a stamp — chunk content hashes only say
// "different", never "which". Vercel exposes VERCEL_GIT_COMMIT_SHA.
const buildCommit =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  process.env.VITE_BUILD_COMMIT ??
  "unknown";
const buildTimestamp = new Date().toISOString();

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
    // Vercel forwards /workspace/* to this service without stripping the
    // prefix. Emit the browser URLs from the root while placing the compiled
    // files under workspace/assets, so the requested URL and physical static
    // file path remain identical.
    base: "/",
    define: {
      "import.meta.env.VITE_WORKSPACE_MOUNTED": JSON.stringify(
        isVercelDeployment ? "true" : "false",
      ),
      "import.meta.env.VITE_BUILD_COMMIT": JSON.stringify(buildCommit),
      "import.meta.env.VITE_BUILD_TIMESTAMP": JSON.stringify(buildTimestamp),
    },
    // No source maps in the shipped production bundle — don't hand out an
    // unminified map of the app's real source to anyone who opens DevTools.
    build: {
      sourcemap: false,
    assetsDir: isVercelDeployment ? "workspace/assets" : "assets",
    },
  },
});
