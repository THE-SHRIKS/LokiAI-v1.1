// LokiAI backend client — every call hits the real FastAPI backend.
// No mock data anywhere: if the backend is unreachable the UI must say so.

const DEFAULT_BACKEND = import.meta.env.PROD 
  ? "https://lokiai.onrender.com" 
  : typeof window !== "undefined" 
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : "http://localhost:8000";

export function backendUrl(): string {
  return localStorage.getItem("lokiai_backend_url") ?? DEFAULT_BACKEND;
}

export function setBackendUrl(url: string) {
  localStorage.setItem("lokiai_backend_url", url.replace(/\/$/, ""));
}

// Access token lives in a plain JS variable, not localStorage/sessionStorage —
// an XSS payload that runs in this page can still read it (nothing in-page
// can prevent that), but it can't be exfiltrated by a later script reading
// storage, and it doesn't survive a full page reload. The refresh token is
// an httpOnly cookie the backend sets on /auth/login, /auth/verify-otp and
// /auth/refresh — this file never sees its value, only the browser does.
let _accessToken: string | null = null;

export function getToken(): string | null {
  return _accessToken;
}

export function setToken(token: string) {
  _accessToken = token;
}

export function clearToken() {
  _accessToken = null;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// A page reload wipes the in-memory access token. This exchanges the
// httpOnly refresh cookie (sent automatically via credentials:'include')
// for a fresh access token, so the user doesn't get bounced to /login on
// every refresh just because the in-memory copy is gone. Never throws.
export async function refreshAccessToken(): Promise<boolean> {
  try {
    const res = await fetch(`${backendUrl()}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      clearToken();
      return false;
    }
    const body = (await res.json()) as { access_token: string };
    setToken(body.access_token);
    return true;
  } catch {
    return false;
  }
}

// Runs the boot-time refresh attempt exactly once no matter how many
// components ask for it concurrently (the root layout awaits this before
// rendering any route, so per-page auth guards see a settled token state).
let _authReadyPromise: Promise<void> | null = null;

export function ensureAuthReady(): Promise<void> {
  if (!_authReadyPromise) {
    _authReadyPromise = getToken() ? Promise.resolve() : refreshAccessToken().then(() => undefined);
  }
  return _authReadyPromise;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${backendUrl()}/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    });
  } catch {
    // Best-effort server-side revocation — clear the local copy regardless.
  }
  clearToken();
}

async function doFetch(path: string, headers: Record<string, string>, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${backendUrl()}${path}`, { ...init, headers, credentials: "include" });
  } catch {
    throw new ApiError(0, `Backend unreachable at ${backendUrl()}`);
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  auth = true,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (auth) {
    const token = getToken();
    if (!token) throw new ApiError(401, "Not signed in");
    headers.Authorization = `Bearer ${token}`;
  }

  let res = await doFetch(path, headers, init);

  // Access token expired mid-session: try one silent refresh, then retry
  // the original call once. If the refresh token is also dead, surface the
  // 401 as usual and hard-redirect to login — no router context is
  // available this deep in the API layer, so this is the reliable path.
  if (auth && res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers.Authorization = `Bearer ${getToken()}`;
      res = await doFetch(path, headers, init);
    } else {
      clearToken();
      if (typeof window !== "undefined") window.location.href = "/login";
      throw new ApiError(401, "Session expired");
    }
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, detail);
  }
  return body as T;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function register(email: string, password: string, name: string) {
  return request<{ user_id: string; email_verification_required: boolean }>(
    "/auth/register",
    { method: "POST", body: JSON.stringify({ email, password, name }) },
    false,
  );
}

export async function verifyOtp(email: string, otp: string) {
  const res = await request<{ access_token: string; token_type: string }>(
    "/auth/verify-otp",
    { method: "POST", body: JSON.stringify({ email, otp }) },
    false,
  );
  setToken(res.access_token);
  return res;
}

export async function resendOtp(email: string) {
  return request<{ sent: boolean }>(
    "/auth/resend-otp",
    { method: "POST", body: JSON.stringify({ email }) },
    false,
  );
}

export async function login(email: string, password: string) {
  const res = await request<{ access_token: string; token_type: string }>(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
    false,
  );
  setToken(res.access_token);
  return res;
}

export async function forgotPassword(email: string) {
  return request<{ message: string }>(
    "/auth/forgot-password",
    { method: "POST", body: JSON.stringify({ email }) },
    false,
  );
}

export async function resetPassword(token: string, newPassword: string) {
  return request<{ message: string }>(
    "/auth/reset-password",
    { method: "POST", body: JSON.stringify({ token, new_password: newPassword }) },
    false,
  );
}

export interface Me {
  id: string;
  email: string;
  name: string;
  email_verified: boolean;
  created_at: string | null;
  has_nim_key: boolean;
}

export async function getMe() {
  return request<Me>("/auth/me");
}

export async function saveNimKey(apiKey: string) {
  return request<{ saved: boolean }>("/auth/nim-key", {
    method: "PUT",
    body: JSON.stringify({ api_key: apiKey }),
  });
}

export async function deleteNimKey() {
  return request<{ deleted: boolean }>("/auth/nim-key", { method: "DELETE" });
}

// ── Devices & pairing ────────────────────────────────────────────────────────

export interface Device {
  id: string;
  name?: string;
  phone_model: string;
  cpu_arch: string;
  ram_mb: number;
  storage_free_gb: number;
  android_version: string;
  status: string;
  last_seen: string | null;
}

export async function getDevices() {
  return request<Device[]>("/devices");
}

export interface DeviceDetail extends Device {
  current_deployment: {
    deployment_id: string;
    status: string;
    progress: number;
  } | null;
}

export async function getDeviceDetail(deviceId: string) {
  return request<DeviceDetail>(`/devices/${deviceId}`);
}

export async function deleteDevice(deviceId: string) {
  return request<{ deleted: boolean }>(`/devices/${deviceId}`, { method: "DELETE" });
}

export async function generatePairingToken() {
  return request<{ token: string; qr_data: string; expires_at: string }>(
    "/pairing/generate",
    { method: "POST", body: JSON.stringify({}) },
  );
}

// ── AI assistant ─────────────────────────────────────────────────────────────

export interface ModelRecommendation {
  id: string;
  name: string;
  size_mb: number;
  task: string;
  filename?: string;
  format?: string;
  // Present when this recommendation came from the user's own catalog
  // (an upload or a previously-deployed model) rather than a fresh
  // HuggingFace search result — deploy via this direct URL instead of id.
  download_url?: string;
}

export interface AssistantReply {
  response: string;
  action: string | null;
  search_results: ModelRecommendation[];
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export async function assistantChat(
  deviceId: string,
  message: string,
  conversationHistory?: ConversationTurn[],
) {
  return request<AssistantReply>("/assistant/chat", {
    method: "POST",
    body: JSON.stringify({
      device_id: deviceId,
      message,
      ...(conversationHistory?.length ? { conversation_history: conversationHistory } : {}),
    }),
  });
}

// ── Deployments ──────────────────────────────────────────────────────────────

export interface DeploymentStatus {
  deployment_id: string;
  status: "queued" | "downloading" | "complete" | "failed" | string;
  progress_percent: number;
  error_message: string | null;
}

export async function createDeployment(
  deviceId: string,
  model: { hfModelId?: string; modelUrl?: string; filename?: string },
  inferenceMode: "camera" | "chat" | "voice",
) {
  return request<{ deployment_id: string; status: string }>("/deployments", {
    method: "POST",
    body: JSON.stringify({
      device_id: deviceId,
      ...(model.hfModelId ? { hf_model_id: model.hfModelId } : {}),
      ...(model.modelUrl ? { model_url: model.modelUrl } : {}),
      ...(model.filename ? { model_filename: model.filename } : {}),
      config: { inference_mode: inferenceMode, confidence_threshold: 0.75 },
    }),
  });
}

export async function getDeployment(deploymentId: string) {
  return request<DeploymentStatus>(`/deployments/${deploymentId}`);
}

export interface DeploymentRecord {
  id: string;
  device_id: string | null;
  status: string;
  progress: number;
  error_message: string | null;
  deployed_at: string | null;
  completed_at: string | null;
  phone_model: string | null;
  model_name: string | null;
  model_format: string | null;
  task_type: string | null;
}

export async function listDeployments() {
  return request<DeploymentRecord[]>("/deployments");
}

// Task type → inference mode, mirroring the backend's task classification.
export function inferenceModeForTask(task: string): "camera" | "chat" | "voice" {
  if (task.includes("text-generation")) return "chat";
  if (task.includes("speech") || task.includes("audio")) return "voice";
  return "camera";
}

// ── Model catalog (HuggingFace deploys + user uploads) ────────────────────────

export const UPLOAD_TASK_OPTIONS = [
  "object-detection",
  "image-classification",
  "text-generation",
  "automatic-speech-recognition",
  "audio-classification",
] as const;

export interface ModelRecord {
  id: string;
  name: string;
  hf_model_id: string | null;
  source: string;
  format: string;
  size_mb: number | null;
  task_type: string | null;
  download_url: string | null;
  sha256: string | null;
  created_at: string;
}

export async function getModels() {
  return request<ModelRecord[]>("/models");
}

export async function uploadModel(
  file: File,
  task: (typeof UPLOAD_TASK_OPTIONS)[number],
  onProgress?: (percent: number) => void,
): Promise<ModelRecord> {
  const token = getToken();
  if (!token) throw new ApiError(401, "Not signed in");

  const form = new FormData();
  form.append("file", file);
  form.append("task", task);

  return new Promise<ModelRecord>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${backendUrl()}/models/upload`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new ApiError(0, `Backend unreachable at ${backendUrl()}`));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = xhr.responseText;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as ModelRecord);
      } else {
        const detail =
          body && typeof body === "object" && "detail" in body
            ? String((body as { detail: unknown }).detail)
            : `HTTP ${xhr.status}`;
        reject(new ApiError(xhr.status, detail));
      }
    };
    xhr.send(form);
  });
}
