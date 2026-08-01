import { useEffect, useMemo, useRef, useState } from "react";
import RGL, { WidthProvider } from "react-grid-layout/legacy";
import { Plus, RotateCcw, Terminal as TerminalIcon, FolderTree, GitCompare, Globe, ListChecks, ClipboardList, LockKeyhole } from "lucide-react";
import {
  TerminalPanel,
  FilesPanel,
  ChangesPanel,
  PreviewPanel,
  TasksPanel,
  PlanPanel,
} from "./panels";

const ResponsiveGrid = WidthProvider(RGL);

type PanelId = "terminal" | "files" | "changes" | "preview" | "tasks" | "plan";

interface Item { i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number }

const ROWS = 12;
const COLS = 12;

const INITIAL: Item[] = [
  { i: "terminal", x: 0, y: 0,  w: 7, h: 7, minW: 3, minH: 3 },
  { i: "files",    x: 7, y: 0,  w: 5, h: 4, minW: 2, minH: 3 },
  { i: "preview",  x: 7, y: 4,  w: 5, h: 3, minW: 2, minH: 3 },
  { i: "tasks",    x: 0, y: 7,  w: 5, h: 5, minW: 3, minH: 3 },
  { i: "changes",  x: 5, y: 7,  w: 4, h: 5, minW: 2, minH: 3 },
  { i: "plan",     x: 9, y: 7,  w: 3, h: 5, minW: 2, minH: 3 },
];

const DEFAULT_OPEN: Record<PanelId, boolean> = {
  terminal: true, files: true, changes: true, preview: true, tasks: true, plan: true,
};

const LAYOUT_KEY = "lokiai_workspace_layout_v1";
const OPEN_KEY = "lokiai_workspace_open_v1";

const PANEL_IDS: PanelId[] = ["terminal", "files", "changes", "preview", "tasks", "plan"];

function loadLayout(): Item[] {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return INITIAL;
    const parsed = JSON.parse(raw) as Item[];
    // Sanity check: must have exactly the known panel ids, nothing more/less.
    const ids = new Set(parsed.map((p) => p.i));
    if (PANEL_IDS.every((id) => ids.has(id)) && parsed.length === PANEL_IDS.length) return parsed;
    return INITIAL;
  } catch {
    return INITIAL;
  }
}

function loadOpen(): Record<PanelId, boolean> {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    if (!raw) return DEFAULT_OPEN;
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return { ...DEFAULT_OPEN, ...parsed };
  } catch {
    return DEFAULT_OPEN;
  }
}

const META: Record<PanelId, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  terminal: { label: "Terminal", icon: TerminalIcon },
  files:    { label: "Files",    icon: FolderTree },
  changes:  { label: "Changes",  icon: GitCompare },
  preview:  { label: "Preview",  icon: Globe },
  tasks:    { label: "Tasks",    icon: ListChecks },
  plan:     { label: "Plan",     icon: ClipboardList },
};

function LockedPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-full overflow-hidden rounded border border-border">
      <div className="pointer-events-none select-none blur-[3px] opacity-55">{children}</div>
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/30 backdrop-blur-[1px]">
        <div className="flex items-center gap-2 rounded-sm border border-olive/40 bg-background/90 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-olive-glow shadow-[0_0_22px_-8px_var(--olive-glow)]">
          <LockKeyhole className="h-3.5 w-3.5" />
          Unlocks at v1.2
        </div>
      </div>
    </div>
  );
}

export function Workspace() {
  const [layout, setLayout] = useState<Item[]>(loadLayout);
  const [open, setOpen] = useState<Record<PanelId, boolean>>(loadOpen);

  // Persist on every change so the arrangement survives reload.
  useEffect(() => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* storage unavailable */ }
  }, [layout]);
  useEffect(() => {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(open)); } catch { /* storage unavailable */ }
  }, [open]);

  const resetLayout = () => {
    setLayout(INITIAL);
    setOpen(DEFAULT_OPEN);
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(48);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight - 16; // padding allowance
      const margins = (ROWS - 1) * 8;
      setRowHeight(Math.max(24, Math.floor((h - margins) / ROWS)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visibleLayout = useMemo(
    () => layout.filter((l) => open[l.i as PanelId]),
    [layout, open]
  );

  const close = (id: PanelId) => setOpen((s) => ({ ...s, [id]: false }));
  const reopen = (id: PanelId) => setOpen((s) => ({ ...s, [id]: true }));

  const closedIds = (Object.keys(open) as PanelId[]).filter((k) => !open[k]);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-1.5 border-b border-border bg-panel/40 px-2 py-1 text-[11px] text-muted-foreground">
        <span className="text-foreground/80">Workspace</span>
        <span className="text-muted-foreground/50">·</span>
        <span>{visibleLayout.length} panels</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={resetLayout}
            title="Reset layout to default"
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 hover:border-olive hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" /> Reset layout
          </button>
          {closedIds.length === 0 ? (
            <span className="text-muted-foreground/50">drag the title bar to rearrange · drag edges to resize</span>
          ) : (
            closedIds.map((id) => {
              const M = META[id];
              return (
                <button
                  key={id}
                  onClick={() => reopen(id)}
                  className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 hover:border-olive hover:text-foreground"
                >
                  <Plus className="h-3 w-3" /> <M.icon className="h-3 w-3 text-olive-bright" /> {M.label}
                </button>
              );
            })
          )}
        </div>
      </div>

      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden p-2">
        <ResponsiveGrid
          className="layout"
          layout={visibleLayout as any}
          cols={COLS}
          maxRows={ROWS}
          rowHeight={rowHeight}
          margin={[8, 8]}
          containerPadding={[0, 0]}
          compactType="vertical"
          preventCollision={false}
          draggableHandle=".panel-drag-handle"
          onLayoutChange={(l: any) => setLayout((prev) => {
            const map = new Map<string, Item>(prev.map((p) => [p.i, p]));
            (l as Item[]).forEach((p) => {
              const cur = map.get(p.i);
              if (cur) map.set(p.i, { ...cur, x: p.x, y: p.y, w: p.w, h: p.h });
            });
            return Array.from(map.values());
          })}
        >
          {open.terminal && <div key="terminal"><LockedPanel><TerminalPanel onClose={() => close("terminal")} /></LockedPanel></div>}
          {open.files    && <div key="files"><LockedPanel><FilesPanel onClose={() => close("files")} /></LockedPanel></div>}
          {open.changes  && <div key="changes"><ChangesPanel onClose={() => close("changes")} /></div>}
          {open.preview  && <div key="preview"><LockedPanel><PreviewPanel onClose={() => close("preview")} /></LockedPanel></div>}
          {open.tasks    && <div key="tasks"><TasksPanel onClose={() => close("tasks")} /></div>}
          {open.plan     && <div key="plan"><PlanPanel onClose={() => close("plan")} /></div>}
        </ResponsiveGrid>
      </div>
    </div>
  );
}
