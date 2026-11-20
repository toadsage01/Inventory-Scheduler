import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/guard";
import { getSettings, resolveSmtp } from "@/lib/settings";
import { sendMail, testEmail } from "@/lib/mail";

/** Sends a test email to the person pressing the button. */
export async function POST() {
  const { session, denied } = await requirePermission("canManageSettings");
  if (denied) return denied;
  const settings = await getSettings();
  const smtp = resolveSmtp(settings);
  if (!smtp || !smtp.host) {
    return NextResponse.json(
      { ok: false, error: "No SMTP account configured yet. Fill the Gmail details below and save first." },
      { status: 400 },
    );
  }
  const to = session!.user.email!;
  const mail = testEmail(settings);
  const result = await sendMail(smtp, to, mail.subject, mail.html);
  await db.notificationLog.create({
    data: {
      kind: "TEST",
      userId: session!.user.id,
      toEmail: to,
      subject: mail.subject,
      ok: result.ok,
      error: result.error ?? null,
    },
  });
  return NextResponse.json({ ok: result.ok, error: result.error ?? null, to });
}
