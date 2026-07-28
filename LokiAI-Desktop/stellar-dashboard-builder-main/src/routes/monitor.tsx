import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Circle,
  Database,
  RefreshCw,
  Server,
  Trash2,
  Wifi,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { backendUrl, getToken } from "@/lib/lokiai-api";

export const Route = createFileRoute("/monitor")({
  head: () => ({
    meta: [
      { title: "LokiAI — System Monitor" },
      { name: "description", content: "Live system monitor for every API call, click, and event." },
    ],
  }),
  component: MonitorPage,
});

interface MonitorStatus {
  uptime_seconds: number;
  total_requests: number;
  total_errors: number;
  db: { users: number; devices: number; deployments: number };
  ws_connections: number;
  endpoints: Record<string, number>;
  errors_by_endpoint: Record<string, number>;
}

interface LogEntry {
  id: string;
  ts: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  error?: string;
}

interface ClientEvent {
  id: string;
  ts: string;
  type: "click" | "navigate" | "api_call" | "api_error" | "ws" | "custom";
  detail: string;
}

const POLL_MS = 2000;

function MonitorPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [serverLog, setServerLog] = useState<LogEntry[]>([]);
  const [clientLog, setClientLog] = useState<ClientEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Once access is denied the interval must never fire again — stash a ref so
  // the closure inside fetchStatus can cancel the interval without stale state.
  const [accessDenied, setAccessDenied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [tab, setTab] = useState<"live" | "server" | "endpoints">("live");
  const clientLogRef = useRef(clientLog);
  clientLogRef.current = clientLog;

  useEffect(() => {
    if (!getToken()) navigate({ to: "/login" });
  }, [navigate]);

  const fetchStatus = useCallback(async () => {
    try {
      const base = backendUrl();
      const token = getToken();
      const headers: Record<string, string> = { Authorization: `Bearer ${token!}` };
      const [statusRes, logRes] = await Promise.all([
        fetch(`${base}/monitor/status`, { headers }),
        fetch(`${base}/monitor/log?limit=100`, { headers }),
      ]);
      // 401/403/404: the backend deliberately conceals restricted operator routes.
      // Stop all further polling immediately — normal users must never loop on
      // these endpoints. Clear the error from console after the first check.
      if (statusRes.status === 401 || statusRes.status === 403 || statusRes.status === 404) {
        setAccessDenied(true);
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setError("This page is restricted to LokiAI operators.");
        return;
      }
      if (statusRes.ok) setStatus(await statusRes.json());
      if (logRes.ok) setServerLog(await logRes.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (accessDenied) return; // Do not re-subscribe after access is denied.
    fetchStatus();
    const t = setInterval(fetchStatus, POLL_MS);
    pollRef.current = t;
    return () => { clearInterval(t); pollRef.current = null; };
  }, [fetchStatus, accessDenied]);

  // Intercept clicks globally to log them
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      const btn = el.closest("button, a, [role='button']") as HTMLElement | null;
      if (!btn) return;
      const label =
        btn.getAttribute("title") ||
        btn.getAttribute("aria-label") ||
        btn.textContent?.trim().slice(0, 40) ||
        btn.tagName;
      const entry: ClientEvent = {
        id: Math.random().toString(36).slice(2, 10),
        ts: new Date().toISOString(),
        type: "click",
        detail: `${label} (${btn.tagName.toLowerCase()}${btn.className ? "." + btn.className.split(" ")[0] : ""})`,
      };
      clientLogRef.current = [entry, ...clientLogRef.current].slice(0, 200);
      setClientLog(clientLogRef.current);
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, []);

  // Intercept fetch to log API calls
  useEffect(() => {
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
      const method = (args[1]?.method || "GET").toUpperCase();
      const start = performance.now();
      try {
        const res = await origFetch.apply(this, args);
        const ms = Math.round(performance.now() - start);
        const path = new URL(url).pathname;
        const entry: ClientEvent = {
          id: Math.random().toString(36).slice(2, 10),
          ts: new Date().toISOString(),
          type: res.ok ? "api_call" : "api_error",
          detail: `${method} ${path} → ${res.status} (${ms}ms)`,
        };
        clientLogRef.current = [entry, ...clientLogRef.current].slice(0, 200);
        setClientLog(clientLogRef.current);
        return res;
      } catch (err) {
        const ms = Math.round(performance.now() - start);
        const entry: ClientEvent = {
          id: Math.random().toString(36).slice(2, 10),
          ts: new Date().toISOString(),
          type: "api_error",
          detail: `${method} ${url} FAILED (${ms}ms): ${err}`,
        };
        clientLogRef.current = [entry, ...clientLogRef.current].slice(0, 200);
        setClientLog(clientLogRef.current);
        throw err;
      }
    };
    return () => {
      window.fetch = origFetch;
    };
  }, []);

  const uptime = status
    ? status.uptime_seconds < 60
      ? `${Math.round(status.uptime_seconds)}s`
      : status.uptime_seconds < 3600
        ? `${Math.round(status.uptime_seconds / 60)}m`
        : `${(status.uptime_seconds / 3600).toFixed(1)}h`
    : "—";

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
          <Activity className="h-3.5 w-3.5 text-olive-bright" /> System Monitor
        </span>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Circle className={cn("h-2 w-2 fill-current", status ? "text-olive-bright" : "text-destructive")} />
            {status ? "Backend online" : "Offline"}
          </span>
          <span>Uptime: {uptime}</span>
        </div>
      </div>

      {error && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Stat cards */}
      {status && (
        <div className="grid grid-cols-2 gap-px border-b border-border bg-border md:grid-cols-5">
          <StatCard icon={Zap} label="Requests" value={status.total_requests} />
          <StatCard icon={Trash2} label="Errors" value={status.total_errors} warn={status.total_errors > 0} />
          <StatCard icon={Database} label="Devices" value={status.db.devices} />
          <StatCard icon={Server} label="Deployments" value={status.db.deployments} />
          <StatCard icon={Wifi} label="WS Live" value={status.ws_connections} />
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-px border-b border-border bg-border text-xs">
        {(["live", "server", "endpoints"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 capitalize bg-panel",
              tab === t ? "text-olive-bright border-b-2 border-olive" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "live" ? "Live Client Events" : t === "server" ? "Server Request Log" : "Endpoint Stats"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "live" && (
          <div className="divide-y divide-border">
            {clientLog.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">
                Listening for clicks, API calls, and events… interact with the app to see them here.
              </div>
            )}
            {clientLog.map((e) => (
              <div key={e.id} className="flex items-start gap-2 px-3 py-1.5 text-[11px] font-mono">
                <span className="w-[70px] shrink-0 text-muted-foreground">
                  {new Date(e.ts).toLocaleTimeString()}
                </span>
                <EventBadge type={e.type} />
                <span className={cn("flex-1", e.type === "api_error" && "text-destructive")}>
                  {e.detail}
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === "server" && (
          <div className="divide-y divide-border">
            {serverLog.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">No server requests logged yet.</div>
            )}
            {[...serverLog].reverse().map((e) => (
              <div key={e.id} className="flex items-start gap-2 px-3 py-1.5 text-[11px] font-mono">
                <span className="w-[70px] shrink-0 text-muted-foreground">
                  {new Date(e.ts).toLocaleTimeString()}
                </span>
                <span
                  className={cn(
                    "w-8 shrink-0 text-center rounded text-[10px] font-bold",
                    e.status < 300 ? "text-olive-bright" : e.status < 400 ? "text-foreground" : "text-destructive",
                  )}
                >
                  {e.status}
                </span>
                <span className="w-10 shrink-0 text-muted-foreground">{e.method}</span>
                <span className="flex-1 truncate">{e.path}</span>
                <span className="w-14 shrink-0 text-right text-muted-foreground">{e.ms}ms</span>
              </div>
            ))}
          </div>
        )}

        {tab === "endpoints" && status && (
          <div className="divide-y divide-border">
            {Object.entries(status.endpoints)
              .sort(([, a], [, b]) => b - a)
              .map(([endpoint, count]) => (
                <div key={endpoint} className="flex items-center gap-2 px-3 py-2 text-[11px] font-mono">
                  <span className="flex-1">{endpoint}</span>
                  <span className="text-olive-bright">{count} hits</span>
                  {status.errors_by_endpoint[endpoint] ? (
                    <span className="text-destructive">{status.errors_by_endpoint[endpoint]} err</span>
                  ) : null}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  warn,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div className="bg-panel px-3 py-2">
      <div className="mb-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className={cn("text-lg font-mono", warn ? "text-destructive" : "text-foreground")}>
        {value}
      </div>
    </div>
  );
}

function EventBadge({ type }: { type: ClientEvent["type"] }) {
  const styles: Record<string, string> = {
    click: "bg-olive/20 text-olive-bright",
    navigate: "bg-accent text-accent-foreground",
    api_call: "bg-primary/10 text-primary",
    api_error: "bg-destructive/20 text-destructive",
    ws: "bg-accent text-foreground",
    custom: "bg-muted text-muted-foreground",
  };
  return (
    <span className={cn("w-14 shrink-0 rounded px-1 py-0.5 text-center text-[9px] uppercase tracking-wider", styles[type])}>
      {type.replace("_", " ")}
    </span>
  );
}
