import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { authOptions } from "@/lib/auth";

export type PermissionFlag = "canManageAssets" | "canManageBookings" | "canManagePeople" | "canManageSettings";

interface Guarded {
  session: Session | null;
  denied: NextResponse | null;
}

/**
 * Sessions are backed by a fresh database read, so a role or permission
 * an admin revokes takes effect on the very next request — not after
 * the token expires.
 */
export async function requireSession(): Promise<Guarded> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { session: null, denied: NextResponse.json({ error: "Sign in required." }, { status: 401 }) };
  }
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { id: true } });
  if (!user) {
    return { session: null, denied: NextResponse.json({ error: "Sign in required." }, { status: 401 }) };
  }
  return { session, denied: null };
}

export async function requireAdmin(): Promise<Guarded> {
  const guarded = await requireSession();
  if (guarded.denied) return guarded;
  if (guarded.session!.user.role !== "ADMIN") {
    return { session: null, denied: NextResponse.json({ error: "Admin access required." }, { status: 403 }) };
  }
  return guarded;
}

/** Admins hold every permission by default; others need the explicit flag. */
export async function requirePermission(flag: PermissionFlag): Promise<Guarded> {
  const guarded = await requireSession();
  if (guarded.denied) return guarded;
  const session = guarded.session!;
  if (session.user.role === "ADMIN") return guarded;
  if (!session.user[flag]) {
    return {
      session: null,
      denied: NextResponse.json({ error: "You don't have permission for that. Ask an admin." }, { status: 403 }),
    };
  }
  return guarded;
}
