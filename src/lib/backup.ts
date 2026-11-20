import { db } from "@/lib/db";

/**
 * One builder, two consumers: the "Full backup (JSON)" download in
 * Settings → Data, and the daily backup email attached by the reminder
 * scan. The payload deliberately includes password hashes and SMTP details
 * — a backup that cannot restore sign-ins is only half a backup — so the
 * file must be treated like a secret. It never leaves the app except to
 * people who manage settings, and to the admins' own inbox.
 */
export async function buildBackupPayload() {
  const [users, teams, assets, types, bookings, settings] = await Promise.all([
    db.user.findMany(),
    db.team.findMany(),
    db.asset.findMany(),
    db.bookingType.findMany(),
    db.booking.findMany({
      include: {
        assets: true,
        participants: true,
        owner: { select: { email: true } },
        type: { select: { name: true } },
      },
    }),
    db.setting.findMany(),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    kind: "gear-inventory-scheduler-backup",
    version: 2,
    users: users.map(({ passwordHash, ...rest }) => ({ ...rest, passwordHash })),
    teams,
    assets,
    bookingTypes: types,
    bookings: bookings.map((b) => ({
      title: b.title,
      type: b.type?.name ?? null,
      start: b.start,
      end: b.end,
      notes: b.notes,
      ownerEmail: b.owner.email,
      assetIds: b.assets.map((ba) => ba.assetId),
      participantIds: b.participants.map((bp) => bp.userId),
      createdAt: b.createdAt,
    })),
    settings,
  };
}
