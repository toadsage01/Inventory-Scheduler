import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/guard";
import { findAssetClashes } from "@/lib/booking-core";

/**
 * Pre-flight check for the booking dialog: shows who among the invited
 * people is already booked in that window, and whether any gear is taken.
 * Overlapping people are allowed (a producer can oversee two shoots) —
 * this is a heads-up, not a block. Gear clashes stay a hard block.
 */
export async function POST(request: Request) {
  const { denied } = await requireSession();
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const start = body?.start?.toString() ?? "";
  const end = body?.end?.toString() ?? "";
  if (!start || !end || start >= end) {
    return NextResponse.json({ error: "A valid start/end range is required." }, { status: 400 });
  }
  const assetIds = Array.isArray(body?.assetIds) ? body!.assetIds.map((v) => String(v)).filter(Boolean) : [];
  const participantIds = Array.isArray(body?.participantIds)
    ? [...new Set(body!.participantIds.map((v) => String(v)).filter(Boolean))]
    : [];
  const excludeId = body?.excludeId?.toString() || undefined;

  const assetConflicts = await db.$transaction((tx) => findAssetClashes(tx, assetIds, start, end, excludeId));

  const participantConflicts: Array<{
    userId: string;
    name: string;
    bookings: Array<{ id: string; title: string; start: string; end: string }>;
  }> = [];

  if (participantIds.length > 0) {
    const rows = await db.user.findMany({
      where: { id: { in: participantIds } },
      select: {
        id: true,
        name: true,
        ownedBookings: {
          where: { start: { lt: end }, end: { gt: start }, ...(excludeId ? { id: { not: excludeId } } : {}) },
          select: { id: true, title: true, start: true, end: true },
        },
        participations: {
          where: { booking: { start: { lt: end }, end: { gt: start }, ...(excludeId ? { id: { not: excludeId } } : {}) } },
          select: { booking: { select: { id: true, title: true, start: true, end: true } } },
        },
      },
    });
    for (const person of rows) {
      const overlapping = [
        ...person.ownedBookings.map((b) => ({ id: b.id, title: b.title, start: b.start, end: b.end })),
        ...person.participations.map((p) => ({
          id: p.booking.id,
          title: p.booking.title,
          start: p.booking.start,
          end: p.booking.end,
        })),
      ];
      const seen = new Set<string>();
      const unique = overlapping.filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));
      if (unique.length > 0) {
        participantConflicts.push({ userId: person.id, name: person.name, bookings: unique });
      }
    }
  }

  return NextResponse.json({ assetConflicts, participantConflicts });
}
