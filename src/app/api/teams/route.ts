import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, requireSession } from "@/lib/guard";

export async function GET() {
  const { denied } = await requireSession();
  if (denied) return denied;
  const teams = await db.team.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    include: { _count: { select: { users: true } } },
  });
  return NextResponse.json(
    teams.map((team) => ({
      id: team.id,
      name: team.name,
      memberCount: team._count.users,
    })),
  );
}

export async function POST(request: Request) {
  const { denied } = await requirePermission("canManagePeople");
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const name = body?.name?.toString().trim();
  if (!name) {
    return NextResponse.json({ error: "Team name is required." }, { status: 400 });
  }
  const existing = await db.team.findFirst({ where: { name, deletedAt: null } });
  if (existing) {
    return NextResponse.json({ error: "A team with that name already exists." }, { status: 409 });
  }
  const team = await db.team.create({ data: { name } });
  return NextResponse.json({ id: team.id, name: team.name }, { status: 201 });
}
