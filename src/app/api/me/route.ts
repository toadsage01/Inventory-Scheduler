import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { requireSession } from "@/lib/guard";

/** The signed-in person's own profile and preferences. */
export async function GET() {
  const { session, denied } = await requireSession();
  if (denied) return denied;
  const user = await db.user.findUnique({
    where: { id: session!.user.id },
    include: { team: true },
  });
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    teamId: user.teamId,
    teamName: user.team?.name ?? null,
    pfp: user.pfp ?? null,
    canManageAssets: user.canManageAssets,
    canManageBookings: user.canManageBookings,
    canManagePeople: user.canManagePeople,
    canManageSettings: user.canManageSettings,
    googleConnected: Boolean(user.googleRefreshToken || user.googleAccessToken),
    notifyOnAdded: user.notifyOnAdded,
    notifyReminder: user.notifyReminder,
    defaultView: ["year", "month", "week", "day"].includes(user.defaultView) ? user.defaultView : "week",
    createdAt: user.createdAt,
  });
}

/**
 * Self-service edits only: name, portrait, notification choices, password.
 * The email is permanent by design — there is intentionally no way to
 * change it, not even for an admin.
 */
export async function PATCH(request: Request) {
  const { session, denied } = await requireSession();
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  if (body.email !== undefined) {
    return NextResponse.json(
      { error: "Email is permanent and cannot be changed." },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = body.name?.toString().trim();
    if (!name) return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
    data.name = name.slice(0, 80);
  }

  if (body.pfp !== undefined) {
    const pfp = body.pfp === null ? null : body.pfp?.toString() ?? null;
    if (pfp && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(pfp)) {
      return NextResponse.json({ error: "Portrait must be a small PNG/JPEG/WebP image." }, { status: 400 });
    }
    if (pfp && pfp.length > 400_000) {
      return NextResponse.json({ error: "Portrait is too large — keep it under 300 KB." }, { status: 413 });
    }
    data.pfp = pfp;
  }

  if (body.notifyOnAdded !== undefined) data.notifyOnAdded = Boolean(body.notifyOnAdded);
  if (body.notifyReminder !== undefined) data.notifyReminder = Boolean(body.notifyReminder);

  if (body.defaultView !== undefined) {
    const view = body.defaultView?.toString();
    if (!view || !["year", "month", "week", "day"].includes(view)) {
      return NextResponse.json({ error: "Unknown calendar view." }, { status: 400 });
    }
    data.defaultView = view;
  }

  if (body.newPassword !== undefined) {
    const currentPassword = body.currentPassword?.toString() ?? "";
    const newPassword = body.newPassword?.toString() ?? "";
    if (newPassword.length < 8) {
      return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
    }
    const user = await db.user.findUnique({ where: { id: session!.user.id } });
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      return NextResponse.json({ error: "Your current password did not match." }, { status: 400 });
    }
    data.passwordHash = hashPassword(newPassword);
  }

  try {
    await db.user.update({ where: { id: session!.user.id }, data });
  } catch {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
