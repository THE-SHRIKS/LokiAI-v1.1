// !! THIS FILE IS NOT CURRENTLY DEPLOYED. !!
//
// It was written when this project was a plain Vercel app, where anything
// under /api became a serverless function automatically. The workspace is now
// a TanStack Start app built through Nitro and mounted as a "service" in the
// repo-root vercel.json, and that build does NOT pick up a bare /api
// directory. Every candidate URL returns the site's 404 page:
//
//   https://lokiai.theshriks.space/api/send-email            -> 404 (HTML)
//   https://lokiai.theshriks.space/workspace/api/send-email  -> 404 (HTML)
//   https://www.theshriks.space/api/send-email               -> 404
//
// That is why signup failed with "Email relay returned 404: <!DOCTYPE html...":
// EMAIL_RELAY_URL on Render points at one of these, so the backend was POSTing
// to a web page. The backend now detects this (EmailRelayMisconfigured), keeps
// the HTML out of user-facing errors, falls back to direct SMTP, and reports
// the state from GET /admin/email/status.
//
// To make this live again, either deploy it as a real server route of the
// TanStack Start app, or host it as its own Vercel project and point
// EMAIL_RELAY_URL at that deployment. Do not assume this file is running.
//
// Vercel Serverless Function (Node.js runtime).
//
// Why this exists: Render's free tier blocks outbound SMTP entirely
// (ports 25/465/587), so LokiAI-backend can't send the OTP/password-reset
// emails itself in production. Vercel's serverless functions have no such
// block, so the backend calls this relay over HTTPS instead. Protected by
// a shared secret — without it this would be an open relay anyone could
// use to send email through your SMTP account.
import nodemailer from "nodemailer";

// Vercel supplies req/res in the classic Node http-handler shape for
// functions under /api; typed loosely here to avoid pulling in @vercel/node
// just for types.
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const relaySecret = process.env.EMAIL_RELAY_SECRET;
  if (!relaySecret || req.headers["x-relay-secret"] !== relaySecret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // replyTo carries the submitting account's address for feedback mail. The
  // From header stays the verified application sender; forging From is what
  // gets a domain's mail rejected or spam-filed.
  const { to, subject, text, html, replyTo } = req.body ?? {};
  if (!to || !subject || !text) {
    res.status(422).json({ error: "to, subject, and text are required" });
    return;
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const fromEmail = process.env.SMTP_FROM_EMAIL || user;
  const fromName = process.env.SMTP_FROM_NAME || "LokiAI";

  if (!host || !user || !pass) {
    res.status(500).json({ error: "SMTP is not configured on this relay (SMTP_HOST/SMTP_USER/SMTP_PASSWORD)" });
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: false, // STARTTLS on 587, not implicit TLS
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
      messageId: info?.messageId ?? null,
      accepted: info?.accepted ?? [],
      rejected: info?.rejected ?? [],
      response: info?.response ?? null,
    });
  } catch (err: any) {
    res.status(502).json({ error: `Email relay send failed: ${err?.message ?? String(err)}` });
  }
}
