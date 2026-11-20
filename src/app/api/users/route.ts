import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { requirePermission } from "@/lib/guard";
import { emailAllowedByDomain, getSettings } from "@/lib/settings";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ["ADMIN", "LEAD", "MEMBER"] as const;

export async function GET() {
  const { denied } = await requirePermission("canManagePeople");
  if (denied) return denied;
  const users = await db.user.findMany({
    orderBy: { name: "asc" },
    include: { team: true },
  });
  return NextResponse.json(
    users.map((user) => ({
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
      notifyOnAdded: user.notifyOnAdded,
      notifyReminder: user.notifyReminder,
      createdAt: user.createdAt,
    })),
  );
}

export async function POST(request: Request) {
  const { denied } = await requirePermission("canManagePeople");
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const name = body?.name?.toString().trim();
  const email = body?.email?.toString().trim().toLowerCase();
  const password = body?.password?.toString();
  const role = ROLES.includes(body?.role) ? (body.role as (typeof ROLES)[number]) : "MEMBER";
  const teamId = body?.teamId?.toString() || null;

  if (!name || !email || !EMAIL_RE.test(email) || !password || password.length < 8) {
    return NextResponse.json(
      { error: "Name, a valid email, and a password of at least 8 characters are required." },
      { status: 400 },
    );
  }
  const settings = await getSettings();
  if (!emailAllowedByDomain(email, settings)) {
    return NextResponse.json(
      { error: `Only addresses on ${settings.allowedEmailDomains.join(", ")} can be used here.` },
      { status: 400 },
    );
  }
  const emailTaken = await db.user.findUnique({ where: { email } });
  if (emailTaken) {
    return NextResponse.json({ error: "That email already has an account." }, { status: 409 });
  }
  if (teamId) {
    const team = await db.team.findUnique({ where: { id: teamId } });
    if (!team) return NextResponse.json({ error: "Team not found." }, { status: 404 });
  }
  const user = await db.user.create({
    data: {
      name,
      email,
      passwordHash: hashPassword(password),
      role,
      teamId,
      canManageAssets: Boolean(body?.canManageAssets),
      canManageBookings: Boolean(body?.canManageBookings),
      canManagePeople: role === "ADMIN" ? true : Boolean(body?.canManagePeople),
      canManageSettings: Boolean(body?.canManageSettings),
    },
  });
  return NextResponse.json({ id: user.id }, { status: 201 });
}
