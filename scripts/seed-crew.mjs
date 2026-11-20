// Seeds the studio crew from the real employee sheet: each person gets
// their own face photo (public/faces) as the pfp and their department as
// the team. Passwords are deliberately unguessable — these are roster
// placeholders; an admin resets a password when someone actually starts
// signing in.
// Run: DATABASE_URL=... node scripts/seed-crew.mjs
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const db = new PrismaClient();

// Faces: the studio's five die-cut stickers (gender-matched where we
// can) plus Arushi's real photo — five stickers, six people. The
// seed updates existing rows at boot, so a live database converges.
const CREW = [
  { name: "Arushi Chawla", email: "arushi@studio.local", pfp: "/faces/arushi.png", team: "Praper" },
  { name: "Azkiya Qamar", email: "azky@studio.local", pfp: "/faces/sticker-3.png", team: "Praper" },
  { name: "Bhakti Arora", email: "bhakti@studio.local", pfp: "/faces/sticker-2.png", team: "Pave" },
  { name: "Harsh Arora", email: "harsh@studio.local", pfp: "/faces/sticker-1.png", team: "Pave" },
  { name: "Jasmine Rawat", email: "jasmine@studio.local", pfp: "/faces/sticker-5.png", team: "Prave & Pave" },
  { name: "Sehaj Singh", email: "sehaj@studio.local", pfp: "/faces/sticker-4.png", team: "Praper" },
];

function unknowablePasswordHash() {
  const pw = randomBytes(32).toString("hex");
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

for (const member of CREW) {
  const team = await db.team.findFirst({ where: { name: member.team, deletedAt: null } });
  const existing = await db.user.findUnique({ where: { email: member.email } });
  if (existing) {
    await db.user.update({
      where: { email: member.email },
      data: { name: member.name, pfp: member.pfp, teamId: team?.id ?? existing.teamId },
    });
    console.log("updated", member.name);
  } else {
    await db.user.create({
      data: {
        email: member.email,
        name: member.name,
        passwordHash: unknowablePasswordHash(),
        role: "MEMBER",
        pfp: member.pfp,
        teamId: team?.id ?? null,
      },
    });
    console.log("created", member.name);
  }
}

// The studio's three working groups and the current shoot-kind colours —
// ensured at every boot so an older database converges on the same
// options without any manual seeding. Upsert = safe to run forever.
const BRAND_TEAMS = ["Praper", "Pave", "Prave & Pave"];
for (const name of BRAND_TEAMS) {
  const existing = await db.team.findFirst({ where: { name, deletedAt: null } });
  if (!existing) {
    await db.team.create({ data: { name } });
    console.log("team ensured:", name);
  }
}

const BOOKING_TYPES = [
  { name: "Shoot", color: "#3e97d8", sortOrder: 0 },
  { name: "Studio", color: "#8e7cc9", sortOrder: 1 },
  { name: "Edit", color: "#46a875", sortOrder: 2 },
  { name: "Delivery", color: "#de9a45", sortOrder: 3 },
  { name: "Meeting", color: "#d967a9", sortOrder: 4 },
];
for (const type of BOOKING_TYPES) {
  const existing = await db.bookingType.findFirst({ where: { name: type.name, deletedAt: null } });
  if (!existing) {
    await db.bookingType.create({ data: type });
    console.log("booking type created:", type.name);
  } else if (existing.color !== type.color) {
    await db.bookingType.update({ where: { id: existing.id }, data: { color: type.color } });
  }
}

await db.$disconnect();
