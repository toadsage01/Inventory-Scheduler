import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/guard";

/** The notification outbox — delivery log for every email the app attempts. */
export async function GET() {
  const { denied } = await requirePermission("canManageSettings");
  if (denied) return denied;
  const rows = await db.notificationLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json(rows);
}
