import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { requirePermission } from "@/lib/guard";
import { csvToObjects } from "@/lib/csv";

interface ImportBody {
  area?: string;
  format?: string;
  payload?: string;
}

const LETTERS = "abcdefghjkmnpqrstuvwxyz23456789";

function randomPassword(): string {
  let out = "";
  for (let i = 0; i < 12; i += 1) {
    out += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  }
  return out;
}

/**
 * Data in. Accepts CSV text (a Google Sheet exported as CSV works as-is)
 * or a JSON array of row objects. Matching is by name for gear and types,
 * by email for people, and bookings reference both by name.
 */
export async function POST(request: Request) {
  const { session, denied } = await requirePermission("canManageSettings");
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as ImportBody | null;
  const area = body?.area ?? "";
  const payload = body?.payload ?? "";
  if (!payload.trim()) {
    return NextResponse.json({ error: "Nothing to import — paste CSV or JSON first." }, { status: 400 });
  }

  let rows: Array<Record<string, string>> = [];
  if (body?.format === "json" || payload.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(payload);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      rows = parsed.map((row) => {
        const obj: Record<string, string> = {};
        for (const [key, value] of Object.entries(row ?? {})) obj[key.toLowerCase()] = value === null || value === undefined ? "" : String(value);
        return obj;
      });
    } catch {
      return NextResponse.json({ error: "That JSON did not parse as an array of rows." }, { status: 400 });
    }
  } else {
    rows = csvToObjects(payload);
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "No data rows found — is there a header row?" }, { status: 400 });
  }
  if (rows.length > 2000) {
    return NextResponse.json({ error: "Import at most 2000 rows at a time." }, { status: 400 });
  }

  if (area === "assets") {
    const gate = await requirePermission("canManageAssets");
    if (gate.denied) return gate.denied;
    return importAssets(rows);
  }
  if (area === "bookings") {
    const gate = await requirePermission("canManageBookings");
    if (gate.denied) return gate.denied;
    return importBookings(rows, session!.user.id);
  }
  if (area === "people") {
    const gate = await requirePermission("canManagePeople");
    if (gate.denied) return gate.denied;
    return importPeople(rows);
  }
  return NextResponse.json({ error: "Unknown import area — use assets, bookings, or people." }, { status: 400 });
}

function tidyWord(word: string): string {
  // ALL-CAPS spreadsheet values ("BATTERY CHARGER") read better in title case.
  return word.replace(/\b[A-Z]{2,}\b/g, (w) => w[0] + w.slice(1).toLowerCase());
}

/**
 * Accepts plain gear lists (name,category,tag,notes) and real assignment
 * sheets like "Employee Assigned Assets" (Assigned Asset Name, Asset Id,
 * Asset Category, Asset Type, Asset Condition) without any reshaping.
 */
async function importAssets(rows: Array<Record<string, string>>) {
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  for (const [index, row] of rows.entries()) {
    const name =
      row.name?.trim() ||
      row["assigned asset name"]?.trim() ||
      row["asset name"]?.trim() ||
      row.gear?.trim() ||
      row.item?.trim();
    if (!name) {
      errors.push(`Row ${index + 2}: missing an asset name.`);
      continue;
    }
    const tag = row.tag?.trim() || row["asset id"]?.trim() || row.id?.trim() || null;
    const category = tidyWord(
      row["asset type"]?.trim() || row.category?.trim() || row["asset category"]?.trim() || "General",
    ).slice(0, 60);
    const broadCategory = row["asset category"]?.trim();
    const condition = row["asset condition"]?.trim();
    const notes =
      [
        row.notes?.trim() || null,
        broadCategory && broadCategory.toLowerCase() !== category.toLowerCase() ? broadCategory.trim() : null,
        condition ? `Condition: ${tidyWord(condition)}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || null;

    // Match by asset id/tag first so two "DIGITEK" units stay two items;
    // fall back to the name for tag-less sheets.
    const existing = tag
      ? (await db.asset.findFirst({ where: { tag } })) ?? (await db.asset.findFirst({ where: { name } }))
      : await db.asset.findFirst({ where: { name } });
    const data = { category, tag, notes };
    if (existing) {
      await db.asset.update({ where: { id: existing.id }, data: { ...data, name: name.slice(0, 120) } });
      updated += 1;
    } else {
      await db.asset.create({ data: { name: name.slice(0, 120), ...data } });
      created += 1;
    }
  }
  return NextResponse.json({ created, updated, errors: errors.slice(0, 20) });
}

async function importBookings(rows: Array<Record<string, string>>, importerId: string) {
  let created = 0;
  const errors: string[] = [];

  const assets = await db.asset.findMany();
  const types = await db.bookingType.findMany();
  const users = await db.user.findMany();
  const assetByName = new Map(assets.map((a) => [a.name.toLowerCase(), a]));
  const typeByName = new Map(types.map((t) => [t.name.toLowerCase(), t]));
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const userByName = new Map(users.map((u) => [u.name.toLowerCase(), u]));

  for (const [index, row] of rows.entries()) {
    const line = index + 2;
    const title = row.title?.trim() || row.purpose?.trim();
    const start = (row.start ?? "").trim().replace(" ", "T");
    const end = (row.end ?? "").trim().replace(" ", "T");
    if (!title) {
      errors.push(`Row ${line}: missing a title.`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(end) || end <= start) {
      errors.push(`Row ${line}: start/end must look like 2026-11-09 10:00 and end after start.`);
      continue;
    }
    const assetNames = (row.assets ?? row.gear ?? "").split(/[;|]/).map((s) => s.trim()).filter(Boolean);
    const assetIds: string[] = [];
    for (const name of assetNames) {
      const asset = assetByName.get(name.toLowerCase());
      if (!asset) {
        errors.push(`Row ${line}: no gear named “${name}” — add it to the inventory first.`);
        continue;
      }
      assetIds.push(asset.id);
    }
    if (assetNames.length > 0 && assetIds.length === 0) continue;

    const type = typeByName.get((row.type ?? "").trim().toLowerCase());
    const owner = userByEmail.get((row.owner ?? "").trim().toLowerCase()) ?? userByName.get((row.owner ?? "").trim().toLowerCase()) ?? null;
    const participantRefs = (row.participants ?? row.with ?? "").split(/[;|]/).map((s) => s.trim()).filter(Boolean);
    const participantIds: string[] = [];
    for (const ref of participantRefs) {
      const person = userByEmail.get(ref.toLowerCase()) ?? userByName.get(ref.toLowerCase());
      if (!person) {
        errors.push(`Row ${line}: no person matched “${ref}”.`);
        continue;
      }
      participantIds.push(person.id);
    }

    try {
      await db.$transaction(async (tx) => {
        const clash = await tx.bookingAsset.findFirst({
          where: { assetId: { in: assetIds }, booking: { start: { lt: end }, end: { gt: start } } },
          include: { booking: { select: { title: true } }, asset: { select: { name: true } } },
        });
        if (clash) {
          throw new Error(`“${clash.asset.name}” is already booked then (${clash.booking.title}).`);
        }
        await tx.booking.create({
          data: {
            title: title.slice(0, 120),
            typeId: type?.id ?? null,
            ownerId: owner?.id ?? importerId,
            start,
            end,
            notes: row.notes?.trim() || null,
            assets: { create: assetIds.map((assetId) => ({ assetId })) },
            participants: { create: [...new Set(participantIds)].map((userId) => ({ userId })) },
          },
        });
      });
      created += 1;
    } catch (err) {
      errors.push(`Row ${line}: ${err instanceof Error ? err.message : "could not be imported."}`);
    }
  }
  return NextResponse.json({ created, updated: 0, errors: errors.slice(0, 20) });
}

async function importPeople(rows: Array<Record<string, string>>) {
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  const issuedPasswords: Array<{ email: string; password: string }> = [];
  const teams = await db.team.findMany();
  const teamByName = new Map(teams.map((t) => [t.name.toLowerCase(), t]));
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  for (const [index, row] of rows.entries()) {
    const line = index + 2;
    const email = (row.email ?? "").trim().toLowerCase();
    const name = row.name?.trim();
    if (!email || !EMAIL_RE.test(email)) {
      errors.push(`Row ${line}: a valid email is required.`);
      continue;
    }
    const team = teamByName.get((row.team ?? "").trim().toLowerCase());
    const role = ["ADMIN", "LEAD", "MEMBER"].includes((row.role ?? "").toUpperCase())
      ? (row.role.toUpperCase() as string)
      : "MEMBER";

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      await db.user.update({
        where: { id: existing.id },
        data: {
          ...(name ? { name } : {}),
          ...(row.team !== undefined ? { teamId: team?.id ?? null } : {}),
          ...(row.role ? { role } : {}),
          ...(row.canmanagebookings !== undefined ? { canManageBookings: row.canmanagebookings === "true" } : {}),
          ...(row.canmanageassets !== undefined ? { canManageAssets: row.canmanageassets === "true" } : {}),
        },
      });
      updated += 1;
      continue;
    }
    if (!name) {
      errors.push(`Row ${line}: new people need a name.`);
      continue;
    }
    const password = randomPassword();
    await db.user.create({
      data: {
        name,
        email,
        passwordHash: hashPassword(password),
        role,
        teamId: team?.id ?? null,
      },
    });
    issuedPasswords.push({ email, password });
    created += 1;
  }
  return NextResponse.json({ created, updated, errors: errors.slice(0, 20), issuedPasswords });
}
