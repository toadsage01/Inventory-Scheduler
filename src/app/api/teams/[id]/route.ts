import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/guard";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { denied } = await requirePermission("canManagePeople");
  if (denied) return denied;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const name = body?.name?.toString().trim();
  if (!name) {
    return NextResponse.json({ error: "Team name is required." }, { status: 400 });
  }
  const clash = await db.team.findFirst({ where: { name, id: { not: id }, deletedAt: null } });
  if (clash) {
    return NextResponse.json({ error: "A team with that name already exists." }, { status: 409 });
  }
  try {
    const team = await db.team.update({ where: { id }, data: { name } });
    return NextResponse.json({ id: team.id, name: team.name });
  } catch {
    return NextResponse.json({ error: "Team not found." }, { status: 404 });
  }
}

/** Retire a team — soft delete, restorable from the admin Trash. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, denied } = await requirePermission("canManagePeople");
  if (denied) return denied;
  const { id } = await params;
  try {
    await db.team.update({
      where: { id },
      data: { deletedAt: new Date(), deletedByName: session!.user.name ?? "someone" },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Team not found." }, { status: 404 });
  }
}
