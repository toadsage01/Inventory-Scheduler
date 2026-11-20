import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/guard";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { denied } = await requirePermission("canManageSettings");
  if (denied) return denied;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  const name = body.name?.toString().trim();
  if (name === "") return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
  if (name) {
    const clash = await db.bookingType.findFirst({ where: { name, id: { not: id } } });
    if (clash) return NextResponse.json({ error: "That booking type already exists." }, { status: 409 });
  }

  try {
    const type = await db.bookingType.update({
      where: { id },
      data: {
        ...(name ? { name: name.slice(0, 40) } : {}),
        ...(body.color !== undefined && HEX_RE.test(body.color?.toString() ?? "")
          ? { color: body.color.toString() }
          : {}),
      },
    });
    return NextResponse.json(type);
  } catch {
    return NextResponse.json({ error: "Booking type not found." }, { status: 404 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, denied } = await requirePermission("canManageSettings");
  if (denied) return denied;
  const { id } = await params;
  // Soft delete — bookings that use the type keep their colour; the type
  // just leaves the picker until it is restored from the Trash.
  try {
    await db.bookingType.update({
      where: { id },
      data: { deletedAt: new Date(), deletedByName: session!.user.name ?? "someone" },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Booking type not found." }, { status: 404 });
  }
}
