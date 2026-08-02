// Vercel Serverless Function (Node.js runtime) — independent of the
// TanStack Start app; Vercel deploys anything under /api as its own
// function regardless of the main framework.
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

  const { to, subject, text, html } = req.body ?? {};
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
    await transporter.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to,
      subject,
      text,
      html,
    });
    res.status(200).json({ sent: true });
  } catch (err: any) {
    res.status(502).json({ error: `Email relay send failed: ${err?.message ?? String(err)}` });
  }
}
