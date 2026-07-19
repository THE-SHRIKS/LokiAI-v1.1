import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Cpu,
  HardDrive,
  MemoryStick,
  Plus,
  RefreshCw,
  Smartphone,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getDevices, deleteDevice, getToken, type Device } from "@/lib/lokiai-api";
import { AddDeviceDialog } from "@/components/workspace/AddDeviceDialog";

export const Route = createFileRoute("/devices")({
  head: () => ({
    meta: [
      { title: "LokiAI — Devices" },
      { name: "description", content: "Your paired devices and their live status." },
    ],
  }),
  component: DevicesPage,
});

const REFRESH_MS = 5000;

function DevicesPage() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (!getToken()) navigate({ to: "/login" });
  }, [navigate]);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setDevices(await getDevices());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Real-time-ish: poll the real backend every few seconds.
  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

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
          <Smartphone className="h-3.5 w-3.5 text-olive-bright" /> Devices
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={load}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:border-olive hover:text-foreground"
          >
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} /> Refresh
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1 rounded bg-olive px-2 py-1 text-xs text-background hover:bg-olive-bright"
          >
            <Plus className="h-3 w-3" /> Add Device
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && (
          <div className="mb-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
            {error}
          </div>
        )}

        {devices === null && !error ? (
          <div className="text-sm text-muted-foreground">Loading devices…</div>
        ) : devices && devices.length === 0 ? (
          <div className="mx-auto mt-16 max-w-sm rounded-md border border-border bg-panel p-6 text-center">
            <Smartphone className="mx-auto mb-3 h-6 w-6 text-olive-bright" />
            <div className="mb-1 text-sm text-foreground">No devices connected yet.</div>
            <div className="mb-4 text-xs text-muted-foreground">
              Pair your phone by scanning a QR code — no cables, no setup.
            </div>
            <button
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1 rounded bg-olive px-3 py-1.5 text-xs text-background hover:bg-olive-bright"
            >
              <Plus className="h-3 w-3" /> Add Device
            </button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {devices?.map((d) => <DeviceCard key={d.id} device={d} onDelete={load} />)}
          </div>
        )}
      </div>

      <AddDeviceDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

function DeviceCard({ device, onDelete }: { device: Device; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const online = device.status === "connected";

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteDevice(device.id);
      onDelete();
    } catch {
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Smartphone className="h-4 w-4 text-olive-bright" />
        <span className="truncate text-sm text-foreground">{device.phone_model}</span>
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
            online
              ? "border-olive/40 bg-olive/10 text-olive-glow"
              : "border-border bg-background text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              online ? "bg-olive-bright" : "bg-muted-foreground/50",
            )}
          />
          {device.status}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border text-[11px]">
        <Spec icon={Cpu} label="CPU" value={device.cpu_arch} />
        <Spec icon={MemoryStick} label="RAM" value={`${(device.ram_mb / 1024).toFixed(1)} GB`} />
        <Spec icon={HardDrive} label="Free storage" value={`${device.storage_free_gb} GB`} />
        <Spec icon={Smartphone} label="Android" value={device.android_version} />
      </div>
      <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>
          Last seen:{" "}
          {device.last_seen ? new Date(device.last_seen).toLocaleString() : "never"}
        </span>
        {confirming ? (
          <span className="flex items-center gap-1.5">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="rounded bg-destructive px-2 py-0.5 text-[10px] text-foreground hover:opacity-80 disabled:opacity-40"
            >
              {deleting ? "Removing…" : "Confirm"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded border border-border px-2 py-0.5 text-[10px] hover:border-olive"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
            title="Remove device"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function Spec({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-panel px-3 py-2">
      <div className="mb-0.5 flex items-center gap-1 text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-foreground">{value}</div>
    </div>
  );
}
