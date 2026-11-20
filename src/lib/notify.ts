import { db } from "@/lib/db";
import { getSettings, resolveSmtp } from "@/lib/settings";
import { mailEnabled, addedToBookingEmail, cancelledBookingEmail, reminderEmail, dailyBackupEmail, sendMail } from "@/lib/mail";
import { buildBackupPayload } from "@/lib/backup";
import { shapeBooking, bookingMailInfo } from "@/lib/booking-core";
import { nowStampInZone } from "@/lib/time";
import type { ShapedBooking } from "@/lib/booking-core";

async function logNotification(params: {
  kind: string;
  bookingId?: string | null;
  userId?: string | null;
  toEmail: string;
  subject: string;
  ok: boolean;
  error?: string | null;
  dedupeKey?: string | null;
}) {
  try {
    await db.notificationLog.create({
      data: {
        kind: params.kind,
        bookingId: params.bookingId ?? null,
        userId: params.userId ?? null,
        toEmail: params.toEmail,
        subject: params.subject.slice(0, 300),
        ok: params.ok,
        error: params.error ?? null,
        dedupeKey: params.dedupeKey ?? null,
      },
    });
  } catch {
    // A lost log row must never break a booking request.
  }
}

/** Emails everyone newly invited to a booking. Fire-and-forget from routes. */
export async function sendAddedNotifications(booking: ShapedBooking, actorName: string, newlyAddedIds: string[]) {
  try {
    const settings = await getSettings();
    if (!settings.notificationsEnabled || !settings.notifyOnAdded) return;
    const smtp = resolveSmtp(settings);
    if (!mailEnabled(settings, smtp)) return;

    const targets = await db.user.findMany({
      where: { id: { in: newlyAddedIds }, notifyOnAdded: true },
      select: { id: true, email: true, name: true },
    });
    const info = bookingMailInfo(booking);
    for (const target of targets) {
      if (target.id === booking.ownerId) continue; // no self-notify for the booker
      const mail = addedToBookingEmail(settings, target.name, info, actorName);
      const result = await sendMail(smtp, target.email, mail.subject, mail.html);
      await logNotification({
        kind: "ADDED",
        bookingId: booking.id,
        userId: target.id,
        toEmail: target.email,
        subject: mail.subject,
        ok: result.ok,
        error: result.error ?? null,
      });
    }
  } catch {
    // Notifications are best-effort; the booking itself already succeeded.
  }
}

export async function sendCancelledNotifications(booking: ShapedBooking, actorId: string) {
  try {
    const settings = await getSettings();
    if (!settings.notificationsEnabled) return;
    const smtp = resolveSmtp(settings);
    if (!mailEnabled(settings, smtp)) return;

    const info = bookingMailInfo(booking);
    const recipientIds = [...new Set([booking.ownerId, ...booking.participants.map((p) => p.id)])].filter((id) => id !== actorId);
    const targets = await db.user.findMany({
      where: { id: { in: recipientIds }, notifyOnAdded: true },
      select: { id: true, email: true, name: true },
    });
    const actor = await db.user.findUnique({ where: { id: actorId }, select: { name: true } });
    for (const target of targets) {
      const mail = cancelledBookingEmail(settings, target.name, info, actor?.name ?? "Someone");
      const result = await sendMail(smtp, target.email, mail.subject, mail.html);
      await logNotification({
        kind: "CANCELLED",
        bookingId: booking.id,
        userId: target.id,
        toEmail: target.email,
        subject: mail.subject,
        ok: result.ok,
        error: result.error ?? null,
      });
    }
  } catch {
    // best-effort
  }
}

/** Send one reminder email per person per booking per offset window. */
export async function runReminderScan(): Promise<{ sent: number; skipped: number }> {
  const settings = await getSettings();
  if (!settings.notificationsEnabled || settings.reminderHours.length === 0) return { sent: 0, skipped: 0 };
  const smtp = resolveSmtp(settings);
  if (!mailEnabled(settings, smtp)) return { sent: 0, skipped: 0 };

  const nowLocal = nowStampInZone(settings.timezone);
  let sent = 0;
  let skipped = 0;

  for (const hours of settings.reminderHours) {
    const horizonMs = Date.now() + hours * 3600_000;
    const horizon = epochToStamp(horizonMs, settings.timezone);
    if (horizon <= nowLocal) continue;

    const bookings = await db.booking.findMany({
      where: { start: { gt: nowLocal, lte: horizon } },
      include: bookingInclude,
    });
    for (const row of bookings) {
      const booking = shapeBooking(row);
      const info = bookingMailInfo(booking);
      const recipientIds = [booking.ownerId, ...booking.participants.map((p) => p.id)];
      const targets = await db.user.findMany({
        where: { id: { in: recipientIds }, notifyReminder: true },
        select: { id: true, email: true, name: true },
      });
      for (const target of targets) {
        const dedupeKey = `REMINDER:${hours}h:${booking.id}:${target.id}`;
        const already = await db.notificationLog.findUnique({ where: { dedupeKey } }).catch(() => null);
        if (already) {
          skipped += 1;
          continue;
        }
        const mail = reminderEmail(settings, target.name, info, hours);
        const result = await sendMail(smtp, target.email, mail.subject, mail.html);
        await logNotification({
          kind: "REMINDER",
          bookingId: booking.id,
          userId: target.id,
          toEmail: target.email,
          subject: mail.subject,
          ok: result.ok,
          error: result.error ?? null,
          dedupeKey,
        });
        if (result.ok) sent += 1;
      }
    }
  }
  return { sent, skipped };
}

const bookingInclude = {
  type: true,
  owner: { include: { team: true } },
  assets: { include: { asset: true } },
  participants: { include: { user: { include: { team: true } } } },
} as const;

/**
 * One complete JSON backup per day, attached to a mail to every admin.
 * Deliberately independent of the notifications on/off switch — a person
 * who silences announcements still wants their safety net. Runs whenever
 * the reminder scan runs (cron or a signed-in admin); the dedupe key keeps
 * it to one email per day, and a failed send is retried on the next run.
 */
export async function emailDailyBackup(): Promise<{ emailed: number; skipped?: string; error?: string }> {
  try {
    const settings = await getSettings();
    const smtp = resolveSmtp(settings);
    if (!smtp || !smtp.host) return { emailed: 0, skipped: "email is not configured" };
    const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { email: true } });
    if (admins.length === 0) return { emailed: 0, skipped: "no admins" };

    const day = new Date().toISOString().slice(0, 10);
    const dedupeKey = `BACKUP:${day}`;
    const already = await db.notificationLog.findUnique({ where: { dedupeKey } }).catch(() => null);
    if (already) return { emailed: 0, skipped: "already sent today" };

    const filename = `scheduler-backup-${day}.json`;
    const payload = await buildBackupPayload();
    const mail = dailyBackupEmail(settings, day, filename);
    const recipients = admins.map((a) => a.email).join(",");
    const result = await sendMail(smtp, recipients, mail.subject, mail.html, [
      { filename, content: JSON.stringify(payload) },
    ]);
    await logNotification({
      kind: "BACKUP",
      toEmail: recipients,
      subject: mail.subject,
      ok: result.ok,
      error: result.error ?? null,
      dedupeKey: result.ok ? dedupeKey : null, // failed sends try again later
    });
    return result.ok ? { emailed: admins.length } : { emailed: 0, error: result.error };
  } catch (err) {
    return { emailed: 0, error: err instanceof Error ? err.message : "backup failed" };
  }
}

function epochToStamp(epochMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(epochMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

// ---------- background worker ----------

let workerStarted = false;

/**
 * Starts the reminder loop on long-running hosts (bare Node, Docker).
 * On platforms without a persistent process, hit /api/notifications/run
 * from an external cron instead — the worker is a convenience, not a
 * requirement. Disable with REMINDER_WORKER=off.
 */
export function startReminderWorker() {
  if (workerStarted) return;
  if (process.env.REMINDER_WORKER === "off") return;
  workerStarted = true;
  const tick = async () => {
    try {
      await runReminderScan();
    } catch {
      // never let the loop die
    }
  };
  setTimeout(() => {
    void tick();
  }, 15_000);
  const interval = setInterval(() => {
    void tick();
  }, 60_000);
  if (typeof interval.unref === "function") interval.unref();
}
