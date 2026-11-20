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
import { sendAddedNotifications, sendCancelledNotifications } from "@/lib/notify";
import { pushBookingToGoogle } from "@/lib/gcal-sync";

/** Edit a booking — its holder, or someone with booking-management power. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, denied } = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  const existing = await db.booking.findUnique({
    where: { id },
    include: {
      participants: { select: { userId: true } },
      owner: { include: { team: true } },
      type: true,
      assets: { include: { asset: true } },
    },
  });
  if (!existing) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  if (existing.deletedAt) {
    return NextResponse.json({ error: "This booking was already cancelled — an admin can restore it from the Trash." }, { status: 409 });
  }

  const isOwner = existing.ownerId === session!.user.id;
  const canManage = session!.user.role === "ADMIN" || session!.user.canManageBookings;
  if (!isOwner && !canManage) {
    return NextResponse.json(
      { error: "Only the holder or a coordinator can edit this booking." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  const settings = await getSettings();
  const parsed = parseBookingInput(
    {
      title: body.title ?? existing.title,
      typeId: body.typeId !== undefined ? body.typeId : existing.typeId,
      start: body.start ?? existing.start,
      end: body.end ?? existing.end,
      notes: body.notes !== undefined ? body.notes : existing.notes,
      assetIds: body.assetIds ?? existing.assets.map((ba) => ba.assetId),
      participantIds: body.participantIds ?? existing.participants.map((bp) => bp.userId),
    },
    settings,
    nowStampInZone(settings.timezone),
  );
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.input;

  const previousParticipantIds = existing.participants.map((bp) => bp.userId);

  const outcome = await db.$transaction(async (tx) => {
    const refsError = await checkRefsExist(tx, input.participantIds, input.typeId);
    if (refsError) return { updated: false as const, error: refsError, clashes: undefined as AssetClash[] | undefined };

    const assets = await checkAssetsExist(tx, input.assetIds);
    if ("error" in assets) return { updated: false as const, error: assets.error, clashes: undefined as AssetClash[] | undefined };

    const clashes = await findAssetClashes(tx, input.assetIds, input.start, input.end, id);
    if (clashes.length > 0) return { updated: false as const, error: "", clashes };

    const updated = await tx.booking.update({
      where: { id },
      data: {
        title: input.title,
        typeId: input.typeId,
        start: input.start,
        end: input.end,
        notes: input.notes,
        color: input.color,
        assets: { deleteMany: {}, create: input.assetIds.map((assetId) => ({ assetId })) },
        participants: { deleteMany: {}, create: input.participantIds.map((userId) => ({ userId })) },
      },
      include: {
        type: true,
        owner: { include: { team: true } },
        assets: { include: { asset: true } },
        participants: { include: { user: { include: { team: true } } } },
      },
    });
    return { updated: true as const, booking: updated };
  });

  if (!outcome.updated) {
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
  const newlyAdded = input.participantIds.filter((pid) => !previousParticipantIds.includes(pid) && pid !== existing.ownerId);
  if (newlyAdded.length > 0) {
    void sendAddedNotifications(shaped, session!.user.name ?? "A teammate", newlyAdded);
  }
  // People who were dropped from the crew lose their calendar mirror;
  // everyone still in gets the updated event.
  const dropped = previousParticipantIds.filter((pid) => !input.participantIds.includes(pid) && pid !== existing.ownerId);
  if (dropped.length > 0) {
    pushBookingToGoogle(id, "delete", dropped);
  }
  pushBookingToGoogle(id, "upsert");
  return NextResponse.json(shaped);
}

/** Cancel a booking — its holder, or someone with booking-management power. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, denied } = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      type: true,
      owner: { include: { team: true } },
      assets: { include: { asset: true } },
      participants: { include: { user: { include: { team: true } } } },
    },
  });
  if (!booking) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }
  const isOwner = booking.ownerId === session!.user.id;
  const canManage = session!.user.role === "ADMIN" || session!.user.canManageBookings;
  if (!isOwner && !canManage) {
    return NextResponse.json({ error: "Only the holder or a coordinator can cancel a booking." }, { status: 403 });
  }

  const shaped = shapeBooking(booking);
  // Soft delete: the booking vanishes from every calendar and list, but
  // stays in the Trash so the undo ribbon (or an admin) can restore it.
  await db.booking.update({
    where: { id },
    data: { deletedAt: new Date(), deletedByName: session!.user.name ?? "someone" },
  });
  void sendCancelledNotifications(shaped, session!.user.id);
  // Everyone's mirror of this booking goes away with it.
  pushBookingToGoogle(id, "delete");
  return NextResponse.json({ ok: true });
}
