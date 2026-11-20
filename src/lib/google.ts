// Server-only Google Calendar bridge. Uses plain fetch — no SDK — so the
// bundle stays small. Every booking change is mirrored into each involved
// person's own dedicated "Praper Scheduler" calendar: their main calendar
// never gets touched, and the whole thing can be hidden or unsubscribed
// from inside Google Calendar with one click.

import { db } from "@/lib/db";
import type { AppSettings } from "@/lib/settings";

const CALENDAR_SUMMARY = "Praper Scheduler";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

export function googleCalendarEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

type BookingShape = {
  id: string;
  title: string;
  typeName: string | null;
  start: string;
  end: string;
  notes: string | null;
  ownerName: string;
  teamName: string | null;
  assets: Array<{ id: string; name: string; category: string }>;
};

/** Local wall-clock stamp → the "YYYY-MM-DDTHH:mm:00" form Google expects. */
function wallToGcal(stamp: string): string {
  return `${stamp}:00`;
}

/** A booking as a tidy Google Calendar event. Text only — portraits and
 * sticker faces never leave the app, so nothing odd appears in calendars. */
function buildEventPayload(booking: BookingShape, settings: AppSettings) {
  const gearLine =
    booking.assets.length > 0
      ? `Gear: ${booking.assets.map((a) => a.name).join(", ")}`
      : "";
  const lines = [
    "Booked in Praper Scheduler.",
    `Held by: ${booking.ownerName}${booking.teamName ? ` (${booking.teamName})` : ""}`,
    booking.typeName ? `Type: ${booking.typeName}` : "",
    gearLine,
    booking.notes ? `\nNotes: ${booking.notes.trim()}` : "",
    `\nManage it: ${settings.appUrl || ""}`.trimEnd(),
  ].filter((line) => line !== "");
  return {
    summary: booking.title,
    description: lines.join("\n"),
    start: { dateTime: wallToGcal(booking.start), timeZone: settings.timezone },
    end: { dateTime: wallToGcal(booking.end), timeZone: settings.timezone },
    reminders: { useDefault: true },
    extendedProperties: {
      private: {
        praperBookingId: booking.id,
        praperSource: "inventory-scheduler",
      },
    },
  };
}

async function googleFetch(url: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const response = await fetch(url, {
    ...rest,
    headers: {
      ...(rest.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  return response;
}

/** Exchange a refresh token for a fresh access token. */
async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date } | null> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
  };
}

/**
 * A usable access token for this user, refreshing (and persisting) when
 * needed. Returns null when the person never connected Google or the
 * refresh token has been revoked — sync then quietly skips them.
 */
export async function validAccessTokenFor(userId: string): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { googleAccessToken: true, googleRefreshToken: true, googleTokenExpires: true },
  });
  if (!user) return null;
  const expiresSoon = !user.googleTokenExpires || user.googleTokenExpires.getTime() - Date.now() < 60_000;
  if (user.googleAccessToken && !expiresSoon) return user.googleAccessToken;
  if (!user.googleRefreshToken) return user.googleAccessToken ?? null;
  const fresh = await refreshAccessToken(user.googleRefreshToken);
  if (!fresh) return null;
  await db.user
    .update({
      where: { id: userId },
      data: { googleAccessToken: fresh.accessToken, googleTokenExpires: fresh.expiresAt },
    })
    .catch(() => undefined);
  return fresh.accessToken;
}

/** Find (or silently create) the person's dedicated "Praper Scheduler" calendar. */
async function ensurePraperCalendar(token: string, timeZone: string): Promise<string | null> {
  const listResponse = await googleFetch(`${API}/users/me/calendarList?minAccessRole=writer`, { token });
  if (listResponse.ok) {
    const data = (await listResponse.json()) as { items?: Array<{ id?: string; summary?: string }> };
    const found = data.items?.find((cal) => cal.id && cal.summary === CALENDAR_SUMMARY);
    if (found?.id) return found.id;
  }
  const createResponse = await googleFetch(`${API}/calendars`, {
    method: "POST",
    token,
    body: JSON.stringify({ summary: CALENDAR_SUMMARY, timeZone }),
  });
  if (!createResponse.ok) return null;
  const created = (await createResponse.json()) as { id?: string };
  return created.id ?? null;
}

/** Mirror one booking into one person's Google calendar. Never throws. */
export async function upsertCalendarEventForUser(userId: string, booking: BookingShape, settings: AppSettings): Promise<"ok" | "skipped" | "error"> {
  try {
    const token = await validAccessTokenFor(userId);
    if (!token) return "skipped";
    const calendarId = await ensurePraperCalendar(token, settings.timezone);
    if (!calendarId) return "error";
    const payload = buildEventPayload(booking, settings);

    const link = await db.calendarLink.findUnique({
      where: { userId_bookingId: { userId, bookingId: booking.id } },
    });

    const response = link
      ? await googleFetch(`${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(link.eventId)}?sendUpdates=none`, {
          method: "PATCH",
          token,
          body: JSON.stringify(payload),
        })
      : await googleFetch(`${API}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`, {
          method: "POST",
          token,
          body: JSON.stringify(payload),
        });

    if (!response.ok) {
      // The event may have been deleted by hand in Google Calendar — 410/404
      // means we should simply create a fresh one.
      if (link && (response.status === 404 || response.status === 410)) {
        await db.calendarLink.delete({ where: { id: link.id } }).catch(() => undefined);
        const retry = await googleFetch(`${API}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`, {
          method: "POST",
          token,
          body: JSON.stringify(payload),
        });
        if (!retry.ok) return "error";
        const created = (await retry.json()) as { id?: string };
        if (!created.id) return "error";
        await db.calendarLink.create({ data: { userId, bookingId: booking.id, calendarId, eventId: created.id } });
        return "ok";
      }
      return "error";
    }

    const shaped = (await response.json()) as { id?: string };
    if (!shaped.id) return "error";
    await db.calendarLink.upsert({
      where: { userId_bookingId: { userId, bookingId: booking.id } },
      create: { userId, bookingId: booking.id, calendarId, eventId: shaped.id },
      update: { calendarId, eventId: shaped.id },
    });
    return "ok";
  } catch {
    return "error";
  }
}

/** Remove the mirrored event (used when a booking is cancelled or a person is dropped). */
export async function deleteCalendarEventForUser(userId: string, bookingId: string): Promise<void> {
  try {
    const link = await db.calendarLink.findUnique({
      where: { userId_bookingId: { userId, bookingId } },
    });
    if (!link) return;
    const token = await validAccessTokenFor(userId);
    if (token) {
      await googleFetch(
        `${API}/calendars/${encodeURIComponent(link.calendarId)}/events/${encodeURIComponent(link.eventId)}?sendUpdates=none`,
        { method: "DELETE", token },
      );
    }
    await db.calendarLink.delete({ where: { id: link.id } }).catch(() => undefined);
  } catch {
    // Best effort — a stale mirror is not worth an error page.
  }
}
