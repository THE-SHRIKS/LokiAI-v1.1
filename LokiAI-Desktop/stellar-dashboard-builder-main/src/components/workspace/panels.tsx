import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Panel } from "./Panel";
import { cn } from "@/lib/utils";
import {
  Terminal as TerminalIcon,
  FolderTree,
  GitCompare,
  Monitor,
  ListChecks,
  ClipboardList,
  RefreshCw,
  MoreVertical,
  ChevronRight,
  ChevronDown,
  Globe,
  FileText,
  Folder,
  Circle,
  CheckCircle2,
  XCircle,
  Ban,
  Loader2,
  Trash2,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import type { DeploymentRecord } from "@/lib/lokiai-api";

/* ---------------- Terminal ---------------- */

interface TermLine { kind: "out" | "in" | "err"; text: string }

const PROMPT = "lokiai> ";

const HELP_TEXT = "Commands: devices · deployments · models · ls · whoami · pwd · echo · clear · help";

export function TerminalPanel({ onClose }: { onClose?: () => void }) {
  const [lines, setLines] = useState<TermLine[]>([
    { kind: "out", text: "LokiAI Wireless Deployment · v3" },
    { kind: "out", text: "No cables. No ADB. Phones pair over QR and pull models" },
    { kind: "out", text: "directly from the HuggingFace CDN." },
    { kind: "out", text: "Type 'help' for commands — devices/deployments/models query your real account." },
  ]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const append = (out: TermLine[]) => {
    setLines((l) => [...l, ...out]);
    queueMicrotask(() => scrollRef.current?.scrollTo({ top: 99999 }));
  };

  const run = async (cmd: string) => {
    const c = cmd.trim();
    const echoLine: TermLine = { kind: "in", text: PROMPT + cmd };
    if (!c) { append([echoLine]); return; }
    const [head, ...rest] = c.split(/\s+/);
    const next: TermLine[] = [echoLine];

    switch (head.toLowerCase()) {
      case "cls":
      case "clear":
        setLines([]); return;
      case "echo":
        next.push({ kind: "out", text: rest.join(" ") });
        append(next);
        return;
      case "pwd":
        next.push({ kind: "out", text: "/lokiai/workspace" });
        append(next);
        return;
      case "help":
        next.push({ kind: "out", text: HELP_TEXT });
        append(next);
        return;
      case "whoami": {
        append(next);
        setBusy(true);
        try {
          const { getMe } = await import("@/lib/lokiai-api");
          const me = await getMe();
          append([{ kind: "out", text: `${me.name} <${me.email}> · ${me.email_verified ? "verified" : "unverified"}` }]);
        } catch (e) {
          append([{ kind: "err", text: e instanceof Error ? e.message : String(e) }]);
        } finally {
          setBusy(false);
        }
        return;
      }
      case "devices": {
        append(next);
        setBusy(true);
        try {
          const { getDevices } = await import("@/lib/lokiai-api");
          const ds = await getDevices();
          if (ds.length === 0) {
            append([{ kind: "out", text: "No devices paired yet. Devices → Add Device." }]);
          } else {
            append(ds.map((d) => ({
              kind: "out" as const,
              text: `${d.phone_model.padEnd(24)} ${d.status.padEnd(11)} ${(d.ram_mb / 1024).toFixed(1)}GB RAM  id:${d.id.slice(0, 8)}`,
            })));
          }
        } catch (e) {
          append([{ kind: "err", text: e instanceof Error ? e.message : String(e) }]);
        } finally {
          setBusy(false);
        }
        return;
      }
      case "deployments":
      case "ls":
      case "dir": {
        append(next);
        setBusy(true);
        try {
          const { listDeployments } = await import("@/lib/lokiai-api");
          const deps = await listDeployments();
          if (deps.length === 0) {
            append([{ kind: "out", text: "No deployments yet. Ask LokiAI to find a model, then hit Deploy." }]);
          } else {
            append(deps.slice(0, 20).map((d) => ({
              kind: "out" as const,
              text: `${(d.model_name ?? "model").slice(0, 28).padEnd(28)} ${d.status.padEnd(11)} ${d.phone_model ?? "device"}`,
            })));
          }
        } catch (e) {
          append([{ kind: "err", text: e instanceof Error ? e.message : String(e) }]);
        } finally {
          setBusy(false);
        }
        return;
      }
      case "models": {
        append(next);
        setBusy(true);
        try {
          const { getModels } = await import("@/lib/lokiai-api");
          const models = await getModels();
          if (models.length === 0) {
            append([{ kind: "out", text: "No models yet. Deploy one from a chat recommendation, or upload your own on the Models page." }]);
          } else {
            append(models.slice(0, 20).map((m) => ({
              kind: "out" as const,
              text: `${m.name.slice(0, 28).padEnd(28)} ${m.format.padEnd(7)} ${m.size_mb ? m.size_mb.toFixed(1) + "MB" : "?"}  ${m.task_type ?? ""}`,
            })));
          }
        } catch (e) {
          append([{ kind: "err", text: e instanceof Error ? e.message : String(e) }]);
        } finally {
          setBusy(false);
        }
        return;
      }
      default:
        next.push({ kind: "err", text: `'${head}' is not recognized as a command. Try 'help'.` });
        append(next);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !busy) { const v = value; setValue(""); run(v); }
  };

  return (
    <Panel
      title="Terminal"
      icon={<TerminalIcon className="h-3 w-3 text-olive-bright" />}
      actions={
        <button
          onMouseDown={(e)=>e.stopPropagation()}
          onClick={() => setLines([])}
          className="rounded p-0.5 hover:bg-accent"
          title="Clear"
        ><Trash2 className="h-3 w-3" /></button>
      }
      onClose={onClose}
      bodyClassName="bg-background p-0 font-mono text-[12px] leading-relaxed text-foreground/90"
    >
      <div
        ref={scrollRef}
        className="h-full overflow-auto p-3"
        onClick={() => inputRef.current?.focus()}
      >
        {lines.map((l, i) => (
          <div key={i} className={cn(l.kind === "err" && "text-destructive", l.kind === "in" && "text-foreground")}>
            {l.text || "\u00a0"}
          </div>
        ))}
        <div className="flex items-center">
          <span>{PROMPT}</span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
            disabled={busy}
            autoFocus
            spellCheck={false}
            className="ml-1 flex-1 bg-transparent text-foreground caret-olive-bright outline-none disabled:opacity-50"
          />
          {busy && <Loader2 className="h-3 w-3 animate-spin text-olive-bright" />}
        </div>
      </div>
    </Panel>
  );
}

/* ---------------- Files (real fleet: devices → deployed model) ---------------- */

type Node = { name: string; kind: "dir" | "file"; children?: Node[] };

export function FilesPanel({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [tree, setTree] = useState<Node[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Real data: the user's devices and what's deployed on them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getDevices, getDeviceDetail } = await import("@/lib/lokiai-api");
        const devices = await getDevices();
        const nodes: Node[] = await Promise.all(
          devices.map(async (d) => {
            let children: Node[] = [];
            try {
              const detail = await getDeviceDetail(d.id);
              const dep = detail.current_deployment;
              if (dep) {
                children = [{ name: `deployment · ${dep.status} ${dep.progress ?? 0}%`, kind: "file" }];
              }
            } catch { /* device detail optional */ }
            return {
              name: `${d.phone_model} (${d.status})`,
              kind: "dir" as const,
              children,
            };
          }),
        );
        if (!cancelled) setTree(nodes);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = (path: string) => setOpen((s) => ({ ...s, [path]: !s[path] }));

  const renderNode = (node: Node, path: string, depth: number) => {
    const full = path ? `${path}/${node.name}` : node.name;
    const isOpen = open[full];
    if (filter && !full.toLowerCase().includes(filter.toLowerCase())) return null;
    return (
      <div key={full}>
        <button
          onClick={() => { setSelected(full); if (node.kind === "dir") toggle(full); }}
          style={{ paddingLeft: depth * 12 + 8 }}
          className={cn(
            "flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs hover:bg-accent",
            selected === full && "bg-accent text-foreground"
          )}
        >
          {node.kind === "dir" ? (
            isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />
          ) : <span className="w-3" />}
          {node.kind === "dir" ? <Folder className="h-3 w-3 text-olive-bright" /> : <FileText className="h-3 w-3 text-muted-foreground" />}
          <span className="truncate">{node.name}</span>
        </button>
        {node.kind === "dir" && isOpen && node.children?.map((c) => renderNode(c, full, depth + 1))}
      </div>
    );
  };

  return (
    <Panel
      title="Files"
      icon={<FolderTree className="h-3 w-3 text-olive-bright" />}
      onClose={onClose}
      bodyClassName="bg-panel"
    >
      <div className="border-b border-border p-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files…"
          className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-olive focus:outline-none"
        />
      </div>
      {loadError ? (
        <div className="px-3 py-2 text-[11px] text-destructive">{loadError}</div>
      ) : tree.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-muted-foreground">
          No devices paired yet — Devices → Add Device.
        </div>
      ) : (
        <div className="py-1">{tree.map((n) => renderNode(n, "", 0))}</div>
      )}
      {selected && (
        <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="text-olive-glow">●</span> {selected}
        </div>
      )}
    </Panel>
  );
}

/* ---------------- Changes (real deployment history) ---------------- */

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function ChangesPanel({ onClose }: { onClose?: () => void }) {
  const { deployments, error } = useDeployments();

  const row = (d: DeploymentRecord) => (
    <li key={d.id} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent">
      <span className={cn(
        "grid h-4 w-4 shrink-0 place-items-center rounded text-[10px] font-bold",
        d.status === "complete" && "bg-olive/30 text-olive-bright",
        (d.status === "queued" || d.status === "downloading") && "bg-olive/20 text-olive-glow",
        d.status === "failed" && "bg-destructive/30 text-destructive",
      )}>
        {d.status === "complete" ? "✓" : d.status === "failed" ? "✕" : "…"}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={d.model_name ?? undefined}>
        {d.model_name ?? "model"} → {d.phone_model ?? "device"}
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(d.completed_at ?? d.deployed_at)}</span>
    </li>
  );

  if (error) {
    return (
      <Panel title="Changes" icon={<GitCompare className="h-3 w-3 text-olive-bright" />} onClose={onClose}>
        <div className="px-3 py-2 text-[11px] text-destructive">{error}</div>
      </Panel>
    );
  }

  if (deployments.length === 0) {
    return (
      <Panel title="Changes" icon={<GitCompare className="h-3 w-3 text-olive-bright" />} onClose={onClose}>
        <div className="grid h-full place-items-center px-6 text-center text-xs text-muted-foreground">
          No deployments yet — this fills in as you deploy models to your devices.
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title={`Changes (${deployments.length})`}
      icon={<GitCompare className="h-3 w-3 text-olive-bright" />}
      onClose={onClose}
    >
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">Deployment history</div>
        <ul className="px-1 pb-2">{deployments.map(row)}</ul>
      </div>
    </Panel>
  );
}

/* ---------------- Preview ---------------- */

export function PreviewPanel({ onClose }: { onClose?: () => void }) {
  // Real page in a real iframe — defaults to this dashboard's own install
  // page, the same one phones open from the Add Device QR.
  const [url, setUrl] = useState(() => {
    try {
      return `${window.location.origin}/android-app`;
    } catch {
      return "/android-app";
    }
  });
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const reload = () => {
    setRefreshKey((k) => k + 1);
  };

  return (
    <Panel
      title="Preview"
      icon={<Globe className="h-3 w-3 text-olive-bright" />}
      actions={
        <div className="flex items-center gap-0.5" onMouseDown={(e)=>e.stopPropagation()}>
          <button onClick={() => {}} className="rounded p-0.5 hover:bg-accent"><ArrowLeft className="h-3 w-3" /></button>
          <button onClick={() => {}} className="rounded p-0.5 hover:bg-accent"><ArrowRight className="h-3 w-3" /></button>
          <button onClick={reload} className="rounded p-0.5 hover:bg-accent"><RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /></button>
          <button className="rounded p-0.5 hover:bg-accent"><MoreVertical className="h-3 w-3" /></button>
        </div>
      }
      onClose={onClose}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-1 border-b border-border bg-panel-header p-1.5">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && reload()}
            className="flex-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] text-foreground focus:border-olive focus:outline-none"
          />
        </div>
        <iframe
          key={refreshKey}
          src={url}
          title="Preview"
          className="min-h-0 flex-1 border-0 bg-background"
        />
      </div>
    </Panel>
  );
}

/* ---------------- Tasks (real deployment activity) ---------------- */

const DEPLOYMENTS_POLL_MS = 3000;

function useDeployments() {
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { listDeployments } = await import("@/lib/lokiai-api");
        const rows = await listDeployments();
        if (!cancelled) { setDeployments(rows); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const t = setInterval(load, DEPLOYMENTS_POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return { deployments, error };
}

export function TasksPanel({ onClose }: { onClose?: () => void }) {
  const { deployments, error } = useDeployments();
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const active = deployments.filter((d) => d.status === "queued" || d.status === "downloading");
  const finished = deployments.filter((d) => d.status === "complete" || d.status === "failed" || d.status === "cancelled").slice(0, 15);

  const cancel = async (deploymentId: string) => {
    setCancelling(deploymentId);
    setCancelError(null);
    try {
      const { cancelDeployment } = await import("@/lib/lokiai-api");
      await cancelDeployment(deploymentId);
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelling(null);
    }
  };

  const item = (d: DeploymentRecord) => (
    <li key={d.id} className="flex items-center gap-2 rounded border border-border bg-background/40 px-2 py-1.5 text-xs">
      {d.status === "complete" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-olive-bright" />
        : (d.status === "failed" || d.status === "cancelled") ? <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
        : <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-olive-bright" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-foreground">{d.model_name ?? "model"}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {d.phone_model ?? "device"} · <span className={cn(
            d.status === "complete" && "text-olive-glow/80",
            (d.status === "queued" || d.status === "downloading") && "text-olive-bright",
            (d.status === "failed" || d.status === "cancelled") && "text-destructive",
          )}>
            {d.status}{(d.status === "queued" || d.status === "downloading") ? ` ${d.progress}%` : ""}
          </span>
        </div>
        {(d.status === "failed" || d.status === "cancelled") && d.error_message && (
          <div className="truncate text-[10px] text-destructive">{d.error_message}</div>
        )}
        {(d.status === "queued" || d.status === "downloading") && (
          <button
            type="button"
            onClick={() => void cancel(d.id)}
            disabled={cancelling === d.id}
            className="mt-2 inline-flex items-center gap-1 rounded border border-destructive/50 px-2 py-1 text-[10px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            title="Cancel deployment"
          >
            <Ban className="h-3 w-3" /> {cancelling === d.id ? "Cancelling download..." : "Cancel download"}
          </button>
        )}
      </div>
    </li>
  );

  return (
    <Panel
      title="Background tasks"
      icon={<ListChecks className="h-3 w-3 text-olive-bright" />}
      onClose={onClose}
    >
      {error && <div className="px-3 py-2 text-[11px] text-destructive">{error}</div>}
      {cancelError && <div className="px-3 py-2 text-[11px] text-destructive">{cancelError}</div>}
      {active.length > 0 && (
        <>
          <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-olive-glow">Active</div>
          <ul className="space-y-1 px-2 pb-2">{active.map(item)}</ul>
        </>
      )}
      {finished.length > 0 && (
        <>
          <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">Finished</div>
          <ul className="space-y-1 px-2 pb-2">{finished.map(item)}</ul>
        </>
      )}
      {deployments.length === 0 && !error && (
        <div className="grid h-full place-items-center px-6 text-center text-xs text-muted-foreground">
          No deployments yet — ask LokiAI to find a model, then hit Deploy.
        </div>
      )}
    </Panel>
  );
}

/* ---------------- Plan (real progress, not manually editable) ---------------- */

function useDevicesLite() {
  const [devices, setDevices] = useState<{ id: string; status: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { getDevices } = await import("@/lib/lokiai-api");
        const ds = await getDevices();
        if (!cancelled) { setDevices(ds); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return { devices, error };
}

export function PlanPanel({ onClose }: { onClose?: () => void }) {
  const { devices, error } = useDevicesLite();
  const { deployments } = useDeployments();

  // Each step is derived from real backend state — nothing here is
  // manually toggleable, so it can never show progress that didn't happen.
  const paired = devices.length > 0;
  const recommended = deployments.length > 0;
  const downloading = deployments.some((d) => d.status === "downloading" || d.status === "complete");
  const complete = deployments.some((d) => d.status === "complete");

  const steps = [
    { text: "Phone scans pairing QR", done: paired },
    { text: "Phone reads its own specs, self-registers", done: paired },
    { text: "AI recommends a model that fits the device", done: recommended },
    { text: "Phone downloads model from HuggingFace CDN", done: downloading },
    { text: "Model runs on-device, fully offline", done: complete },
  ];

  return (
    <Panel
      title="Plan"
      icon={<ClipboardList className="h-3 w-3 text-olive-bright" />}
      onClose={onClose}
    >
      <div className="flex h-full flex-col">
        {error && <div className="px-3 py-2 text-[11px] text-destructive">{error}</div>}
        <ul className="min-h-0 flex-1 overflow-auto p-2">
          {steps.map((s) => (
            <li key={s.text} className="flex items-start gap-2 rounded px-1.5 py-1 text-xs">
              {s.done
                ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-olive-bright" />
                : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <span className={cn("flex-1 leading-snug", s.done && "text-muted-foreground line-through")}>{s.text}</span>
            </li>
          ))}
        </ul>
        <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          Real progress from your devices and deployments.
        </div>
      </div>
    </Panel>
  );
}
