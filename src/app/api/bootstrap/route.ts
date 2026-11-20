import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { emailAllowedByDomain, getSettings } from "@/lib/settings";
import { clientIp, rateLimit } from "@/lib/ratelimit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  // The setup screen is about the first ADMIN, not the first user: the boot
  // seed creates crew members before anyone signs in, so counting all users
  // here would hide the screen on a fresh install.
  const admins = await db.user.count({ where: { role: "ADMIN" } });
  return NextResponse.json({ needsInit: admins === 0 });
}

export async function POST(request: Request) {
  const limiter = rateLimit(`bootstrap:${clientIp(request)}`, 10, 10 * 60_000);
  if (!limiter.ok) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${Math.ceil(limiter.retryAfterSec / 60)} minutes.` },
      { status: 429 },
    );
  }
  const admins = await db.user.count({ where: { role: "ADMIN" } });
  if (admins > 0) {
    return NextResponse.json(
      { error: "Setup is already finished. Ask an admin for an account." },
      { status: 403 },
    );
  }
  const body = await request.json().catch(() => null);
  const name = body?.name?.toString().trim();
  const email = body?.email?.toString().trim().toLowerCase();
  const password = body?.password?.toString();
  if (!name || !email || !EMAIL_RE.test(email) || !password || password.length < 8) {
    return NextResponse.json(
      { error: "Name, a valid email, and a password of at least 8 characters are required." },
      { status: 400 },
    );
  }
  const settings = await getSettings();
  if (!emailAllowedByDomain(email, settings)) {
    return NextResponse.json(
      { error: `Only addresses on ${settings.allowedEmailDomains.join(", ")} can be used here.` },
      { status: 400 },
    );
  }
  const admin = await db.user.create({
    data: { name, email, passwordHash: hashPassword(password), role: "ADMIN" },
  });
  return NextResponse.json({ id: admin.id }, { status: 201 });
}
