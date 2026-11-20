// One-time import of the employee asset sheet (see scripts/sheet-data.json)
// into the scheduler database.
//
//   DATABASE_URL="<direct Neon string>" IMPORT_EMAIL_DOMAIN=prapermedia.com \
//   IMPORT_PASSWORD='Temp!ChangeMe' npx tsx scripts/import-from-sheet.mjs
//
// What it does, idempotently (safe to run twice):
//   • Creates one Team per department found in the sheet.
//   • Creates every employee as a plain MEMBER — role and the four
//     canManage* powers are never granted or modified here. Existing
//     accounts (matched by email) are left completely untouched.
//   • Emails are derived from names + IMPORT_EMAIL_DOMAIN; they are
//     permanent in the app, so check the domain before the first run.
//   • Every shared temporary password (IMPORT_PASSWORD) needs changing
//     by each person after their first sign-in.
//   • Team portraits are served from public/faces/ and
//     attached to each person — new accounts always, existing accounts
//     only when they have not picked a portrait of their own yet.
//   • Creates/updates one Asset per Asset Id, tagged with that id, with
//     the holding employee, department, type and condition in Notes.
//     Existing assets with the same tag get their notes refreshed.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const here = dirname(fileURLToPath(import.meta.url));
const sheet = JSON.parse(readFileSync(join(here, "sheet-data.json"), "utf8"));

const EMAIL_DOMAIN = (process.env.IMPORT_EMAIL_DOMAIN || "prapermedia.com").replace(/^@/, "");
const TEMP_PASSWORD = process.env.IMPORT_PASSWORD || "Praper@2026";

const prisma = new PrismaClient();

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function emailFor(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.{2,}/g, ".");
  return `${slug}@${EMAIL_DOMAIN}`;
}

// Team portraits shipped in public/faces/.
// Keyed by first name; "azky.png" is Azkiya's file.
const PORTRAIT_BY_FIRST_NAME = {
  arushi: "arushi.png",
  azkiya: "azky.png",
  bhakti: "bhakti.png",
  harsh: "harsh.png",
  jasmine: "jasmine.png",
  sehaj: "sehaj.png",
};

function portraitFor(name) {
  const first = (name || "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return PORTRAIT_BY_FIRST_NAME[first] ?? null;
}

async function main() {
  let teamsCreated = 0;
  let usersCreated = 0;
  let usersSkipped = 0;
  let portraitsAttached = 0;
  let assetsCreated = 0;
  let assetsUpdated = 0;

  // 1. Teams by department.
  const teamIds = new Map();
  const departments = [...new Set(sheet.employees.map((e) => e.dept).filter(Boolean))];
  for (const name of departments) {
    const team = await prisma.team.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    teamIds.set(name, team.id);
    if (team.createdAt && Date.now() - new Date(team.createdAt).getTime() < 5000) teamsCreated += 1;
  }

  // 2. People — plain members, never privileged.
  for (const emp of sheet.employees) {
    const email = emailFor(emp.name);
    const portrait = portraitFor(emp.name);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Never overwrite a portrait someone picked themselves.
      if (portrait && !existing.pfp) {
        await prisma.user.update({ where: { id: existing.id }, data: { pfp: `/faces/${portrait}` } });
        portraitsAttached += 1;
      }
      usersSkipped += 1;
      continue;
    }
    await prisma.user.create({
      data: {
        email,
        name: emp.name,
        passwordHash: hashPassword(TEMP_PASSWORD),
        role: "MEMBER", // deliberately plain — powers stay false by default
        teamId: teamIds.get(emp.dept) ?? null,
        ...(portrait ? { pfp: `/faces/${portrait}` } : {}),
      },
    });
    usersCreated += 1;
  }

  // 3. Assets keyed by the company Asset Id in `tag`.
  for (const row of sheet.assignments) {
    const notes = [
      `Held by ${row.name}`,
      row.dept ? row.dept : null,
      row.type ? row.type : null,
      row.cond ? `condition: ${row.cond}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const existing = await prisma.asset.findFirst({ where: { tag: row.assetid } });
    if (existing) {
      await prisma.asset.update({
        where: { id: existing.id },
        data: { name: row.asset, notes },
      });
      assetsUpdated += 1;
    } else {
      await prisma.asset.create({
        data: { name: row.asset, category: row.cat || "General", tag: row.assetid, notes, active: true },
      });
      assetsCreated += 1;
    }
  }

  console.log("Import summary");
  console.log(`  teams:       ${teamsCreated} created (${teamIds.size} total)`);
  console.log(`  people:      ${usersCreated} created, ${usersSkipped} already existed (untouched)`);
  console.log(`  portraits:   ${portraitsAttached} attached from public/faces/`);
  console.log(`  assets:      ${assetsCreated} created, ${assetsUpdated} refreshed`);
  console.log(`  temp password for new people: ${TEMP_PASSWORD} — ask them to change it under their profile.`);
  console.log(`  emails look like: ${emailFor(sheet.employees[0]?.name || "First Last")}`);
}

main()
  .catch((err) => {
    console.error("Import failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
