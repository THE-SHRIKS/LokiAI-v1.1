import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  PanelLeft,
  Search,
  ChevronLeft,
  ChevronRight,
  Plus,
  MessageSquare,
  Users,
  Code2,
  Repeat,
  Send,
  ChevronDown,
  Dot,
  LogOut,
  MessageSquarePlus,
  PlayCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getMe, logout, type Me } from "@/lib/lokiai-api";
import lokiaiLogoUrl from "@/assets/lokiai-logo.png";

type Tab = "chat" | "cowork" | "code";

interface RecentItem {
  id: string;
  title: string;
}

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  recents: RecentItem[];
  activeRecentId?: string;
  onSelectRecent?: (id: string) => void;
  onNewSession?: () => void;
  onWatchIntro?: () => void;
}

export function Sidebar({ collapsed, onToggle, recents, activeRecentId, onSelectRecent, onNewSession, onWatchIntro }: SidebarProps) {
  const [tab, setTab] = useState<Tab>("code");
  const [me, setMe] = useState<Me | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    getMe().then((m) => { if (!cancelled) setMe(m); }).catch(() => { /* not signed in yet */ });
    return () => { cancelled = true; };
  }, []);

  const handleSignOut = () => {
    logout().finally(() => navigate({ to: "/login" }));
  };

  if (collapsed) {
    return (
      <aside className="flex h-full w-12 shrink-0 flex-col items-center gap-3 border-r border-border bg-panel py-3">
        <button
          onClick={onToggle}
          title="Expand sidebar (Ctrl+B)"
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <button className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <Search className="h-4 w-4" />
        </button>
        <button className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <ChevronRight className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-panel">
      <div className="flex items-center justify-between pl-3 pr-2 py-2.5">
        <img src={lokiaiLogoUrl} alt="LokiAI" className="h-7 w-24 object-cover object-center" />
        <button onClick={onToggle} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Collapse sidebar (Ctrl+B)">
          <PanelLeft className="h-4 w-4" />
        </button>
      </div>



      <nav className="flex flex-col px-1 text-sm">
        <SideItem icon={Plus} label="New session" onClick={onNewSession} />
        <SideItem icon={Repeat} label="Models" onClick={() => navigate({ to: "/models" })} />
        <SideItem icon={Send} label="Devices" onClick={() => navigate({ to: "/devices" })} />
        <SideItem icon={MessageSquarePlus} label="Feedback" onClick={() => navigate({ to: "/feedback" })} />
        <SideItem icon={PlayCircle} label="Watch welcome video" onClick={onWatchIntro} />
      </nav>

      <div className="mt-4 px-3 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground/70 flex items-center justify-between">
        <span>Recents</span>
        <span className="text-muted-foreground/50">{recents.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-1 text-sm">
        {recents.map((r) => (
          <button
            key={r.id}
            onClick={() => onSelectRecent?.(r.id)}
            className={cn(
              "flex w-full items-center gap-2 truncate rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-accent hover:text-foreground",
              activeRecentId === r.id && "bg-accent text-foreground"
            )}
          >
            <Dot className="h-4 w-4 shrink-0 text-olive-bright" />
            <span className="truncate">{r.title}</span>
          </button>
        ))}
      </div>

      <div className="relative mt-auto border-t border-border">
        {accountOpen && (
          <div className="absolute bottom-full left-2 right-2 mb-1 rounded-md border border-border bg-panel shadow-lg">
            <div className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
              Signed in as <span className="text-foreground">{me?.email ?? "…"}</span>
            </div>
            <button
              onClick={() => navigate({ to: "/account" })}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-accent"
            >
              <div className="grid h-4 w-4 place-items-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
              </div>
              Account Settings
            </button>
            <button
              onClick={handleSignOut}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-destructive-foreground hover:bg-destructive/10"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        )}
        <button
          onClick={() => setAccountOpen((o) => !o)}
          className="flex w-full items-center justify-between px-2 py-2 text-xs hover:bg-accent"
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-olive/30 text-[10px] font-semibold text-olive-glow">
              {(me?.name ?? "?").charAt(0).toUpperCase()}
            </div>
            <div className="flex min-w-0 flex-col items-start leading-tight">
              <span className="truncate text-foreground">{me?.name ?? "Loading…"}</span>
              <span className="truncate text-[10px] text-muted-foreground">{me?.email ?? ""}</span>
            </div>
          </div>
          <ChevronDown className={cn("h-3 w-3 shrink-0 text-muted-foreground transition-transform", accountOpen && "rotate-180")} />
        </button>
      </div>
    </aside>
  );
}

function SideItem({
  icon: Icon,
  label,
  badge,
  caret,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: string;
  caret?: boolean;
  onClick?: () => void;
}) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 rounded px-2 py-1.5 text-foreground/90 hover:bg-accent">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="flex-1 text-left">{label}</span>
      {badge && (
        <span className="rounded-sm bg-secondary px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {badge}
        </span>
      )}
      {caret && <ChevronDown className="h-3 w-3 text-muted-foreground" />}
    </button>
  );
}
