import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, requireSession } from "@/lib/guard";

export async function GET() {
  const { denied } = await requireSession();
  if (denied) return denied;
  const assets = await db.asset.findMany({
    where: { deletedAt: null },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(assets);
}

export async function POST(request: Request) {
  const { denied } = await requirePermission("canManageAssets");
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const name = body?.name?.toString().trim();
  if (!name) {
    return NextResponse.json({ error: "A name is required — gear or a room, it needs one." }, { status: 400 });
  }
  const asset = await db.asset.create({
    data: {
      name: name.slice(0, 120),
      category: body?.category?.toString().trim().slice(0, 60) || "General",
      tag: body?.tag?.toString().trim().slice(0, 60) || null,
      notes: body?.notes?.toString().trim().slice(0, 500) || null,
    },
  });
  return NextResponse.json(asset, { status: 201 });
}
