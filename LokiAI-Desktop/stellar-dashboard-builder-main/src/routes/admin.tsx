import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { backendUrl, getToken } from "@/lib/lokiai-api";
import { Activity, Users, Smartphone, Server, ArrowLeft, Clock } from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "LokiAI — Local Admin" }],
  }),
  component: AdminDashboard,
});

interface AdminStats {
  overview: {
    total_users: number;
    total_devices: number;
    active_devices: number;
    total_deployments: number;
  };
  users: Array<{
    id: string;
    name: string;
    email: string;
    created_at: string | null;
    last_active: string | null;
    email_verified: boolean;
    device_count: number;
    latest_deployment: {
      model_name: string;
      hf_model_id: string;
      status: string;
      completed_at: string;
    } | null;
  }>;
}

function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchStats();
    // Poll every 10 seconds for real-time monitoring
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    try {
      const token = getToken();
      if (!token) {
        setError("Sign in with an operator account to view this page.");
        return;
      }
      const res = await fetch(`${backendUrl()}/admin/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // The backend answers 404 (not 403) for non-operators so it doesn't
      // confirm the route exists to anyone probing for it.
      if (res.status === 401 || res.status === 404) {
        setError("This page is restricted to LokiAI operators.");
        return;
      }
      if (!res.ok) throw new Error("Failed to load admin stats");
      const data = await res.json();
      setStats(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-destructive">
        {error}
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        <Activity className="h-5 w-5 animate-spin text-olive-bright" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:border-olive hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-sm font-semibold text-foreground">Local System Monitor</h1>
            <p className="text-[10px] text-olive-bright">LIVE FEED</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Top Overview Cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="rounded-md border border-border bg-panel p-4">
            <div className="flex items-center justify-between mb-2 text-muted-foreground">
              <span className="text-xs uppercase tracking-wider">Total Users</span>
              <Users className="h-4 w-4" />
            </div>
            <div className="text-2xl font-bold text-foreground">{stats.overview.total_users}</div>
          </div>
          
          <div className="rounded-md border border-border bg-panel p-4">
            <div className="flex items-center justify-between mb-2 text-muted-foreground">
              <span className="text-xs uppercase tracking-wider">Total Devices</span>
              <Smartphone className="h-4 w-4" />
            </div>
            <div className="text-2xl font-bold text-foreground">{stats.overview.total_devices}</div>
          </div>

          <div className="rounded-md border border-olive/30 bg-olive/5 p-4 shadow-[0_0_15px_rgba(107,140,66,0.1)]">
            <div className="flex items-center justify-between mb-2 text-olive-bright">
              <span className="text-xs uppercase tracking-wider">Online Devices</span>
              <Activity className="h-4 w-4 animate-pulse" />
            </div>
            <div className="text-2xl font-bold text-olive-glow">{stats.overview.active_devices}</div>
          </div>

          <div className="rounded-md border border-border bg-panel p-4">
            <div className="flex items-center justify-between mb-2 text-muted-foreground">
              <span className="text-xs uppercase tracking-wider">Deployments</span>
              <Server className="h-4 w-4" />
            </div>
            <div className="text-2xl font-bold text-foreground">{stats.overview.total_deployments}</div>
          </div>
        </div>

        {/* User Table */}
        <div className="rounded-md border border-border bg-panel overflow-hidden">
          <div className="border-b border-border bg-panel-header px-4 py-3">
            <h2 className="text-sm font-medium text-foreground">User Activity Log</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-background/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Time (Created)</th>
                  <th className="px-4 py-3 font-medium">Last Active</th>
                  <th className="px-4 py-3 font-medium">Devices</th>
                  <th className="px-4 py-3 font-medium">Deployed Model</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stats.users.map((user) => (
                  <tr key={user.id} className="hover:bg-background/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{user.name}</div>
                      <div className="text-[11px] text-muted-foreground">{user.email}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {user.created_at ? new Date(user.created_at).toLocaleString() : "Unknown"}
                    </td>
                    <td className="px-4 py-3 text-xs text-olive-glow whitespace-nowrap">
                      {user.last_active ? new Date(user.last_active).toLocaleString() : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground border border-border">
                        <Smartphone className="h-3 w-3" /> {user.device_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {user.latest_deployment ? (
                        <div className="flex flex-col">
                          <span className="text-olive-glow">{user.latest_deployment.model_name}</span>
                          <span className="text-[10px] text-muted-foreground">{user.latest_deployment.hf_model_id}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic">No deployments</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {user.latest_deployment ? (
                        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-semibold ${
                          user.latest_deployment.status === "complete" 
                            ? "bg-olive/20 text-olive-bright border border-olive/30" 
                            : "bg-accent/50 text-accent-foreground border border-accent"
                        }`}>
                          {user.latest_deployment.status}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
                {stats.users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      No users found in the system.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
