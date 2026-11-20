import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/guard";
import { objectsToCsv } from "@/lib/csv";
import { buildBackupPayload } from "@/lib/backup";

/**
 * Data out. CSV for spreadsheets, JSON for a full backup copy.
 * Anyone signed in can take a readable copy; the JSON backup (everything)
 * is limited to people who manage settings, since it contains password
 * hashes and SMTP details.
 */
export async function GET(request: Request) {
  const { session, denied } = await requireSession();
  if (denied) return denied;
  const url = new URL(request.url);
  const area = url.searchParams.get("area") ?? "assets";
  const format = url.searchParams.get("format") === "json" ? "json" : "csv";
  const stamp = new Date().toISOString().slice(0, 10);
  const canManageSettings = session!.user.role === "ADMIN" || session!.user.canManageSettings;

  if (area === "all") {
    if (!canManageSettings) {
      return NextResponse.json({ error: "The full backup is limited to people who manage settings." }, { status: 403 });
    }
    const payload = await buildBackupPayload();
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="scheduler-backup-${stamp}.json"`,
      },
    });
  }

  if (area === "assets") {
    const assets = await db.asset.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
    return csvOrJson(format, `gear-${stamp}.csv`, objectsToCsv(assets, ["name", "category", "tag", "notes", "active"]), assets);
  }

  if (area === "types") {
    const types = await db.bookingType.findMany({ orderBy: { sortOrder: "asc" } });
    return csvOrJson(format, `booking-types-${stamp}.csv`, objectsToCsv(types, ["name", "color"]), types);
  }

  if (area === "people") {
    const users = await db.user.findMany({ include: { team: true }, orderBy: { name: "asc" } });
    const rows = users.map((u) => ({
      name: u.name,
      email: u.email,
      role: u.role,
      team: u.team?.name ?? "",
      canManageAssets: u.canManageAssets,
      canManageBookings: u.canManageBookings,
      canManagePeople: u.canManagePeople,
      canManageSettings: u.canManageSettings,
      notifyOnAdded: u.notifyOnAdded,
      notifyReminder: u.notifyReminder,
    }));
    return csvOrJson(
      format,
      `people-${stamp}.csv`,
      objectsToCsv(rows, ["name", "email", "role", "team", "canManageAssets", "canManageBookings", "canManagePeople", "canManageSettings", "notifyOnAdded", "notifyReminder"]),
      rows,
    );
  }

  if (area === "bookings") {
    const bookings = await db.booking.findMany({
      orderBy: { start: "asc" },
      include: {
        type: { select: { name: true } },
        owner: { select: { name: true, email: true, team: { select: { name: true } } } },
        assets: { include: { asset: { select: { name: true } } } },
        participants: { include: { user: { select: { name: true } } } },
      },
    });
    const rows = bookings.map((b) => ({
      title: b.title,
      type: b.type?.name ?? "",
      start: b.start,
      end: b.end,
      owner: b.owner.name,
      team: b.owner.team?.name ?? "",
      assets: b.assets.map((ba) => ba.asset.name).join("; "),
      participants: b.participants.map((bp) => bp.user.name).join("; "),
      notes: b.notes ?? "",
    }));
    return csvOrJson(
      format,
      `bookings-${stamp}.csv`,
      objectsToCsv(rows, ["title", "type", "start", "end", "owner", "team", "assets", "participants", "notes"]),
      rows,
    );
  }

  return NextResponse.json({ error: "Unknown export area." }, { status: 400 });
}

function csvOrJson(format: "csv" | "json", filename: string, csv: string, rows: unknown): NextResponse {
  if (format === "json") {
    return new NextResponse(JSON.stringify(rows, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename.replace(/\.csv$/, ".json")}"`,
      },
    });
  }
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
