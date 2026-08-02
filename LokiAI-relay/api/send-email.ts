// LokiAI email relay — Vercel Serverless Function (Node.js runtime).
//
// Why this exists: Render blocks outbound SMTP (ports 25/465/587), so
// LokiAI-backend cannot reach an SMTP server directly in production. Vercel's
// functions have no such block, so the backend POSTs here over HTTPS and this
// function does the SMTP leg. Protected by a shared secret — without it this
// would be an open relay anyone could send mail through on your account.
//
// Why it lives in its own directory rather than inside the workspace app:
// the workspace is a TanStack Start app built through Nitro, and that build
// does NOT pick up a bare `api/` directory — the framework build owns the
// whole service root. A copy placed at
// LokiAI-Desktop/stellar-dashboard-builder-main/api/send-email.ts sat unused
// for that reason, and every request to /api/send-email fell through the
// root vercel.json catch-all to the MARKETING service, which answered with
// its own 404 HTML page.
//
// This directory is registered as its own service in the root vercel.json
// (with an explicit entrypoint — Services doesn't reliably auto-scan a
// nested service root's api/ folder the way a classic single project does),
// with an `/api/(.*)` rewrite placed ahead of the catch-all so requests
// actually reach it.
//
// req/res are handled with plain Node http methods only (res.end, not
// res.status().json()) because the explicit-entrypoint build path hands the
// function a raw http.ServerResponse, not the @vercel/node-augmented
// VercelResponse that zero-config API routes get — calling the convenience
// methods here threw "res.status is not a function" on every request,
// including GET, which is what FUNCTION_INVOCATION_FAILED on the liveness
// probe traced back to.
import nodemailer from "nodemailer";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

function sendJson(res: any, statusCode: number, payload: unknown): void {
  const serialized = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(serialized);
}

async function readJsonBody(req: any): Promise<any> {
  // Some runtimes pre-parse JSON onto req.body; others (a raw entrypoint
  // build) hand back the untouched request stream. Handle both.
  if (req.body !== undefined && req.body !== null && req.body !== "") {
    return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req: any, res: any) {
  // An unauthenticated GET is a liveness probe: it proves the function is
  // deployed and routed without sending anything or exposing configuration.
  // The backend's /admin/email/status uses this to tell "relay is missing"
  // apart from "relay is failing".
  if (req.method === "GET") {
    sendJson(res, 200, { relay: "lokiai-email-relay", ok: true });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const relaySecret = process.env.EMAIL_RELAY_SECRET;
  const smtpPassword = process.env.SMTP_PASSWORD;
  // During an SMTP password rotation, Render can still sign requests using
  // the previous password while this relay sends with the new one.  The
  // legacy value is authentication-only and remains an encrypted production
  // variable; remove it once Render has been rotated.
  const relayAuthPasswords = [smtpPassword, process.env.RELAY_LEGACY_AUTH_PASSWORD]
    .filter((value): value is string => Boolean(value));
  if (!relaySecret && relayAuthPasswords.length === 0) {
    sendJson(res, 500, { error: "Relay authentication is not configured" });
    return;
  }
  // The backend sends X-Relay-Secret; Authorization: Bearer is also accepted
  // so either convention authenticates the same shared secret.
  const authHeader = req.headers["authorization"];
  const bearerSecret = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : undefined;
  const suppliedSecret = req.headers["x-relay-secret"] ?? bearerSecret;

  let body: any;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Body is not valid JSON" });
    return;
  }

  // replyTo carries the submitting account's address for feedback mail. From
  // stays the verified application sender; forging From is what gets a
  // domain's mail rejected or spam-filed.
  const { to, subject, text, html, replyTo } = body ?? {};
  if (!to || !subject || !text) {
    sendJson(res, 422, { error: "to, subject, and text are required" });
    return;
  }

  const suppliedSignature = req.headers["x-relay-signature"];
  const signaturePayload = [to, subject, text, html ?? "", replyTo ?? ""].join("\n");
  const signatureMatches = typeof suppliedSignature === "string" && relayAuthPasswords.some((password) => {
    const expectedSignature = createHmac("sha256", password).update(signaturePayload).digest("hex");
    return expectedSignature.length === suppliedSignature.length
      && timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(suppliedSignature));
  });
  if (suppliedSecret !== relaySecret && !signatureMatches) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const correlationId = randomUUID();

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = smtpPassword;
  const fromEmail = process.env.SMTP_FROM_EMAIL || user;
  const fromName = process.env.SMTP_FROM_NAME || "LokiAI";

  if (!host || !user || !pass) {
    sendJson(res, 500, {
      error: "SMTP is not configured on this relay (SMTP_HOST/SMTP_USER/SMTP_PASSWORD)",
      correlationId,
    });
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // implicit TLS on 465, STARTTLS on 587
      auth: { user, pass },
    });
    const info = await transporter.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to,
      subject,
      text,
      html,
      ...(typeof replyTo === "string" && replyTo ? { replyTo } : {}),
    });
    // messageId and the SMTP server's own response line are returned so the
    // caller can record what the transport actually said, rather than
    // inferring delivery from a bare 200.
    sendJson(res, 200, {
      sent: true,
      correlationId,
      messageId: info?.messageId ?? null,
      accepted: info?.accepted ?? [],
      rejected: info?.rejected ?? [],
      response: info?.response ?? null,
    });
  } catch (err: any) {
    // The provider's error can name a host but must never echo credentials;
    // nodemailer's own error messages don't include the password.
    sendJson(res, 502, {
      error: `Email relay send failed: ${err?.message ?? String(err)}`,
      correlationId,
    });
  }
}
