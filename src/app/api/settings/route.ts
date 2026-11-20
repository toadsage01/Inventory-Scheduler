import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, requireSession } from "@/lib/guard";
import { getSettings, publicSettings, resolveSmtp, updateSettings, type SettingsPatch } from "@/lib/settings";

export async function GET() {
  const { session, denied } = await requireSession();
  if (denied) return denied;
  const settings = await getSettings();
  const canEdit = session!.user.role === "ADMIN" || session!.user.canManageSettings;

  // Full view (without the SMTP secret) for people who can change settings;
  // the public subset for everyone else.
  if (canEdit) {
    const smtp = resolveSmtp(settings);
    return NextResponse.json({
      ...publicSettings(settings),
      managedBy: "full",
      notifications: {
        enabled: settings.notificationsEnabled,
        notifyOnAdded: settings.notifyOnAdded,
        reminderHours: settings.reminderHours,
        smtpConfigured: smtp !== null,
        smtpFromEnv: Boolean(process.env.SMTP_HOST),
        smtpHost: smtp?.host ?? "",
        smtpPort: smtp?.port ?? 465,
        smtpUser: smtp?.user ?? "",
        smtpFrom: smtp?.from ?? "",
        smtpSecure: smtp?.secure ?? true,
      },
    });
  }
  return NextResponse.json({ ...publicSettings(settings), managedBy: "public" });
}

export async function PUT(request: Request) {
  const { denied } = await requirePermission("canManageSettings");
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as SettingsPatch | null;
  if (!body) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });

  if (typeof body.defaultTypeId === "string" && body.defaultTypeId) {
    const type = await db.bookingType.findUnique({ where: { id: body.defaultTypeId } });
    if (!type) {
      return NextResponse.json({ error: "That default booking type does not exist." }, { status: 400 });
    }
  }

  const settings = await updateSettings(body);
  return NextResponse.json({ ...publicSettings(settings) });
}
