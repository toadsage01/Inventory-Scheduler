import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/guard";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { denied } = await requirePermission("canManageAssets");
  if (denied) return denied;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  const name = body.name?.toString().trim();
  if (name === "") {
    return NextResponse.json({ error: "Gear name cannot be empty." }, { status: 400 });
  }
  try {
    const asset = await db.asset.update({
      where: { id },
      data: {
        ...(name ? { name } : {}),
        ...(body.category !== undefined
          ? { category: body.category?.toString().trim() || "General" }
          : {}),
        ...(body.tag !== undefined ? { tag: body.tag?.toString().trim() || null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes?.toString().trim() || null } : {}),
        ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
      },
    });
    return NextResponse.json(asset);
  } catch {
    return NextResponse.json({ error: "Gear not found." }, { status: 404 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, denied } = await requirePermission("canManageAssets");
  if (denied) return denied;
  const { id } = await params;
  try {
    // Soft delete: the item disappears from every list, undoable via the
    // toast (or Settings → Trash). Old bookings that reference it keep
    // their history — no guard needed any more.
    await db.asset.update({
      where: { id },
      data: { deletedAt: new Date(), deletedByName: session!.user.name ?? "someone" },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Gear not found." }, { status: 404 });
  }
}
