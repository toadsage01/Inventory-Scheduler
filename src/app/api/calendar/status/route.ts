import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/guard";
import { googleCalendarEnabled } from "@/lib/google";

/** Whether Google Calendar mirroring is available for the current person. */
export async function GET() {
  const { session, denied } = await requireSession();
  if (denied) return denied;

  const enabled = googleCalendarEnabled();
  if (!enabled) {
    return NextResponse.json({ enabled: false, connected: false, mirrored: 0 });
  }

  const [user, mirrored] = await Promise.all([
    db.user.findUnique({
      where: { id: session!.user.id },
      select: { googleAccessToken: true, googleRefreshToken: true },
    }),
    db.calendarLink.count({ where: { userId: session!.user.id } }),
  ]);

  return NextResponse.json({
    enabled: true,
    connected: Boolean(user?.googleRefreshToken || user?.googleAccessToken),
    mirrored,
  });
}
