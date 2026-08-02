import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Sidebar } from "@/components/workspace/Sidebar";
import { ChatPanel, type ChatMessage, type DeployState } from "@/components/workspace/ChatPanel";
import { Workspace } from "@/components/workspace/Workspace";
import { NimKeyModal } from "@/components/workspace/NimKeyModal";
import {
  getToken,
  getDevices,
  getMe,
  assistantChat,
  createDeployment,
  getDeployment,
  inferenceModeForTask,
  type Device,
  type ModelRecommendation,
} from "@/lib/lokiai-api";

interface DeploySearch {
  deployId?: string;
  deployFilename?: string;
  deployName?: string;
  deployTask?: string;
  deploySize?: string;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): DeploySearch => {
    const out: DeploySearch = {};
    if (typeof search.deployId === "string") out.deployId = search.deployId;
    if (typeof search.deployFilename === "string") out.deployFilename = search.deployFilename;
    if (typeof search.deployName === "string") out.deployName = search.deployName;
    if (typeof search.deployTask === "string") out.deployTask = search.deployTask;
    if (typeof search.deploySize === "string") out.deploySize = search.deploySize;
    return out;
  },
  head: () => ({
    meta: [
      { title: "LokiAI — Workspace" },
      { name: "description", content: "Deploy and run AI models on your own devices — fully offline." },
    ],
  }),
  component: Index,
});

// ── Persistent chat sessions ──────────────────────────────────────────────
// Chat used to live only in React state and vanished on reload/navigation.
// Sessions now persist to localStorage so "Recents" actually restores a
// past conversation instead of just relabeling an empty screen.

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

const SESSIONS_KEY = "lokiai_chat_sessions_v1";
const MAX_SESSIONS = 50;

function loadSessions(userId: string): ChatSession[] {
  try {
    const scopedKey = `${SESSIONS_KEY}_${userId}`;
    let raw = localStorage.getItem(scopedKey);
    
    // Migration: if no scoped data exists, check for old unsiloed data.
    // Assign it to the first user who logs in, then delete the global key.
    if (!raw) {
      const oldRaw = localStorage.getItem(SESSIONS_KEY);
      if (oldRaw) {
        localStorage.setItem(scopedKey, oldRaw);
        localStorage.removeItem(SESSIONS_KEY);
        raw = oldRaw;
      } else {
        return [];
      }
    }
    
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSessions(userId: string, sessions: ChatSession[]) {
  try {
    localStorage.setItem(`${SESSIONS_KEY}_${userId}`, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch {
    /* storage unavailable */
  }
}

function Index() {
  const navigate = useNavigate();
  const deploySearch = Route.useSearch();
  // Determine authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!getToken());
  
  useEffect(() => {
    // Keep it synced if token changes in another tab or after login
    const handleStorage = () => setIsAuthenticated(!!getToken());
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const [collapsed, setCollapsed] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [deployStates, setDeployStates] = useState<Record<string, DeployState>>({});
  const [me, setMe] = useState<{ id: string; has_nim_key: boolean } | null>(null);

  // Compulsory NIM key gate: every account brings its own NVIDIA NIM API
  // key (no shared key, no fallback — see LokiAI-backend's assistant_chat).
  // null = still checking, so nothing renders instead of a false flash.
  const [hasNimKey, setHasNimKey] = useState<boolean | null>(null);
  
  const meRef = useRef<{ id: string } | null>(null);

  useEffect(() => {
    if (!getToken()) return;
    getMe()
      .then((m) => {
        setHasNimKey(m.has_nim_key);
        setMe(m as any);
        meRef.current = m;
        // Merge stored sessions INTO any sessions already created by the
        // deploy-search effect — never replace the whole array, because
        // the deploy effect may have run before getMe() resolved (Bug 3).
        setSessions((existing) => {
          const stored = loadSessions(m.id);
          if (existing.length === 0) return stored;
          const storedIds = new Set(stored.map((s) => s.id));
          // Prepend new sessions (not in storage yet) ahead of the stored list.
          const brandNew = existing.filter((s) => !storedIds.has(s.id));
          return [...brandNew, ...stored];
        });
        setSessionsLoaded(true);
      })
      .catch(() => {
        setHasNimKey(null);
        setSessionsLoaded(true);
      });
  }, []);

  // Persist sessions whenever they change, but only after the user is known.
  // saveSessions is cheap (JSON.stringify of at most 50 entries) so no debounce
  // is needed, but we do guard against persisting before we know the user id.
  useEffect(() => {
    const userId = me?.id ?? meRef.current?.id;
    if (userId && sessionsLoaded) {
      saveSessions(userId, sessions);
    }
  }, [sessions, me, sessionsLoaded]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const messages = activeSession?.messages ?? [];
  const inWorkspace = messages.length > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Target a CONNECTED device (never a stale/offline one). Poll so newly
  // opened or newly paired phones become the deploy target automatically.
  useEffect(() => {
    if (!getToken()) return;
    const pick = (ds: Device[]) =>
      ds.find((d) => d.status === "connected") ??
      ds.find((d) => d.status !== "offline") ??
      ds[0] ?? null;
    const load = () => getDevices().then((ds) => setDevice(pick(ds))).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const updateSessionMsg = (sessionId: string, msgId: string, patch: Partial<ChatMessage>) =>
    setSessions((ss) =>
      ss.map((s) =>
        s.id === sessionId
          ? { ...s, messages: s.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)), updatedAt: Date.now() }
          : s,
      ),
    );

  const handleSend = async (text: string) => {
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: text };
    const replyId = crypto.randomUUID();
    const pendingMsg: ChatMessage = { id: replyId, role: "assistant", content: "Thinking…", pending: true };

    // History is the PRIOR turns only — captured before this turn is appended.
    const priorMessages = activeSession?.messages ?? [];
    const history = priorMessages
      .filter((m) => !m.pending)
      .map((m) => ({ role: m.role, content: m.content }));

    let sessionId = activeSessionId;
    if (!sessionId || !activeSession) {
      sessionId = crypto.randomUUID();
      const title = text.slice(0, 36) + (text.length > 36 ? "…" : "");
      const newSession: ChatSession = { id: sessionId, title, messages: [userMsg, pendingMsg], updatedAt: Date.now() };
      setSessions((ss) => [newSession, ...ss]);
      setActiveSessionId(sessionId);
    } else {
      setSessions((ss) =>
        ss.map((s) =>
          s.id === sessionId ? { ...s, messages: [...s.messages, userMsg, pendingMsg], updatedAt: Date.now() } : s,
        ),
      );
    }

    // Always target a CONNECTED device (the user may have >1 phone paired).
    let target = device;
    try {
      const ds = await getDevices();
      target =
        ds.find((d) => d.status === "connected") ??
        ds.find((d) => d.status !== "offline") ??
        ds[0] ??
        null;
      setDevice(target);
    } catch {
      /* handled below */
    }

    if (!target) {
      updateSessionMsg(sessionId, replyId, {
        pending: false,
        content:
          "No device is paired yet. Open Devices → Add Device, scan the QR from your phone, then ask me again — I'll recommend models that fit your phone.",
      });
      return;
    }

    try {
      const reply = await assistantChat(target.id, text, history);
      updateSessionMsg(sessionId, replyId, {
        pending: false,
        content: reply.response,
        recommendations: reply.search_results ?? [],
      });
    } catch (e) {
      updateSessionMsg(sessionId, replyId, {
        pending: false,
        content: `Assistant error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  };

  const handleDeploy = async (rec: ModelRecommendation) => {
    if (!device) return;
    // Guard against a duplicate deploy call for a model already in flight —
    // e.g. the same model card rendered in two messages/sessions, or a fast
    // double-click. Without this, the second call's real 409 ("a deployment
    // is already in progress") overwrites the FIRST call's real progress in
    // deployStates, making a genuinely-healthy download look like it failed.
    const existing = deployStates[rec.id]?.status;
    if (existing === "queued" || existing === "downloading") return;
    // GGUF files always run in chat mode; otherwise infer from the task.
    const mode = rec.format === "gguf" ? "chat" : inferenceModeForTask(rec.task);
    setDeployStates((s) => ({ ...s, [rec.id]: { status: "queued", progress: 0 } }));
    try {
      const { deployment_id } = await createDeployment(
        device.id,
        rec.download_url ? { modelUrl: rec.download_url, filename: rec.filename } : { hfModelId: rec.id, filename: rec.filename },
        mode,
      );
      // Poll the real deployment until it finishes.
      const poll = setInterval(async () => {
        try {
          const st = await getDeployment(deployment_id);
          setDeployStates((s) => ({
            ...s,
            [rec.id]: {
              status: st.status as DeployState["status"],
              progress: st.progress_percent ?? 0,
              error: st.error_message ?? undefined,
            },
          }));
          if (st.status === "complete" || st.status === "failed" || st.status === "cancelled") clearInterval(poll);
        } catch {
          /* transient — keep polling */
        }
      }, 1500);
    } catch (e) {
      setDeployStates((s) => ({
        ...s,
        [rec.id]: {
          status: "failed",
          progress: 0,
          error: e instanceof Error ? e.message : String(e),
        },
      }));
    }
  };

  // "Top picks — instant deploy" on the Models page hands off here via
  // search params instead of the assistant's own (broader, less certain)
  // search — this guarantees the exact curated model gets deployed, not
  // whatever the AI's independent search happens to rank first.
  const processedDeployRef = useRef(false);
  useEffect(() => {
    if (processedDeployRef.current) return;
    const { deployId, deployFilename, deployName, deployTask, deploySize } = deploySearch;
    if (!deployId || !deployFilename || !deployName || !deployTask) return;
    processedDeployRef.current = true;

    const rec: ModelRecommendation = {
      id: deployId,
      name: deployName,
      size_mb: deploySize ? Number(deploySize) : 0,
      task: deployTask,
      filename: deployFilename,
      format: "tflite",
    };

    const sessionId = crypto.randomUUID();
    const assistantMsgId = crypto.randomUUID();
    const friendlyTask = deployTask.replace(/-/g, " ");
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: `I want to deploy ${deployName} for ${friendlyTask}.` };
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: `Got it — deploying ${deployName} now.`,
      recommendations: [rec],
    };
    setSessions((ss) => [
      { id: sessionId, title: `Deploy ${deployName}`, messages: [userMsg, assistantMsg], updatedAt: Date.now() },
      ...ss,
    ]);
    setActiveSessionId(sessionId);
    navigate({ to: "/", search: {}, replace: true });

    // Resolve the target device fresh — don't trust `device` state's timing,
    // this effect can run before the device-polling effect above resolves.
    (async () => {
      let target = device;
      if (!target) {
        try {
          const ds = await getDevices();
          target = ds.find((d) => d.status === "connected") ?? ds.find((d) => d.status !== "offline") ?? ds[0] ?? null;
          if (target) setDevice(target);
        } catch {
          target = null;
        }
      }
      if (!target) {
        updateSessionMsg(sessionId, assistantMsgId, {
          content: "No device is paired yet. Open Devices → Add Device, scan the QR from your phone, then deploy this again from Models.",
        });
        return;
      }
      setDeployStates((s) => ({ ...s, [rec.id]: { status: "queued", progress: 0 } }));
      try {
        const { deployment_id } = await createDeployment(target.id, { hfModelId: rec.id, filename: rec.filename }, inferenceModeForTask(rec.task));
        const poll = setInterval(async () => {
          try {
            const st = await getDeployment(deployment_id);
            setDeployStates((s) => ({
              ...s,
              [rec.id]: { status: st.status as DeployState["status"], progress: st.progress_percent ?? 0, error: st.error_message ?? undefined },
            }));
            if (st.status === "complete" || st.status === "failed" || st.status === "cancelled") clearInterval(poll);
          } catch {
            /* transient — keep polling */
          }
        }, 1500);
      } catch (e) {
        setDeployStates((s) => ({
          ...s,
          [rec.id]: { status: "failed", progress: 0, error: e instanceof Error ? e.message : String(e) },
        }));
      }
    })();
  }, [deploySearch, device, navigate]);

  const recents = [...sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((s) => ({ id: s.id, title: s.title }));

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {hasNimKey === false && <NimKeyModal onSaved={() => setHasNimKey(true)} />}
      <div className="flex min-h-0 flex-1">
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          recents={recents}
          activeRecentId={activeSessionId ?? undefined}
          onSelectRecent={setActiveSessionId}
          onNewSession={() => setActiveSessionId(null)}
        />

        {inWorkspace ? (
          <div className="flex min-w-0 flex-1">
            <div className="flex w-[34%] min-w-[320px] max-w-[520px] flex-col border-r border-border">
              <ChatPanel
                messages={messages}
                onSend={handleSend}
                variant="docked"
                projectTitle={activeSession?.title}
                onDeploy={handleDeploy}
                deployStates={deployStates}
                canDeploy={!!device}
                device={device}
              />
            </div>
            <div className="min-w-0 flex-1">
              <Workspace />
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 justify-center">
            <div className="w-full">
              <ChatPanel
                messages={messages}
                onSend={handleSend}
                variant="centered"
                onDeploy={handleDeploy}
                deployStates={deployStates}
                canDeploy={!!device}
                device={device}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
