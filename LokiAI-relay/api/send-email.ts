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
// its own 404 HTML page. That page was what surfaced inside the signup form
// as "Email relay returned 404: <!DOCTYPE html...".
//
// This directory is registered as its own zero-config service in the root
// vercel.json, with an `/api/(.*)` rewrite placed ahead of the catch-all so
// requests actually reach it.
import nodemailer from "nodemailer";
import { randomUUID } from "node:crypto";

// Vercel supplies req/res in the classic Node http-handler shape for functions
// under /api; typed loosely here to avoid pulling in @vercel/node just for types.
export default async function handler(req: any, res: any) {
  // An unauthenticated GET is a liveness probe: it proves the function is
  // deployed and routed without sending anything or exposing configuration.
  // The backend's /admin/email/status uses this to tell "relay is missing"
  // apart from "relay is failing".
  if (req.method === "GET") {
    res.status(200).json({ relay: "lokiai-email-relay", ok: true });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const relaySecret = process.env.EMAIL_RELAY_SECRET;
  if (!relaySecret) {
    res.status(500).json({ error: "EMAIL_RELAY_SECRET is not set on the relay" });
    return;
  }
  // The backend sends X-Relay-Secret; Authorization: Bearer is also accepted
  // so either convention authenticates the same shared secret.
  const authHeader = req.headers["authorization"];
  const bearerSecret = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : undefined;
  const suppliedSecret = req.headers["x-relay-secret"] ?? bearerSecret;
  if (suppliedSecret !== relaySecret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Vercel parses JSON bodies automatically, but a raw string can still arrive
  // depending on content-type; accept both rather than failing on a 422.
  let body = req.body ?? {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: "Body is not valid JSON" });
      return;
    }
  }

  // replyTo carries the submitting account's address for feedback mail. From
  // stays the verified application sender; forging From is what gets a
  // domain's mail rejected or spam-filed.
  const { to, subject, text, html, replyTo } = body;
  if (!to || !subject || !text) {
    res.status(422).json({ error: "to, subject, and text are required" });
    return;
  }

  const correlationId = randomUUID();

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const fromEmail = process.env.SMTP_FROM_EMAIL || user;
  const fromName = process.env.SMTP_FROM_NAME || "LokiAI";

  if (!host || !user || !pass) {
    res.status(500).json({
      error:
        "SMTP is not configured on this relay (SMTP_HOST/SMTP_USER/SMTP_PASSWORD)",
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
    res.status(200).json({
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
    res.status(502).json({
      error: `Email relay send failed: ${err?.message ?? String(err)}`,
      correlationId,
    });
  }
}
