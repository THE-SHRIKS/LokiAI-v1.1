import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  ArrowLeft,
  Box,
  CheckCircle2,
  Cpu,
  Loader2,
  RefreshCw,
  Rocket,
  Sparkles,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createDeployment,
  getDeployment,
  getDevices,
  getModels,
  getToken,
  inferenceModeForTask,
  uploadModel,
  UPLOAD_TASK_OPTIONS,
  type Device,
  type ModelRecord,
} from "@/lib/lokiai-api";
import { CURATED_MODELS, type CuratedModel } from "@/lib/curated-models";

export const Route = createFileRoute("/models")({
  head: () => ({
    meta: [
      { title: "LokiAI — Models" },
      { name: "description", content: "Real models found by LokiAI and your own uploaded models." },
    ],
  }),
  component: ModelsPage,
});

const REFRESH_MS = 5000;

interface DeployState {
  status: "idle" | "queued" | "downloading" | "complete" | "failed";
  progress: number;
  error?: string;
}

function ModelsPage() {
  const navigate = useNavigate();
  const [models, setModels] = useState<ModelRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [deployStates, setDeployStates] = useState<Record<string, DeployState>>({});

  useEffect(() => {
    if (!getToken()) navigate({ to: "/login" });
  }, [navigate]);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setModels(await getModels());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // Real device list for the Deploy target picker — prefer a connected one.
  useEffect(() => {
    if (!getToken()) return;
    const pick = (ds: Device[]) =>
      ds.find((d) => d.status === "connected")?.id ??
      ds.find((d) => d.status !== "offline")?.id ??
      ds[0]?.id ??
      "";
    const loadDevices = () =>
      getDevices()
        .then((ds) => {
          setDevices(ds);
          setDeviceId((cur) => (cur && ds.some((d) => d.id === cur) ? cur : pick(ds)));
        })
        .catch(() => {});
    loadDevices();
    const t = setInterval(loadDevices, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const handleDeploy = async (model: ModelRecord) => {
    if (!deviceId || !model.task_type) return;
    // Guard against a duplicate deploy call for a model already in flight —
    // the second call's real 409 would otherwise overwrite the first call's
    // real progress with a misleading "Failed".
    const existing = deployStates[model.id]?.status;
    if (existing === "queued" || existing === "downloading") return;
    const mode = model.format === "gguf" ? "chat" : inferenceModeForTask(model.task_type);
    setDeployStates((s) => ({ ...s, [model.id]: { status: "queued", progress: 0 } }));
    try {
      const { deployment_id } = await createDeployment(
        deviceId,
        model.source === "upload"
          ? { modelUrl: model.download_url ?? undefined, filename: model.name }
          : { hfModelId: model.hf_model_id ?? undefined, filename: model.name },
        mode,
      );
      const poll = setInterval(async () => {
        try {
          const st = await getDeployment(deployment_id);
          setDeployStates((s) => ({
            ...s,
            [model.id]: {
              status: st.status as DeployState["status"],
              progress: st.progress_percent ?? 0,
              error: st.error_message ?? undefined,
            },
          }));
          if (st.status === "complete" || st.status === "failed") clearInterval(poll);
        } catch {
          /* transient — keep polling */
        }
      }, 1500);
    } catch (e) {
      setDeployStates((s) => ({
        ...s,
        [model.id]: { status: "failed", progress: 0, error: e instanceof Error ? e.message : String(e) },
      }));
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 border-b border-border bg-panel px-3 py-2 text-sm">
        <Link
          to="/"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Workspace
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <span className="inline-flex items-center gap-1.5">
          <Box className="h-3.5 w-3.5 text-olive-bright" /> Models
        </span>
        <div className="ml-auto flex items-center gap-2">
          {devices.length > 0 && (
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-olive focus:outline-none"
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.phone_model} · {d.status}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={load}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:border-olive hover:text-foreground"
          >
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} /> Refresh
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <TopPicks navigate={navigate} />

        <UploadZone onUploaded={load} />

        {error && (
          <div className="mb-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">{error}</div>
        )}

        {models === null && !error ? (
          <div className="mt-4 text-sm text-muted-foreground">Loading models…</div>
        ) : models && models.length === 0 ? (
          <div className="mx-auto mt-8 max-w-sm rounded-md border border-border bg-panel p-6 text-center">
            <Box className="mx-auto mb-3 h-6 w-6 text-olive-bright" />
            <div className="mb-1 text-sm text-foreground">No models yet.</div>
            <div className="text-xs text-muted-foreground">
              Ask LokiAI to find one, or drop your own .tflite/.gguf file above.
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {models?.map((m) => (
              <ModelCard
                key={m.id}
                model={m}
                canDeploy={!!deviceId}
                state={deployStates[m.id]}
                onDeploy={() => handleDeploy(m)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TopPicks({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  const deploy = (m: CuratedModel) => {
    navigate({
      to: "/",
      search: {
        deployId: m.hfModelId,
        deployFilename: m.filename,
        deployName: m.name,
        deployTask: m.task,
        deploySize: String(m.sizeMb),
      },
    });
  };

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-olive-bright" />
        <span className="text-foreground">Top picks — instant deploy</span>
        <span className="text-muted-foreground/70">— hand-picked, real, tiny models. Tap Deploy and LokiAI takes it from there.</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {CURATED_MODELS.map((m) => (
          <div key={m.hfModelId} className="flex flex-col rounded-md border border-olive/30 bg-panel">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-olive-bright" />
              <span className="truncate text-sm text-foreground" title={m.name}>{m.name}</span>
            </div>
            <div className="flex-1 px-3 py-2 text-[11px] text-muted-foreground">
              <div className="mb-1.5 text-foreground/80">{m.description}</div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-border bg-background px-1.5 py-0.5 uppercase tracking-wider">{m.task}</span>
                <span>{m.sizeMb} MB</span>
              </div>
            </div>
            <div className="border-t border-border px-3 py-1.5">
              <button
                onClick={() => deploy(m)}
                className="inline-flex w-full items-center justify-center gap-1 rounded bg-olive px-2 py-1.5 text-xs text-background hover:bg-olive-bright"
              >
                <Rocket className="h-3 w-3" /> Deploy
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UploadZone({ onUploaded }: { onUploaded: () => void }) {
  const [dragOver, setDragOver] = useState(false);
  const [task, setTask] = useState<(typeof UPLOAD_TASK_OPTIONS)[number]>("text-generation");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const doUpload = async (file: File) => {
    setError(null);
    setProgress(0);
    try {
      await uploadModel(file, task, setProgress);
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) doUpload(file);
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) doUpload(file);
    e.target.value = "";
  };

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span>Model type:</span>
        <select
          value={task}
          onChange={(e) => setTask(e.target.value as (typeof UPLOAD_TASK_OPTIONS)[number])}
          className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-olive focus:outline-none"
        >
          {UPLOAD_TASK_OPTIONS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <span className="text-muted-foreground/70">— required so the phone knows how to run it</span>
      </div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-6 py-8 text-center transition-colors",
          dragOver ? "border-olive bg-olive/10" : "border-border bg-panel hover:border-olive/50",
        )}
      >
        <input ref={inputRef} type="file" accept=".tflite,.gguf" className="hidden" onChange={onFileChange} />
        {progress !== null ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-olive-bright" />
            <div className="text-sm text-foreground">Uploading… {progress}%</div>
          </>
        ) : (
          <>
            <UploadCloud className="h-6 w-6 text-olive-bright" />
            <div className="text-sm text-foreground">Drag & drop a .tflite or .gguf file, or click to browse</div>
            <div className="text-xs text-muted-foreground">Only formats the phone can run — TFLite (camera/voice) or GGUF (chat)</div>
          </>
        )}
      </div>
      {error && <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">{error}</div>}
    </div>
  );
}

function ModelCard({
  model,
  canDeploy,
  state,
  onDeploy,
}: {
  model: ModelRecord;
  canDeploy: boolean;
  state?: DeployState;
  onDeploy: () => void;
}) {
  const st = state?.status ?? "idle";
  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Cpu className="h-4 w-4 text-olive-bright" />
        <span className="truncate text-sm text-foreground" title={model.name}>{model.name}</span>
        <span className="ml-auto rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {model.source === "upload" ? "uploaded" : "huggingface"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border text-[11px]">
        <div className="bg-panel px-3 py-2">
          <div className="mb-0.5 text-muted-foreground">Format</div>
          <div className="text-foreground">{model.format}</div>
        </div>
        <div className="bg-panel px-3 py-2">
          <div className="mb-0.5 text-muted-foreground">Size</div>
          <div className="text-foreground">{model.size_mb != null ? `${model.size_mb} MB` : "unknown"}</div>
        </div>
        <div className="col-span-2 bg-panel px-3 py-2">
          <div className="mb-0.5 text-muted-foreground">Task</div>
          <div className="text-foreground">{model.task_type ?? "unknown"}</div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
        <span className="text-[11px] text-muted-foreground">
          {new Date(model.created_at).toLocaleString()}
        </span>
        {st === "idle" ? (
          <button
            onClick={onDeploy}
            disabled={!canDeploy}
            title={canDeploy ? "Deploy to selected device" : "Pair a device first"}
            className="inline-flex items-center gap-1 rounded bg-olive px-2 py-1 text-xs text-background hover:bg-olive-bright disabled:opacity-40"
          >
            <Rocket className="h-3 w-3" /> Deploy
          </button>
        ) : st === "complete" ? (
          <span className="inline-flex items-center gap-1 text-xs text-olive-glow"><CheckCircle2 className="h-3.5 w-3.5" /> Ready</span>
        ) : st === "failed" ? (
          <span className="inline-flex items-center gap-1 text-xs text-destructive-foreground"><XCircle className="h-3.5 w-3.5" /> Failed</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {state?.progress ?? 0}%
          </span>
        )}
      </div>
      {st === "failed" && state?.error && (
        <div className="border-t border-border px-3 py-1.5 text-[11px] text-destructive-foreground">{state.error}</div>
      )}
    </div>
  );
}
