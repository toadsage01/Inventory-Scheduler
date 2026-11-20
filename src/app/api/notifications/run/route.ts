import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { runReminderScan, emailDailyBackup } from "@/lib/notify";
import { clientIp, rateLimit } from "@/lib/ratelimit";

/**
 * Trigger for the reminder scan. On hosts with a persistent process
 * (Docker, a VPS) the built-in worker already does this every minute;
 * this endpoint exists for serverless hosts — Vercel's cron hits it with
 * GET and a `Authorization: Bearer <CRON_SECRET>` header, and any other
 * scheduler can POST with `x-cron-secret: <secret>`. Without a shared
 * secret it falls back to a signed-in admin, rate-limited.
 */
function hasCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true; // Vercel cron style
  return request.headers.get("x-cron-secret") === secret;
}

async function runScan() {
  const result = await runReminderScan();
  // Same run doubles as the daily backup courier: one JSON snapshot per day,
  // mailed to the admins, deduped and retried inside emailDailyBackup.
  const backup = await emailDailyBackup();
  return NextResponse.json({ ok: true, ...result, backup });
}

export async function GET(request: Request) {
  if (hasCronSecret(request)) return runScan();

  const limiter = rateLimit(`notify-run:${clientIp(request)}`, 4, 60_000);
  if (!limiter.ok) {
    return NextResponse.json({ error: "Too many runs. Wait a minute." }, { status: 429 });
  }
  const { denied } = await requirePermission("canManageSettings");
  if (denied) return denied;
  return runScan();
}

export async function POST(request: Request) {
  if (hasCronSecret(request)) return runScan();

  const limiter = rateLimit(`notify-run:${clientIp(request)}`, 4, 60_000);
  if (!limiter.ok) {
    return NextResponse.json({ error: "Too many runs. Wait a minute." }, { status: 429 });
  }
  const { denied } = await requirePermission("canManageSettings");
  if (denied) return denied;
  return runScan();
}
