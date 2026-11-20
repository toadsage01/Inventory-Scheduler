// The one-shot demo/boot seed: department teams, the standard booking
// types, the real gear list from the employee-assets sheet, the crew (see
// seed-crew.mjs), and a spread of sample bookings so the calendar shows
// off colours, multi-day bars and lane packing from the first minute.
//
// Everything here is idempotent:
//   - teams / types / assets / crew  → upsert, safe on every boot
//   - demo bookings                  → created only while their exact title
//     has never been used (even by a since-deleted booking), so your own
//     bookings are never touched and deleting a demo booking is permanent.
//
// Reads scripts/sheet-assets.json (the gear sheet extract).

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const db = new PrismaClient();
const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- teams
const TEAMS = ["Praper", "Pave", "Prave & Pave"];

// -------------------------------------------------------- booking types
const TYPES = [
  { name: "Shoot", color: "#3e97d8" },
  { name: "Studio", color: "#8e7cc9" },
  { name: "Edit", color: "#46a875" },
  { name: "Delivery", color: "#de9a45" },
  { name: "Meeting", color: "#d967a9" },
];

// ----------------------------------------------------------------- crew
// Same sticker mapping as seed-crew.mjs — the two seeds must agree.
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

// -------------------------------------------------- gear from the sheet
// [{ Item, Tag, Category, "Sub type", "Asset Condition", "Held by", Location }]
const sheet = JSON.parse(readFileSync(join(here, "sheet-assets.json"), "utf8"));
const ASSETS = sheet.map((row) => ({
  name: String(row["Item"] ?? "").trim(),
  tag: String(row["Tag"] ?? "").trim(),
  category: String(row["Category"] ?? "").trim() || "Uncategorised",
  notes: `${String(row["Sub type"] ?? row["Category"] ?? "gear").trim()} · held by ${String(row["Held by"] ?? "studio").trim()} (${String(row["Location"] ?? "Mohali").trim()}) · condition: ${String(row["Asset Condition"] ?? "—").trim()}`,
}));

// -------------------------------------------------------- demo bookings
// Titles are the uniqueness key: a booking only gets created while nobody
// — past or present — has used that exact title.
const DEMO_BOOKINGS = [
  {
    title: "Studio Podcast — Ep. 12",
    owner: "arushi@studio.local",
    with: ["bhakti@studio.local"],
    start: "2026-11-18T10:00",
    end: "2026-11-18T13:00",
    type: "Studio",
    color: "#46a875",
    gear: ["PR0436Y25", "PR0300Y25", "PR0435Y25"],
    notes: "Two-mic setup, ring light on the B cam.",
  },
  {
    title: "Client Ad Film — Night Shoot",
    owner: "sehaj@studio.local",
    with: ["harsh@studio.local", "azky@studio.local"],
    start: "2026-11-19T18:00",
    end: "2026-11-20T02:00",
    type: "Shoot",
    color: "#3e97d8",
    gear: ["PR0244Y26", "PR0414Y25", "PR0349Y25"],
    notes: "Overnight unit — returns gear by noon next day.",
  },
  {
    title: "Product Catalogue Shoot",
    owner: "jasmine@studio.local",
    with: [],
    start: "2026-11-23T09:00",
    end: "2026-11-25T18:00",
    type: "Shoot",
    color: "#e8850c",
    gear: ["PR0057Y26", "PR0438Y25", "PR0439Y25"],
    notes: "Three-day table-top marathon.",
  },
  {
    title: "Reel Batch — November",
    owner: "azky@studio.local",
    with: ["jasmine@studio.local"],
    start: "2026-11-24T11:00",
    end: "2026-11-24T16:00",
    type: "Shoot",
    color: "#8430ce",
    gear: ["PR0077Y26", "PR0464Y25"],
    notes: "Overlaps the catalogue shoot on purpose — colour check.",
  },
  {
    title: "YouTube Long-form Edit",
    owner: "harsh@studio.local",
    with: [],
    start: "2026-11-26T10:00",
    end: "2026-11-28T17:00",
    type: "Edit",
    color: "#0e8f8f",
    gear: ["PR0402Y25"],
    notes: "",
  },
  {
    title: "Wedding Highlight Edit",
    owner: "bhakti@studio.local",
    with: ["harsh@studio.local"],
    start: "2026-11-27T09:00",
    end: "2026-11-27T15:00",
    type: "Edit",
    color: "#c93264",
    gear: [],
    notes: "Sits on top of the long-form edit — lane check.",
  },
  {
    title: "Team Review — Weekly",
    owner: "sehaj@studio.local",
    with: ["arushi@studio.local", "azky@studio.local", "bhakti@studio.local", "harsh@studio.local", "jasmine@studio.local"],
    start: "2026-11-30T10:00",
    end: "2026-11-30T11:00",
    type: "Meeting",
    color: null,
    gear: [],
    notes: "Auto colour — follows the Meeting type.",
  },
  {
    title: "Brand Film — Drone Unit",
    owner: "harsh@studio.local",
    with: ["sehaj@studio.local"],
    start: "2026-12-04T08:00",
    end: "2026-12-08T19:00",
    type: "Shoot",
    color: "#d967a9",
    gear: ["PR0244Y26", "PR0338Y25", "PR0059Y26"],
    notes: "Crosses the week boundary — wraps to a new row with the capsule at the end.",
  },
  {
    title: "Podcast Set Rebuild",
    owner: "arushi@studio.local",
    with: ["bhakti@studio.local"],
    start: "2026-12-08T14:00",
    end: "2026-12-09T18:00",
    type: "Studio",
    color: null,
    gear: ["PR0431Y25", "PR0434Y25"],
    notes: "Green screen pipes come down; auto colour.",
  },
  {
    title: "December Content Planning",
    owner: "jasmine@studio.local",
    with: ["arushi@studio.local", "azky@studio.local", "bhakti@studio.local", "harsh@studio.local", "sehaj@studio.local"],
    start: "2026-12-10T10:00",
    end: "2026-12-10T12:00",
    type: "Meeting",
    color: "#3e97d8",
    gear: [],
    notes: "",
  },
];

// ------------------------------------------------------------------ run
async function main() {
  const teamIds = new Map();
  for (const name of TEAMS) {
    const existing = await db.team.findFirst({ where: { name, deletedAt: null } });
    const team = existing ?? (await db.team.create({ data: { name } }));
    teamIds.set(name, team.id);
  }
  console.log(`teams: ${teamIds.size}`);

  for (const type of TYPES) {
    const existing = await db.bookingType.findFirst({ where: { name: type.name, deletedAt: null } });
    if (!existing) await db.bookingType.create({ data: type });
  }
  console.log("booking types: ready");

  let assetCount = 0;
  for (const asset of ASSETS) {
    const existing = await db.asset.findFirst({ where: { tag: asset.tag, deletedAt: null } });
    if (!existing) {
      await db.asset.create({ data: { name: asset.name, tag: asset.tag, category: asset.category, notes: asset.notes } });
      assetCount += 1;
    }
  }
  console.log(`assets: +${assetCount} new of ${ASSETS.length}`);

  const crewIds = new Map();
  for (const member of CREW) {
    const team = await db.team.findFirst({ where: { name: member.team, deletedAt: null } });
    const existing = await db.user.findUnique({ where: { email: member.email } });
    const user = existing
      ? await db.user.update({
          where: { email: member.email },
          data: { name: member.name, pfp: member.pfp, teamId: team?.id ?? existing.teamId },
        })
      : await db.user.create({
          data: {
            email: member.email,
            name: member.name,
            passwordHash: unknowablePasswordHash(),
            role: "MEMBER",
            pfp: member.pfp,
            teamId: team?.id ?? null,
          },
        });
    crewIds.set(member.email, user.id);
  }
  console.log(`crew: ${crewIds.size} with real faces`);

  const allAssets = await db.asset.findMany({ where: { deletedAt: null }, select: { id: true, tag: true } });
  const assetIdByTag = new Map(allAssets.map((a) => [a.tag, a.id]));

  let booked = 0;
  for (const demo of DEMO_BOOKINGS) {
    // Even a soft-deleted booking keeps its title reserved, so a demo
    // booking you deleted stays deleted on the next boot.
    const seen = await db.booking.findFirst({ where: { title: demo.title } });
    if (seen) continue;
    const ownerId = crewIds.get(demo.owner);
    if (!ownerId) continue;
    const participantIds = demo.with.map((email) => crewIds.get(email)).filter(Boolean);
    const assetIds = demo.gear.map((tag) => assetIdByTag.get(tag)).filter(Boolean);
    await db.booking.create({
      data: {
        title: demo.title,
        typeId: (await db.bookingType.findFirst({ where: { name: demo.type, deletedAt: null } }))?.id ?? null,
        ownerId,
        start: demo.start,
        end: demo.end,
        notes: demo.notes || null,
        color: demo.color,
        assets: { create: assetIds.map((assetId) => ({ assetId })) },
        participants: { create: participantIds.map((userId) => ({ userId })) },
      },
    });
    booked += 1;
  }
  console.log(`demo bookings: +${booked} of ${DEMO_BOOKINGS.length}`);
}

main()
  .catch((err) => {
    console.error("demo seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
