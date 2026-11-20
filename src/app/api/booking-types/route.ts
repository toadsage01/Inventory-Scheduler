import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, requireSession } from "@/lib/guard";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export async function GET() {
  const { denied } = await requireSession();
  if (denied) return denied;
  const types = await db.bookingType.findMany({
    where: { deletedAt: null },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json(types);
}

export async function POST(request: Request) {
  const { denied } = await requirePermission("canManageSettings");
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const name = body?.name?.toString().trim();
  if (!name) {
    return NextResponse.json({ error: "Give the booking type a name." }, { status: 400 });
  }
  const existing = await db.bookingType.findFirst({ where: { name, deletedAt: null } });
  if (existing) {
    return NextResponse.json({ error: "That booking type already exists." }, { status: 409 });
  }
  const count = await db.bookingType.count({ where: { deletedAt: null } });
  const type = await db.bookingType.create({
    data: {
      name: name.slice(0, 40),
      color: HEX_RE.test(body?.color?.toString() ?? "") ? (body.color.toString() as string) : "#f59e0b",
      sortOrder: count,
    },
  });
  return NextResponse.json(type, { status: 201 });
}
