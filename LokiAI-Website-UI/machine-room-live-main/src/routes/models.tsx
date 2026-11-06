import { createFileRoute, redirect } from "@tanstack/react-router";

// The v1.1 platform material now lives in the Docs.
export const Route = createFileRoute("/models")({
  beforeLoad: () => {
    throw redirect({ to: "/docs", hash: "v1-1" });
  },
});
