import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { prettyStampRange, shortDate } from "@/lib/time";
import type { AppSettings, SmtpConfig } from "@/lib/settings";

export interface MailBookingInfo {
  title: string;
  typeName: string | null;
  typeColor: string | null;
  start: string;
  end: string;
  notes: string | null;
  ownerName: string;
  assetNames: string[];
  participantNames: string[];
}

let cached: { key: string; transporter: Transporter } | null = null;

function transportFor(smtp: SmtpConfig): Transporter {
  const key = `${smtp.host}:${smtp.port}:${smtp.secure}:${smtp.user}:${smtp.pass.length}`;
  if (cached && cached.key === key) return cached.transporter;
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });
  cached = { key, transporter };
  return transporter;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

export interface MailAttachment {
  filename: string;
  content: string; // utf-8 text
}

export async function sendMail(
  smtp: SmtpConfig | null,
  to: string,
  subject: string,
  html: string,
  attachments: MailAttachment[] = [],
): Promise<SendResult> {
  if (!smtp) return { ok: false, error: "Email is not configured yet." };
  try {
    const transporter = transportFor(smtp);
    await transporter.sendMail({
      from: smtp.from || smtp.user || "scheduler@localhost",
      to,
      subject,
      html,
      text: htmlToText(html),
      attachments: attachments.length ? attachments : undefined,
    });
    return { ok: true };
  } catch (err) {
    cached = null;
    return { ok: false, error: err instanceof Error ? err.message : "Mail delivery failed." };
  }
}

export function mailEnabled(settings: AppSettings, smtp: SmtpConfig | null): boolean {
  return settings.notificationsEnabled && smtp !== null && Boolean(smtp.host);
}

// ---------- templates ----------

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;",
  );
}

function shell(orgName: string, appUrl: string, accent: string, title: string, body: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0d0d12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d12;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="padding-bottom:20px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="background:${accent};border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;letter-spacing:0.12em;color:#131316;">${escapeHtml(orgName.toUpperCase())}</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#16161d;border:1px solid #2a2a33;border-radius:14px;padding:28px;">
      <h1 style="margin:0 0 18px;font-size:20px;line-height:1.35;color:#f5f5f4;">${escapeHtml(title)}</h1>
      ${body}
    </td></tr>
    <tr><td style="padding-top:16px;text-align:center;font-size:12px;color:#6b6b76;">
      ${appUrl ? `<a href="${escapeHtml(appUrl)}" style="color:#ff4a4f;text-decoration:none;">Open the scheduler</a> · ` : ""}Sent automatically — replies are not watched.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;font-size:12px;color:#8a8a95;vertical-align:top;white-space:nowrap;padding-right:16px;">${escapeHtml(label)}</td>
    <td style="padding:6px 0;font-size:14px;color:#e8e8ec;">${value}</td>
  </tr>`;
}

function chip(text: string, color: string): string {
  return `<span style="display:inline-block;background:${color}22;color:${color};border:1px solid ${color}55;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;">${escapeHtml(text)}</span>`;
}

export function bookingCard(booking: MailBookingInfo): string {
  const color = booking.typeColor || "#12816e";
  const parts: string[] = [];
  parts.push(
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">`,
    row("When", escapeHtml(prettyStampRange(booking.start, booking.end))),
    booking.typeName ? row("Type", chip(booking.typeName, color)) : "",
    row("Booked by", escapeHtml(booking.ownerName)),
    booking.assetNames.length
      ? row("Gear & rooms", escapeHtml(booking.assetNames.join(", ")))
      : "",
    booking.participantNames.length
      ? row("With", escapeHtml(booking.participantNames.join(", ")))
      : "",
    booking.notes ? row("Notes", escapeHtml(booking.notes)) : "",
    `</table>`,
  );
  return parts.join("");
}

export function addedToBookingEmail(
  settings: AppSettings,
  personName: string,
  booking: MailBookingInfo,
  actorName: string,
): { subject: string; html: string } {
  const title = `${actorName} added you to “${booking.title}”`;
  const body = `<p style="margin:0 0 16px;font-size:14px;color:#c8c8d0;">Hi ${escapeHtml(personName)} — you're on the crew for this one.</p>${bookingCard(booking)}`;
  return {
    subject: `${actorName} added you to “${booking.title}” · ${shortDate(booking.start.slice(0, 10))}`,
    html: shell(settings.orgName, settings.appUrl, booking.typeColor || "#12816e", title, body),
  };
}

export function cancelledBookingEmail(
  settings: AppSettings,
  personName: string,
  booking: MailBookingInfo,
  actorName: string,
): { subject: string; html: string } {
  const title = `“${booking.title}” was cancelled`;
  const body = `<p style="margin:0 0 16px;font-size:14px;color:#c8c8d0;">Hi ${escapeHtml(personName)} — ${escapeHtml(actorName)} cancelled this booking, so the gear is free again.</p>${bookingCard(booking)}`;
  return {
    subject: `Cancelled: “${booking.title}” · ${shortDate(booking.start.slice(0, 10))}`,
    html: shell(settings.orgName, settings.appUrl, "#f87171", title, body),
  };
}

export function reminderEmail(
  settings: AppSettings,
  personName: string,
  booking: MailBookingInfo,
  hoursAhead: number,
): { subject: string; html: string } {
  const when =
    hoursAhead >= 24 ? `${Math.round(hoursAhead / 24)} day${hoursAhead >= 48 ? "s" : ""}` : `${hoursAhead} hour${hoursAhead === 1 ? "" : "s"}`;
  const title = `Coming up in ${when}: “${booking.title}”`;
  const body = `<p style="margin:0 0 16px;font-size:14px;color:#c8c8d0;">Hi ${escapeHtml(personName)} — this booking starts in about ${when}.</p>${bookingCard(booking)}`;
  return {
    subject: `Starting in ${when}: “${booking.title}” · ${shortDate(booking.start.slice(0, 10))}`,
    html: shell(settings.orgName, settings.appUrl, booking.typeColor || "#12816e", title, body),
  };
}

export function testEmail(settings: AppSettings): { subject: string; html: string } {
  const title = "Test email from the scheduler";
  const body = `<p style="margin:0;font-size:14px;color:#c8c8d0;">If you can read this, notifications are wired up correctly for <strong style="color:#f5f5f4;">${escapeHtml(settings.orgName)}</strong>. Reminders and “you were added” emails will land in inboxes from now on.</p>`;
  return { subject: `Test email · ${settings.orgName} scheduler`, html: shell(settings.orgName, settings.appUrl, "#12816e", title, body) };
}

export function dailyBackupEmail(settings: AppSettings, day: string, filename: string): { subject: string; html: string } {
  const title = "Daily backup is attached";
  const body = `<p style="margin:0 0 16px;font-size:14px;color:#c8c8d0;">The attached <strong style="color:#f5f5f4;">${escapeHtml(filename)}</strong> is a complete copy of the ${escapeHtml(settings.orgName)} scheduler taken today — every account, booking, piece of gear, and setting. Keep at least the latest one somewhere safe; it is the file that brings everything back after a mishap.</p><p style="margin:0;font-size:13px;color:#8a8a95;">It contains password hashes and mail credentials, so treat it like a key: don't forward it, don't leave it in a shared folder.</p>`;
  return { subject: `Daily backup · ${settings.orgName} · ${day}`, html: shell(settings.orgName, settings.appUrl, "#12816e", title, body) };
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
