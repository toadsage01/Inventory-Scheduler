import type { Prisma } from "@prisma/client";
import { isValidStamp } from "@/lib/time";
import { safeBookingHex } from "@/lib/colors";
import type { AppSettings } from "@/lib/settings";

export const TITLE_MAX = 120;

export interface ParsedBookingInput {
  title: string;
  typeId: string | null;
  start: string;
  end: string;
  notes: string | null;
  color: string | null;
  assetIds: string[];
  participantIds: string[];
}

function addDaysToStamp(stamp: string, days: number): string {
  const [y, m, d] = stamp.slice(0, 10).split("-").map(Number);
  const probe = new Date(y, m - 1, d + days);
  return `${probe.getFullYear()}-${String(probe.getMonth() + 1).padStart(2, "0")}-${String(probe.getDate()).padStart(2, "0")}`;
}

/** Parse + validate a booking payload; returns a readable error or the input. */
export function parseBookingInput(
  body: Record<string, unknown>,
  settings: AppSettings,
  nowLocalStamp: string,
): { input: ParsedBookingInput } | { error: string } {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return { error: "Give the booking a title, like “Brand shoot — studio day 1”." };
  if (title.length > TITLE_MAX) return { error: `Keep the title under ${TITLE_MAX} characters.` };

  const start = typeof body.start === "string" ? body.start : "";
  const end = typeof body.end === "string" ? body.end : "";
  if (!isValidStamp(start) || !isValidStamp(end)) {
    return { error: "Start and end need valid date + time." };
  }
  if (end <= start) return { error: "The end must be after the start." };

  const spanDays = Math.floor((Date.parse(`${end.slice(0, 10)}T00:00`) - Date.parse(`${start.slice(0, 10)}T00:00`)) / 86400000) + 1;
  if (spanDays > settings.maxBookingDays) {
    return { error: `Bookings can span at most ${settings.maxBookingDays} days. Split the plan or raise the limit in Settings.` };
  }
  if (start.slice(0, 10) > addDaysToStamp(nowLocalStamp, settings.maxAdvanceDays)) {
    return { error: `Bookings can be made at most ${settings.maxAdvanceDays} days ahead.` };
  }

  const assetIds = [...new Set(Array.isArray(body.assetIds) ? body.assetIds.map((v) => String(v)).filter(Boolean) : [])];
  const participantIds = [...new Set(Array.isArray(body.participantIds) ? body.participantIds.map((v) => String(v)).filter(Boolean) : [])];
  const typeId = typeof body.typeId === "string" && body.typeId ? body.typeId : null;
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null;
  // Colour: only strict #rrggbb strings pass; anything else means "auto".
  const color = safeBookingHex(typeof body.color === "string" ? body.color : null);

  return { input: { title, typeId, start, end, notes, color, assetIds, participantIds } };
}

export interface AssetClash {
  assetId: string;
  assetName: string;
  bookingId: string;
  title: string;
  userName: string;
  teamName: string | null;
  start: string;
  end: string;
}

/**
 * The hard lock: confirm none of the requested assets overlap an existing
 * booking. Callers run this inside a transaction; editing passes
 * excludeBookingId so a booking never clashes with itself.
 */
export async function findAssetClashes(
  tx: Prisma.TransactionClient,
  assetIds: string[],
  start: string,
  end: string,
  excludeBookingId?: string,
): Promise<AssetClash[]> {
  if (assetIds.length === 0) return [];
  const rows = await tx.bookingAsset.findMany({
    where: {
      assetId: { in: assetIds },
      booking: { deletedAt: null, start: { lt: end }, end: { gt: start }, ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}) },
    },
    include: {
      asset: { select: { name: true } },
      booking: { include: { owner: { include: { team: true } } } },
    },
  });
  const clashes: AssetClash[] = [];
  for (const row of rows) {
    clashes.push({
      assetId: row.assetId,
      assetName: row.asset.name,
      bookingId: row.bookingId,
      title: row.booking.title,
      userName: row.booking.owner.name,
      teamName: row.booking.owner.team?.name ?? null,
      start: row.booking.start,
      end: row.booking.end,
    });
  }
  return clashes;
}

type BookingWithRelations = Prisma.BookingGetPayload<{
  include: {
    type: true;
    owner: { include: { team: true } };
    assets: { include: { asset: true } };
    participants: { include: { user: { include: { team: true } } } };
  };
}>;

export function shapeBooking(b: BookingWithRelations) {
  return {
    id: b.id,
    title: b.title,
    typeId: b.typeId,
    typeName: b.type?.name ?? null,
    typeColor: b.type?.color ?? null,
    color: b.color ?? null,
    start: b.start,
    end: b.end,
    notes: b.notes,
    ownerId: b.ownerId,
    ownerName: b.owner.name,
    ownerPfp: b.owner.pfp ?? null,
    teamName: b.owner.team?.name ?? null,
    assets: b.assets.map((ba) => ({ id: ba.assetId, name: ba.asset.name, category: ba.asset.category })),
    participants: b.participants.map((bp) => ({
      id: bp.userId,
      name: bp.user.name,
      pfp: bp.user.pfp ?? null,
      teamName: bp.user.team?.name ?? null,
    })),
    createdAt: b.createdAt,
  };
}

export type ShapedBooking = ReturnType<typeof shapeBooking>;

export function bookingMailInfo(b: ShapedBooking) {
  return {
    title: b.title,
    typeName: b.typeName,
    typeColor: b.typeColor,
    start: b.start,
    end: b.end,
    notes: b.notes,
    ownerName: b.ownerName,
    assetNames: b.assets.map((a) => a.name),
    participantNames: b.participants.map((p) => p.name),
  };
}

/** Verify all referenced assets exist and are active; returns names in input order. */
export async function checkAssetsExist(
  tx: Prisma.TransactionClient,
  assetIds: string[],
): Promise<{ error: string } | { assetNames: string[] }> {
  if (assetIds.length === 0) return { assetNames: [] };
  const assets = await tx.asset.findMany({ where: { id: { in: assetIds }, deletedAt: null } });
  const byId = new Map(assets.map((a) => [a.id, a]));
  const names: string[] = [];
  for (const id of assetIds) {
    const asset = byId.get(id);
    if (!asset) return { error: "One of the selected items no longer exists. Refresh and try again." };
    if (!asset.active) return { error: `“${asset.name}” is marked inactive and cannot be booked.` };
    names.push(asset.name);
  }
  return { assetNames: names };
}

/** Verify referenced people + type exist; returns a readable error or null. */
export async function checkRefsExist(
  tx: Prisma.TransactionClient,
  participantIds: string[],
  typeId: string | null,
): Promise<string | null> {
  if (participantIds.length > 0) {
    const count = await tx.user.count({ where: { id: { in: participantIds } } });
    if (count !== participantIds.length) return "One of the invited people no longer exists. Refresh and try again.";
  }
  if (typeId) {
    const type = await tx.bookingType.findFirst({ where: { id: typeId, deletedAt: null } });
    if (!type) return "That booking type no longer exists. Refresh and try again.";
  }
  return null;
}
