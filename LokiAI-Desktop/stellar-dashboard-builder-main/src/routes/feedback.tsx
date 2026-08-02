import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, MessageSquarePlus, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getToken, submitFeedback } from "@/lib/lokiai-api";

export const Route = createFileRoute("/feedback")({
  head: () => ({
    meta: [
      { title: "LokiAI — Feedback" },
      { name: "description", content: "Share your feedback with the LokiAI team." },
    ],
  }),
  component: FeedbackPage,
});

type Status = "idle" | "submitting" | "done" | "error";

const CATEGORIES = [
  "Bug Report",
  "Feature Request",
  "UI / UX",
  "Performance",
  "Other",
] as const;

function FeedbackPage() {
  const navigate = useNavigate();
  const [category, setCategory] = useState<string>("Bug Report");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!getToken()) navigate({ to: "/login" });
  }, [navigate]);

  const submit = async () => {
    if (!message.trim()) return;
    setStatus("submitting");
    setErrorMsg("");
    try {
      await submitFeedback(category, message.trim());
      setStatus("done");
      setMessage("");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-panel px-3 py-2 text-sm">
        <Link
          to="/"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Workspace
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <span className="inline-flex items-center gap-1.5">
          <MessageSquarePlus className="h-3.5 w-3.5 text-olive-bright" /> Feedback
        </span>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col items-center justify-start overflow-y-auto p-6">
        <div className="w-full max-w-lg">

          {status === "done" ? (
            <div className="mt-12 flex flex-col items-center gap-4 text-center">
              <CheckCircle2 className="h-10 w-10 text-olive-bright" />
              <div className="text-base font-medium text-foreground">Thanks for the feedback.</div>
              <p className="text-sm text-muted-foreground max-w-xs">
                We read everything. This helps us improve LokiAI.
              </p>
              <button
                onClick={() => setStatus("idle")}
                className="mt-2 rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-olive hover:text-foreground"
              >
                Send another
              </button>
            </div>
          ) : (
            <>
              <h1 className="mb-1 text-sm font-medium text-foreground">Share feedback</h1>
              <p className="mb-6 text-xs text-muted-foreground">
                Bug, idea, complaint — all welcome.
              </p>

              {/* Category chips */}
              <div className="mb-4">
                <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground/70">
                  Category
                </div>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c}
                      onClick={() => setCategory(c)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        category === c
                          ? "border-olive bg-olive/10 text-olive-glow"
                          : "border-border text-muted-foreground hover:border-olive/50 hover:text-foreground",
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Textarea */}
              <div className="mb-4">
                <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground/70">
                  Message
                </div>
                <textarea
                  id="feedback-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe the issue or idea in detail…"
                  rows={7}
                  className="w-full resize-none rounded-md border border-border bg-panel px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-olive focus:outline-none"
                />
                <div className="mt-1 text-right text-[10px] text-muted-foreground/40">
                  {message.length} / 2000
                </div>
              </div>

              {/* Error */}
              {status === "error" && (
                <div className="mb-4 flex items-center gap-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {errorMsg}
                </div>
              )}

              {/* Submit */}
              <button
                id="feedback-submit-btn"
                onClick={submit}
                disabled={status === "submitting" || !message.trim() || message.length > 2000}
                className="inline-flex items-center gap-2 rounded bg-olive px-4 py-2 text-sm font-medium text-background hover:bg-olive-bright disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status === "submitting" ? (
                  <>
                    <svg
                      className="h-3.5 w-3.5 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    Sending…
                  </>
                ) : (
                  <>
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                    Submit feedback
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
