import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { requirePermission } from "@/lib/guard";

const ROLES = ["ADMIN", "LEAD", "MEMBER"] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, denied } = await requirePermission("canManagePeople");
  if (denied) return denied;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  // The email is permanent — refuse before anything else so even people
  // with people-management powers get the explicit reason.
  if (body.email !== undefined) {
    return NextResponse.json(
      { error: "Email is permanent and cannot be changed." },
      { status: 400 },
    );
  }

  const nextRole = ROLES.includes(body.role) ? (body.role as (typeof ROLES)[number]) : undefined;
  if (session!.user.id === id && nextRole && nextRole !== "ADMIN") {
    return NextResponse.json({ error: "You cannot remove your own admin role." }, { status: 400 });
  }
  if (session!.user.id === id && body.canManagePeople === false) {
    return NextResponse.json({ error: "You cannot take away your own permissions." }, { status: 400 });
  }

  let passwordHash: string | undefined;
  if (body.password) {
    const password = body.password.toString();
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }
    passwordHash = hashPassword(password);
  }

  let teamId: string | null | undefined;
  if (body.teamId !== undefined) {
    teamId = body.teamId?.toString() || null;
    if (teamId) {
      const team = await db.team.findUnique({ where: { id: teamId } });
      if (!team) return NextResponse.json({ error: "Team not found." }, { status: 404 });
    }
  }

  try {
    const user = await db.user.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name?.toString().trim() || undefined } : {}),
        ...(nextRole ? { role: nextRole } : {}),
        ...(teamId !== undefined ? { teamId } : {}),
        ...(passwordHash ? { passwordHash } : {}),
        ...(body.canManageAssets !== undefined ? { canManageAssets: Boolean(body.canManageAssets) } : {}),
        ...(body.canManageBookings !== undefined ? { canManageBookings: Boolean(body.canManageBookings) } : {}),
        ...(body.canManagePeople !== undefined ? { canManagePeople: Boolean(body.canManagePeople) } : {}),
        ...(body.canManageSettings !== undefined ? { canManageSettings: Boolean(body.canManageSettings) } : {}),
        ...(body.notifyOnAdded !== undefined ? { notifyOnAdded: Boolean(body.notifyOnAdded) } : {}),
        ...(body.notifyReminder !== undefined ? { notifyReminder: Boolean(body.notifyReminder) } : {}),
        ...(body.pfp !== undefined
          ? {
              pfp: body.pfp === null
                ? null
                : typeof body.pfp === "string" && body.pfp.length <= 400_000
                  ? body.pfp
                  : undefined,
            }
          : {}),
      },
    });
    return NextResponse.json({ id: user.id, name: user.name, role: user.role, teamId: user.teamId });
  } catch {
    return NextResponse.json({ error: "Person not found." }, { status: 404 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, denied } = await requirePermission("canManagePeople");
  if (denied) return denied;
  const { id } = await params;
  if (session!.user.id === id) {
    return NextResponse.json({ error: "You cannot remove your own account." }, { status: 400 });
  }
  const owned = await db.booking.count({ where: { ownerId: id } });
  if (owned > 0) {
    return NextResponse.json(
      { error: "This person holds bookings. Cancel those first or hand them over." },
      { status: 409 },
    );
  }
  try {
    await db.user.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Person not found." }, { status: 404 });
  }
}
