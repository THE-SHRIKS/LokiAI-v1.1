import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { Send, FolderOpen, Asterisk, Rocket, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Device, ModelRecommendation, DeploymentRecord } from "@/lib/lokiai-api";

export interface DeployState {
  status: "idle" | "queued" | "downloading" | "downloaded" | "validating" | "complete" | "failed";
  progress: number;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  recommendations?: ModelRecommendation[];
  pending?: boolean;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  variant?: "centered" | "docked";
  projectTitle?: string;
  onDeploy?: (rec: ModelRecommendation) => void;
  deployStates?: Record<string, DeployState>;
  canDeploy?: boolean;
  device?: Device | null;
}

function DeviceStatusBar({ device }: { device?: Device | null }) {
  if (!device) {
    return (
      <>
        <Asterisk className="h-3 w-3 text-olive-bright" />
        <span>No device paired — connect one to begin.</span>
      </>
    );
  }
  const online = device.status === "connected";
  return (
    <>
      <span className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-olive-bright" : "bg-muted-foreground/50")} />
      <span className={online ? "text-olive-glow" : "text-muted-foreground"}>
        {device.phone_model} · {online ? "connected" : device.status}
      </span>
      {!online && <span className="text-muted-foreground/70">— open the LokiAI app on your phone to deploy</span>}
    </>
  );
}

export function ChatPanel({ messages, onSend, variant = "docked", projectTitle, onDeploy, deployStates, canDeploy, device }: ChatPanelProps) {
  const [value, setValue] = useState("");

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const v = value.trim();
    if (!v) return;
    onSend(v);
    setValue("");
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={cn("flex h-full flex-col bg-background", variant === "centered" && "items-center")}>
      {variant === "docked" && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
          <FolderOpen className="h-3.5 w-3.5 text-olive-bright" />
          <span className="text-foreground">West Gate</span>
          <span>/</span>
          <span className="truncate">{projectTitle ?? "Deploy"}</span>
        </div>
      )}

      <div className={cn("flex-1 overflow-y-auto", variant === "centered" ? "w-full max-w-2xl px-6 pt-16" : "px-4 py-3")}>
        {variant === "centered" && messages.length === 0 ? (
          <LandingHero />
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <Message
                key={m.id}
                msg={m}
                onDeploy={onDeploy}
                deployStates={deployStates}
                canDeploy={canDeploy}
              />
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={submit}
        className={cn(
          "w-full border-t border-border bg-panel/60 backdrop-blur",
          variant === "centered" ? "max-w-2xl border-x" : ""
        )}
      >
        <div className="flex items-center gap-2 border-b border-border bg-background/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          <DeviceStatusBar device={device} />
          <a className="ml-auto text-olive-glow hover:underline" href="#">Learn more</a>
        </div>
        <div className="px-3 py-2">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
            rows={variant === "centered" ? 1 : 2}
            placeholder={variant === "centered" ? "Tell LokiAI what you want your device to do..." : "Ask LokiAI anything about your devices or models..."}
            className="w-full resize-none rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-olive focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-end px-3 pb-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>LokiAI Active</span>
            <button type="submit" className="grid h-6 w-6 place-items-center rounded bg-olive text-background hover:bg-olive-bright">
              <Send className="h-3 w-3" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function LandingHero() {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getMe } = await import("@/lib/lokiai-api");
        const me = await getMe();
        if (!cancelled) setName(me.name);
      } catch {
        /* not signed in yet — greeting stays generic */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex flex-col items-center text-center">
      <h2 className="mb-6 flex items-center gap-2 text-lg font-medium text-foreground">
        <Asterisk className="h-4 w-4 text-olive-bright" />
        {name ? `What's up next, ${name}?` : "What's up next?"}
      </h2>
      <ActivityCard />
    </div>
  );
}

const CALENDAR_DAYS = 56; // 14 cols x 4 rows, like a real contribution graph
type RangeKey = "all" | "30d" | "7d";
const RANGE_DAYS: Record<RangeKey, number | null> = { all: null, "30d": 30, "7d": 7 };

function dayKey(iso: string): string {
  return iso.slice(0, 10); // UTC YYYY-MM-DD bucket
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m${rem}s` : `${m}m`;
}

function timeAgoShort(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function ActivityCard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [range, setRange] = useState<RangeKey>("all");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { getDevices, listDeployments } = await import("@/lib/lokiai-api");
        const [ds, deps] = await Promise.all([getDevices(), listDeployments()]);
        if (!cancelled) { setDevices(ds); setDeployments(deps); }
      } catch {
        /* stat card degrades to zeros on error, no fake fallback data */
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const rangeDays = RANGE_DAYS[range];
  const cutoff = rangeDays ? Date.now() - rangeDays * 86400000 : null;
  const inRange = deployments.filter((d) => !cutoff || (d.deployed_at && new Date(d.deployed_at).getTime() >= cutoff));

  const onlineNow = devices.filter((d) => d.status === "connected").length;
  const modelsReady = inRange.filter((d) => d.status === "complete").length;
  const lastDeploy = deployments[0]?.deployed_at ?? null; // API already orders by deployed_at DESC

  const modelCounts = new Map<string, number>();
  for (const d of inRange) {
    if (!d.model_name) continue;
    modelCounts.set(d.model_name, (modelCounts.get(d.model_name) ?? 0) + 1);
  }
  let topModel = "—";
  let topCount = 0;
  for (const [name, count] of modelCounts) {
    if (count > topCount) { topModel = name; topCount = count; }
  }

  const durations = inRange
    .filter((d) => d.status === "complete" && d.deployed_at && d.completed_at)
    .map((d) => new Date(d.completed_at!).getTime() - new Date(d.deployed_at!).getTime())
    .filter((ms) => ms >= 0);
  const avgLatency = durations.length
    ? formatDuration(durations.reduce((a, b) => a + b, 0) / durations.length)
    : "—";

  const active = deployments.find((d) => d.status === "queued" || d.status === "downloading" || d.status === "downloaded" || d.status === "validating");

  // Real 56-day contribution calendar: bucket every deployment by UTC day,
  // oldest to newest, left-to-right (matches the fixed grid regardless of
  // the All/30d/7d tile filter above).
  const today = new Date();
  const dayBuckets: number[] = [];
  const counts = new Map<string, number>();
  for (const d of deployments) {
    if (!d.deployed_at) continue;
    const k = dayKey(d.deployed_at);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (let i = CALENDAR_DAYS - 1; i >= 0; i--) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - i);
    dayBuckets.push(counts.get(day.toISOString().slice(0, 10)) ?? 0);
  }
  const maxCount = Math.max(1, ...dayBuckets);

  const cells = dayBuckets.map((count, i) => {
    const ratio = count / maxCount;
    const intensity =
      count === 0 ? "bg-secondary/40"
      : ratio > 0.66 ? "bg-olive-bright/80"
      : ratio > 0.33 ? "bg-olive/60"
      : "bg-olive/30";
    return <div key={i} title={`${count} deployment${count === 1 ? "" : "s"}`} className={cn("h-3.5 w-3.5 rounded-[2px]", intensity)} />;
  });

  const stats: [string, string][] = [
    ["Devices", String(devices.length)],
    ["Deployments", String(inRange.length)],
    ["Models Ready", String(modelsReady)],
    ["Online Now", String(onlineNow)],
    ["Last Deploy", timeAgoShort(lastDeploy)],
    ["Top Model", topModel === "—" ? "—" : topModel.split("/").pop()!],
    ["Avg Latency", avgLatency],
    ["Active Task", active?.model_name ?? "—"],
  ];

  return (
    <div className="w-full max-w-md rounded-md border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs">
        <div className="flex gap-3">
          <span className="text-foreground">Overview</span>
        </div>
        <div className="flex gap-2 text-muted-foreground">
          {(["all", "30d", "7d"] as RangeKey[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn("uppercase", range === r ? "text-foreground" : "hover:text-foreground")}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-px bg-border text-[11px]">
        {stats.map(([k, v]) => (
          <div key={k} className="bg-panel px-2 py-1.5">
            <div className="text-muted-foreground">{k}</div>
            <div className="truncate text-foreground" title={v}>{v}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-1 p-3">{cells}</div>
      <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        Your devices are running AI locally. No cloud required.
      </div>
    </div>
  );
}

function Message({
  msg,
  onDeploy,
  deployStates,
  canDeploy,
}: {
  msg: ChatMessage;
  onDeploy?: (rec: ModelRecommendation) => void;
  deployStates?: Record<string, DeployState>;
  canDeploy?: boolean;
}) {
  if (msg.role === "user") {
    return (
      <div className="text-sm leading-relaxed text-foreground">
        <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">You</div>
        <div className="whitespace-pre-wrap">{msg.content}</div>
      </div>
    );
  }
  return (
    <div className="text-sm leading-relaxed text-foreground/90">
      <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-olive-glow">
        <Asterisk className="h-3 w-3" /> Assistant
      </div>
      {msg.pending ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {msg.content}
        </div>
      ) : (
        <div className="whitespace-pre-wrap">{msg.content}</div>
      )}
      {msg.recommendations && msg.recommendations.length > 0 && (
        <div className="mt-3 space-y-2">
          {msg.recommendations.map((rec) => (
            <ModelCard
              key={rec.id}
              rec={rec}
              onDeploy={onDeploy}
              state={deployStates?.[rec.id]}
              canDeploy={canDeploy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ModelCard({
  rec,
  onDeploy,
  state,
  canDeploy,
}: {
  rec: ModelRecommendation;
  onDeploy?: (rec: ModelRecommendation) => void;
  state?: DeployState;
  canDeploy?: boolean;
}) {
  const st = state?.status ?? "idle";
  return (
    <div className="rounded-md border border-border bg-panel px-3 py-2">
      <div className="flex items-center gap-2">
        {/* min-w-0 on the flex child is what lets truncate actually engage;
            without it a long repo id stretches the card past its container. */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-foreground" title={rec.id}>
            {rec.display_name ?? rec.name}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {rec.size_mb ? `${rec.size_mb} MB · ` : ""}
            {rec.capability ?? rec.task}
            {rec.estimated_device_fit && rec.estimated_device_fit !== "unknown"
              ? ` · ${rec.estimated_device_fit} fit`
              : ""}
          </div>
        </div>
        {st === "idle" ? (
          <button
            onClick={() => onDeploy?.(rec)}
            disabled={!canDeploy}
            title={canDeploy ? "Deploy to your device" : "Pair a device first"}
            className="inline-flex items-center gap-1 rounded bg-olive px-2 py-1 text-xs text-background hover:bg-olive-bright disabled:opacity-40"
          >
            <Rocket className="h-3 w-3" /> Deploy
          </button>
        ) : st === "complete" ? (
          <span className="inline-flex items-center gap-1 text-xs text-olive-glow">
            <CheckCircle2 className="h-3.5 w-3.5" /> Ready
          </span>
        ) : st === "failed" ? (
          <span className="inline-flex items-center gap-1 text-xs text-destructive-foreground">
            <XCircle className="h-3.5 w-3.5" /> Failed
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {state?.progress ?? 0}%
          </span>
        )}
      </div>
      {/* One sentence, capped server-side. Everything technical lives in the
          Details disclosure below rather than being repeated under every card
          alongside the same facts the header already shows. */}
      {rec.description && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/75">
          {rec.description}
        </p>
      )}
      {/* Only present when it distinguishes this model from the others. */}
      {rec.why_recommended && (
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {rec.why_recommended}
        </p>
      )}
      {(rec.filename || rec.source_url || rec.runtime || rec.publisher) && (
        <details className="group mt-1.5">
          <summary className="cursor-pointer list-none text-[11px] text-muted-foreground hover:text-foreground">
            <span className="group-open:hidden">Details</span>
            <span className="hidden group-open:inline">Hide details</span>
          </summary>
          <dl className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
            {rec.filename && (
              <div className="flex gap-1.5">
                <dt className="shrink-0">File</dt>
                <dd className="min-w-0 truncate font-mono" title={rec.filename}>
                  {rec.filename}
                </dd>
              </div>
            )}
            {rec.runtime && (
              <div className="flex gap-1.5">
                <dt className="shrink-0">Runtime</dt>
                <dd className="min-w-0">{rec.runtime}</dd>
              </div>
            )}
            {rec.publisher && (
              <div className="flex gap-1.5">
                <dt className="shrink-0">Publisher</dt>
                <dd className="min-w-0 truncate">{rec.publisher}</dd>
              </div>
            )}
            {rec.source_url && (
              <div className="flex gap-1.5">
                <dt className="shrink-0">Source</dt>
                <dd className="min-w-0 truncate">
                  <a
                    href={rec.source_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {rec.source ?? "model card"}
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </details>
      )}
      {(st === "downloading" || st === "queued" || st === "downloaded" || st === "validating") && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full bg-olive-bright transition-all"
            style={{ width: `${state?.progress ?? 0}%` }}
          />
        </div>
      )}
      {st === "failed" && state?.error && (
        <div className="mt-1 text-[11px] text-destructive-foreground">{state.error}</div>
      )}
    </div>
  );
}
