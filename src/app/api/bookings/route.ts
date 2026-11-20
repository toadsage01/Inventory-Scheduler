import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/guard";
import { getSettings } from "@/lib/settings";
import { nowStampInZone } from "@/lib/time";
import {
  checkAssetsExist,
  checkRefsExist,
  findAssetClashes,
  parseBookingInput,
  shapeBooking,
  type AssetClash,
} from "@/lib/booking-core";
import { sendAddedNotifications } from "@/lib/notify";
import { pushBookingToGoogle } from "@/lib/gcal-sync";
import { isValidStamp } from "@/lib/time";

export async function GET(request: Request) {
  const { session, denied } = await requireSession();
  if (denied) return denied;
  const url = new URL(request.url);

  if (url.searchParams.get("mine") === "1") {
    const uid = session!.user.id;
    const rows = await db.booking.findMany({
      where: {
        deletedAt: null,
        OR: [{ ownerId: uid }, { participants: { some: { userId: uid } } }],
      },
      orderBy: { start: "asc" },
      include: {
        type: true,
        owner: { include: { team: true } },
        assets: { include: { asset: true } },
        participants: { include: { user: { include: { team: true } } } },
      },
    });
    return NextResponse.json(rows.map(shapeBooking));
  }

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const assetId = url.searchParams.get("assetId") ?? undefined;
  if (!isValidStamp(from) || !isValidStamp(to) || from >= to) {
    return NextResponse.json({ error: "A valid from/to range is required." }, { status: 400 });
  }
  const rows = await db.booking.findMany({
    where: {
      deletedAt: null,
      start: { lt: to },
      end: { gt: from },
      ...(assetId ? { assets: { some: { assetId } } } : {}),
    },
    orderBy: { start: "asc" },
    include: {
      type: true,
      owner: { include: { team: true } },
      assets: { include: { asset: true } },
      participants: { include: { user: { include: { team: true } } } },
    },
  });
  return NextResponse.json(rows.map(shapeBooking));
}

export async function POST(request: Request) {
  const { session, denied } = await requireSession();
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Nothing submitted." }, { status: 400 });

  const settings = await getSettings();
  const parsed = parseBookingInput(body, settings, nowStampInZone(settings.timezone));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.input;

  const ownerId = session!.user.id;
  const participantIds = [...new Set([...input.participantIds])];

  const outcome = await db.$transaction(async (tx) => {
    const refsError = await checkRefsExist(tx, participantIds, input.typeId);
    if (refsError) return { created: false as const, error: refsError, clashes: undefined as AssetClash[] | undefined };

    const assets = await checkAssetsExist(tx, input.assetIds);
    if ("error" in assets) return { created: false as const, error: assets.error, clashes: undefined as AssetClash[] | undefined };

    const clashes = await findAssetClashes(tx, input.assetIds, input.start, input.end);
    if (clashes.length > 0) return { created: false as const, error: "", clashes };

    const created = await tx.booking.create({
      data: {
        title: input.title,
        typeId: input.typeId,
        ownerId,
        start: input.start,
        end: input.end,
        notes: input.notes,
        color: input.color,
        assets: { create: input.assetIds.map((assetId) => ({ assetId })) },
        participants: { create: participantIds.map((userId) => ({ userId })) },
      },
      include: {
        type: true,
        owner: { include: { team: true } },
        assets: { include: { asset: true } },
        participants: { include: { user: { include: { team: true } } } },
      },
    });
    return { created: true as const, booking: created, newlyAdded: participantIds };
  });

  if (!outcome.created) {
    if (outcome.clashes && outcome.clashes.length > 0) {
      const c = outcome.clashes[0];
      return NextResponse.json(
        {
          error: `“${c.assetName}” is already held by ${c.userName}${c.teamName ? ` (${c.teamName})` : ""} — ${c.title}.`,
          conflict: {
            assetName: c.assetName,
            userName: c.userName,
            teamName: c.teamName,
            title: c.title,
            start: c.start,
            end: c.end,
          },
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: outcome.error }, { status: 400 });
  }

  const shaped = shapeBooking(outcome.booking);
  // Notify the crew — outside the transaction, best-effort.
  void sendAddedNotifications(shaped, session!.user.name ?? "A teammate", outcome.newlyAdded.filter((id) => id !== ownerId));
  // Mirror the booking into each involved person's Google calendar.
  pushBookingToGoogle(shaped.id, "upsert");
  return NextResponse.json(shaped, { status: 201 });
}
