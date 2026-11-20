import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/guard";
import { pushBookingToGoogle } from "@/lib/gcal-sync";

/**
 * The Trash. Every delete in the app is a soft delete (deletedAt stamp),
 * so deletions are reversible:
 *   GET  — admin: list everything soft-deleted, newest first.
 *   POST — restore (undo) or purge (delete forever). Admins can do both
 *          for anything; the original deleter can restore their own kind.
 */

const TRASH_KINDS = ["booking", "asset", "type", "team"] as const;
type TrashKind = (typeof TRASH_KINDS)[number];

function isTrashKind(value: string): value is TrashKind {
  return (TRASH_KINDS as readonly string[]).includes(value);
}

/** Which power restores which kind; admins pass every check. */
function mayRestore(kind: TrashKind, role: string, flags: Record<string, boolean>, ownerId?: string, userId?: string): boolean {
  if (role === "ADMIN") return true;
  if (kind === "booking") return Boolean(flags.canManageBookings) || (ownerId !== undefined && ownerId === userId);
  if (kind === "asset") return Boolean(flags.canManageAssets);
  if (kind === "type") return Boolean(flags.canManageSettings);
  if (kind === "team") return Boolean(flags.canManagePeople);
  return false;
}

export async function GET() {
  const { session, denied } = await requireSession();
  if (denied) return denied;
  if (session!.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const [bookings, assets, types, teams] = await Promise.all([
    db.booking.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: 100,
      include: {
        type: true,
        owner: { include: { team: true } },
        assets: { include: { asset: true } },
        participants: { include: { user: true } },
      },
    }),
    db.asset.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: "desc" }, take: 200 }),
    db.bookingType.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: "desc" }, take: 100 }),
    db.team.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: "desc" }, take: 100, include: { users: { select: { id: true } } } }),
  ]);

  const items = [
    ...bookings.map((b) => ({
      kind: "booking" as const,
      id: b.id,
      label: b.title,
      detail: `${b.start.slice(0, 10)} → ${b.end.slice(0, 10)} · held by ${b.owner.name}`,
      deletedAt: b.deletedAt,
      deletedByName: b.deletedByName,
    })),
    ...assets.map((a) => ({
      kind: "asset" as const,
      id: a.id,
      label: a.name,
      detail: a.category,
      deletedAt: a.deletedAt,
      deletedByName: a.deletedByName,
    })),
    ...types.map((t) => ({
      kind: "type" as const,
      id: t.id,
      label: t.name,
      detail: t.color,
      deletedAt: t.deletedAt,
      deletedByName: t.deletedByName,
    })),
    ...teams.map((t) => ({
      kind: "team" as const,
      id: t.id,
      label: t.name,
      detail: `${t.users.length} member${t.users.length === 1 ? "" : "s"}`,
      deletedAt: t.deletedAt,
      deletedByName: t.deletedByName,
    })),
  ].sort((a, b) => String(b.deletedAt ?? "").localeCompare(String(a.deletedAt ?? "")));

  return NextResponse.json(items);
}

export async function POST(request: Request) {
  const { session, denied } = await requireSession();
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { kind?: string; id?: string; action?: string } | null;
  const kind = body?.kind ?? "";
  const id = body?.id ?? "";
  const action = body?.action ?? "";
  if (!isTrashKind(kind) || !id || (action !== "restore" && action !== "purge")) {
    return NextResponse.json({ error: "Expected kind, id and action (restore or purge)." }, { status: 400 });
  }

  const role = session!.user.role;
  const flags = {
    canManageBookings: Boolean(session!.user.canManageBookings),
    canManageAssets: Boolean(session!.user.canManageAssets),
    canManageSettings: Boolean(session!.user.canManageSettings),
    canManagePeople: Boolean(session!.user.canManagePeople),
  };

  if (action === "purge") {
    if (role !== "ADMIN") {
      return NextResponse.json({ error: "Only an admin can delete something forever." }, { status: 403 });
    }
  } else {
    // Restore: load the row so owner-scoped rules can be applied.
    let ownerId: string | undefined;
    if (kind === "booking") {
      const booking = await db.booking.findUnique({ where: { id }, select: { ownerId: true, deletedAt: true } });
      if (!booking) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
      ownerId = booking.ownerId;
    }
    if (!mayRestore(kind, role, flags, ownerId, session!.user.id)) {
      return NextResponse.json({ error: "You don't have permission to restore that. Ask an admin." }, { status: 403 });
    }
  }

  if (kind === "booking") {
    if (action === "restore") {
      await db.booking.update({ where: { id }, data: { deletedAt: null, deletedByName: null } });
      // Back onto everyone's Google mirror too, best-effort.
      pushBookingToGoogle(id, "upsert");
      return NextResponse.json({ ok: true });
    }
    await db.booking.delete({ where: { id } }); // gear + participant joins cascade
    return NextResponse.json({ ok: true });
  }

  if (kind === "asset") {
    if (action === "restore") {
      await db.asset.update({ where: { id }, data: { deletedAt: null, deletedByName: null, active: true } });
      return NextResponse.json({ ok: true });
    }
    const refs = await db.bookingAsset.count({ where: { assetId: id } });
    if (refs > 0) {
      return NextResponse.json(
        { error: `This gear is referenced by ${refs} booking${refs === 1 ? "" : "s"} on record — keep it in the trash instead of purging.` },
        { status: 409 },
      );
    }
    await db.asset.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }

  if (kind === "type") {
    if (action === "restore") {
      await db.bookingType.update({ where: { id }, data: { deletedAt: null, deletedByName: null } });
      return NextResponse.json({ ok: true });
    }
    const refs = await db.booking.count({ where: { typeId: id } });
    if (refs > 0) {
      return NextResponse.json(
        { error: `${refs} booking${refs === 1 ? "" : "s"} still use this type — keep it in the trash instead of purging.` },
        { status: 409 },
      );
    }
    await db.bookingType.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }

  if (kind === "team") {
    if (action === "restore") {
      await db.team.update({ where: { id }, data: { deletedAt: null, deletedByName: null } });
      return NextResponse.json({ ok: true });
    }
    const members = await db.user.count({ where: { teamId: id } });
    if (members > 0) {
      return NextResponse.json({ error: `${members} member${members === 1 ? " is" : "s are"} still assigned to this team — move them first.` }, { status: 409 });
    }
    await db.team.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown kind." }, { status: 400 });
}
