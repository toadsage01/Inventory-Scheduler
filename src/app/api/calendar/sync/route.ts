import { NextResponse } from "next/server";
import { requireSession } from "@/lib/guard";
import { googleCalendarEnabled } from "@/lib/google";
import { syncUpcomingForUser } from "@/lib/gcal-sync";

/**
 * Manual repair pass — mirrors every upcoming booking the caller is part
 * of into their "Praper Scheduler" Google calendar and cleans stale ones.
 * Regular create/edit/cancel flows already sync automatically.
 */
export async function POST() {
  const { session, denied } = await requireSession();
  if (denied) return denied;

  if (!googleCalendarEnabled()) {
    return NextResponse.json(
      { error: "Google Calendar sync is not configured on this server yet." },
      { status: 400 },
    );
  }

  const result = await syncUpcomingForUser(session!.user.id);
  return NextResponse.json(result);
}
