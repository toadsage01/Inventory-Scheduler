// One-time seed: the two teams, booking types, studio rooms, and a starter
// set of gear. Run with: bun prisma/seed.ts   (safe to re-run — it upserts)
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "crypto";

const db = new PrismaClient();

const TEAMS = ["Praper", "Pave", "Prave & Pave"];

const BOOKING_TYPES = [
  { name: "Shoot", color: "#3e97d8", sortOrder: 0 },
  { name: "Studio", color: "#8e7cc9", sortOrder: 1 },
  { name: "Edit", color: "#46a875", sortOrder: 2 },
  { name: "Delivery", color: "#de9a45", sortOrder: 3 },
  { name: "Meeting", color: "#d967a9", sortOrder: 4 },
];

const ROOMS = [
  {
    name: "Studio Room 1 · Praper",
    category: "Studio Room",
    tag: "ROOM-1",
    notes: "Main studio floor. Book the room itself for long spans; pick up its gear separately.",
  },
  {
    name: "Studio Room 2 · Pave",
    category: "Studio Room",
    tag: "ROOM-2",
    notes: "Second studio floor, built for podcast and portrait setups.",
  },
];

const GEAR = [
  { name: "Sony A7 IV body", category: "Camera", tag: "GEAR-001", notes: "Two batteries in the kit bag." },
  { name: "Canon R6 Mark II body", category: "Camera", tag: "GEAR-002" },
  { name: "DJI Air 3 fly-more combo", category: "Drone", tag: "GEAR-003", notes: "Three batteries, ND set included." },
  { name: "Sigma 24-70mm f/2.8 DG DN", category: "Lens", tag: "GEAR-004" },
  { name: "Tamron 70-200mm f/2.8 G2", category: "Lens", tag: "GEAR-005" },
  { name: "Sennheiser MKE 600 shotgun kit", category: "Audio", tag: "GEAR-006", notes: "Deadcat and softie in the pouch." },
  { name: "Rode Wireless GO II dual set", category: "Audio", tag: "GEAR-007" },
  { name: "Godox SL60W light", category: "Lighting", tag: "GEAR-008", notes: "Stand and softbox borrowed separately." },
  { name: "Aputure Amaran 100d", category: "Lighting", tag: "GEAR-009" },
  { name: "DJI RS 3 gimbal", category: "Support", tag: "GEAR-010" },
  { name: "Manfrotto 055 tripod", category: "Support", tag: "GEAR-011" },
  { name: "GoPro Hero 12 action kit", category: "Camera", tag: "GEAR-012", notes: "Chest mount and spare battery." },
];


// Five crew members using the bundled sticker avatars as their
// pfps. Passwords are deliberately unguessable (random 32 bytes) — these
// are roster placeholders; an admin resets a password when someone joins
// for real. Safe to re-run: existing members only get their face refreshed.
const CREW = [
  { name: "Meera Pai", email: "meera@studio.local", pfp: "/avatars/crew-1.png", team: "Team A" },
  { name: "Kabir Shah", email: "kabir@studio.local", pfp: "/avatars/crew-2.png", team: "Team B" },
  { name: "Tanya Rao", email: "tanya@studio.local", pfp: "/avatars/crew-3.png", team: "Team A" },
  { name: "Vivaan Joshi", email: "vivaan@studio.local", pfp: "/avatars/crew-4.png", team: "Team B" },
  { name: "Naina Bose", email: "naina@studio.local", pfp: "/avatars/crew-5.png", team: "Team A" },
];

async function seedCrew() {
  for (const member of CREW) {
    const team = await db.team.findFirst({ where: { name: member.team, deletedAt: null } });
    const existing = await db.user.findUnique({ where: { email: member.email } });
    if (existing) {
      await db.user.update({
        where: { email: member.email },
        data: { name: member.name, pfp: member.pfp, teamId: team?.id ?? existing.teamId },
      });
      continue;
    }
    const pw = randomBytes(32).toString("hex");
    const salt = randomBytes(16).toString("hex");
    const passwordHash = `scrypt:${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
    await db.user.create({
      data: { email: member.email, name: member.name, passwordHash, role: "MEMBER", pfp: member.pfp, teamId: team?.id ?? null },
    });
  }
}

async function main() {
  for (const name of TEAMS) {
    await db.team.upsert({ where: { name }, update: {}, create: { name } });
  }
  for (const type of BOOKING_TYPES) {
    // Refresh the colour too, so an older database picks up the current palette.
    await db.bookingType.upsert({ where: { name: type.name }, update: { color: type.color }, create: type });
  }
  for (const item of [...ROOMS, ...GEAR]) {
    const existing = await db.asset.findFirst({ where: { name: item.name } });
    if (!existing) {
      await db.asset.create({ data: item });
    }
  }
  await seedCrew();

  const teamCount = await db.team.count();
  const typeCount = await db.bookingType.count();
  const assetCount = await db.asset.count();
  console.log(`seed: ${teamCount} teams, ${typeCount} booking types, ${assetCount} bookable items ready`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
