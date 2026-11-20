// The booking → Google Calendar bridge. Fire-and-forget: API routes call
// pushBookingToGoogle() after the database work is done, and this module
// mirrors the change into each involved person's dedicated "Praper
// Scheduler" calendar. Failures never bubble into the HTTP response.

import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { deleteCalendarEventForUser, googleCalendarEnabled, upsertCalendarEventForUser, validAccessTokenFor } from "@/lib/google";
import { shapeBooking } from "@/lib/booking-core";
import { nowStampInZone } from "@/lib/time";

const bookingInclude = {
  type: true,
  owner: { include: { team: true } },
  assets: { include: { asset: true } },
  participants: { include: { user: { include: { team: true } } } },
} as const;

export function pushBookingToGoogle(
  bookingId: string,
  action: "upsert" | "delete",
  userIds?: string[],
): void {
  void runSync(bookingId, action, userIds).catch((error) => {
    console.warn("[gcal] sync failed", action, bookingId, error);
  });
}

async function runSync(
  bookingId: string,
  action: "upsert" | "delete",
  userIds?: string[],
): Promise<void> {
  if (!googleCalendarEnabled()) return;

  if (action === "delete") {
    const links = await db.calendarLink.findMany({
      where: { bookingId, ...(userIds && userIds.length > 0 ? { userId: { in: userIds } } : {}) },
      select: { userId: true },
    });
    for (const link of links) {
      await deleteCalendarEventForUser(link.userId, bookingId);
    }
    return;
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: bookingInclude,
  });
  if (!booking) return;

  const [settings, shaped] = await Promise.all([getSettings(), Promise.resolve(shapeBooking(booking))]);
  const users = userIds && userIds.length > 0
    ? userIds
    : [booking.ownerId, ...booking.participants.map((p) => p.userId)];

  for (const userId of new Set(users)) {
    await upsertCalendarEventForUser(userId, shaped, settings);
  }
}

/** Manual repair pass: re-mirror every upcoming booking one person is part of. */
export async function syncUpcomingForUser(userId: string): Promise<{ synced: number; failed: number; removed: number }> {
  const settings = await getSettings();
  // "Upcoming" in company-local wall time: anything that has not fully ended yet.
  const cutoff = `${nowStampInZone(settings.timezone).slice(0, 10)}T23:59`;

  const bookings = await db.booking.findMany({
    where: {
      end: { gte: cutoff },
      OR: [{ ownerId: userId }, { participants: { some: { userId } } }],
    },
    include: bookingInclude,
    orderBy: { start: "asc" },
    take: 500,
  });

  let synced = 0;
  let failed = 0;
  for (const booking of bookings) {
    const result = await upsertCalendarEventForUser(userId, shapeBooking(booking), settings);
    if (result === "ok") synced += 1;
    else if (result === "error") failed += 1;
  }

  // Drop mirrors for bookings that no longer exist (or the person left).
  const links = await db.calendarLink.findMany({
    where: { userId },
    select: { id: true, bookingId: true, eventId: true, calendarId: true },
  });
  let removed = 0;
  for (const link of links) {
    const stillThere = bookings.some((b) => b.id === link.bookingId);
    if (!stillThere) {
      const exists = await db.booking.findUnique({ where: { id: link.bookingId }, select: { id: true } });
      if (!exists) {
        const token = await validAccessTokenFor(userId);
        if (token) {
          await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(link.calendarId)}/events/${encodeURIComponent(link.eventId)}`,
            { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
          ).catch(() => undefined);
        }
        await db.calendarLink.delete({ where: { id: link.id } }).catch(() => undefined);
        removed += 1;
      }
    }
  }

  return { synced, failed, removed };
}
