import { db } from "@/lib/db";
import { isValidTimeZone } from "@/lib/time";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface AppSettings {
  orgName: string;
  timezone: string;
  weekStartsOn: 0 | 1;
  timeFormat: "12h" | "24h";
  appUrl: string;
  defaultTypeId: string | null;
  maxBookingDays: number;
  maxAdvanceDays: number;
  notificationsEnabled: boolean;
  notifyOnAdded: boolean;
  reminderHours: number[];
  smtpFromDb: SmtpConfig | null;
  allowedEmailDomains: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  orgName: "Praper Media",
  timezone: "Asia/Kolkata",
  weekStartsOn: 1,
  timeFormat: "24h",
  appUrl: "",
  defaultTypeId: null,
  maxBookingDays: 60,
  maxAdvanceDays: 365,
  notificationsEnabled: true,
  notifyOnAdded: true,
  reminderHours: [24, 1],
  smtpFromDb: null,
  allowedEmailDomains: [],
};

const KEYS = ["org", "booking", "notifications", "security"] as const;

function parseJson(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(max, Math.max(min, n)));
}

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.setting.findMany({ where: { key: { in: [...KEYS] } } });
  const byKey = new Map(rows.map((row) => [row.key, parseJson(row.value)]));
  const org = byKey.get("org") ?? {};
  const booking = byKey.get("booking") ?? {};
  const notifications = byKey.get("notifications") ?? {};
  const security = byKey.get("security") ?? {};

  const timezone = typeof org.timezone === "string" && isValidTimeZone(org.timezone) ? org.timezone : DEFAULT_SETTINGS.timezone;

  const reminderHours = Array.isArray(notifications.reminderHours)
    ? [...new Set(notifications.reminderHours.map((h) => clampInt(h, 0, 24 * 30, 24)).filter((h) => h > 0))].sort((a, b) => b - a).slice(0, 5)
    : DEFAULT_SETTINGS.reminderHours;

  const smtpFromDb =
    notifications.smtp && typeof notifications.smtp === "object"
      ? normalizeSmtp(notifications.smtp as Record<string, unknown>)
      : null;

  const allowedEmailDomains = Array.isArray(security.allowedEmailDomains)
    ? security.allowedEmailDomains
        .map((d) => String(d).trim().toLowerCase().replace(/^@/, ""))
        .filter((d) => d.length > 0 && d.includes("."))
        .slice(0, 20)
    : [];

  return {
    orgName: typeof org.orgName === "string" && org.orgName.trim() ? org.orgName.trim().slice(0, 80) : DEFAULT_SETTINGS.orgName,
    timezone,
    weekStartsOn: org.weekStartsOn === 0 ? 0 : 1,
    timeFormat: org.timeFormat === "12h" ? "12h" : "24h",
    appUrl: typeof org.appUrl === "string" ? org.appUrl.trim().slice(0, 300) : "",
    defaultTypeId: typeof booking.defaultTypeId === "string" && booking.defaultTypeId ? booking.defaultTypeId : null,
    maxBookingDays: clampInt(booking.maxBookingDays, 1, 3650, DEFAULT_SETTINGS.maxBookingDays),
    maxAdvanceDays: clampInt(booking.maxAdvanceDays, 1, 3650, DEFAULT_SETTINGS.maxAdvanceDays),
    notificationsEnabled: notifications.enabled !== false,
    notifyOnAdded: notifications.notifyOnAdded !== false,
    reminderHours,
    smtpFromDb,
    allowedEmailDomains,
  };
}

function normalizeSmtp(raw: Record<string, unknown>): SmtpConfig | null {
  const host = typeof raw.host === "string" ? raw.host.trim() : "";
  if (!host) return null;
  return {
    host,
    port: clampInt(raw.port, 1, 65535, 465),
    secure: raw.secure !== false,
    user: typeof raw.user === "string" ? raw.user : "",
    pass: typeof raw.pass === "string" ? raw.pass : "",
    from: typeof raw.from === "string" && raw.from.trim() ? raw.from.trim() : "",
  };
}

/** Env SMTP wins over database SMTP so hosts can inject secrets at boot. */
export function resolveSmtp(settings: AppSettings): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  if (host) {
    return {
      host,
      port: Number(process.env.SMTP_PORT ?? 465) || 465,
      secure: process.env.SMTP_SECURE !== "false",
      user: process.env.SMTP_USER ?? "",
      pass: process.env.SMTP_PASS ?? "",
      from: process.env.SMTP_FROM?.trim() || process.env.SMTP_USER || "",
    };
  }
  return settings.smtpFromDb;
}

export interface SettingsPatch {
  orgName?: unknown;
  timezone?: unknown;
  weekStartsOn?: unknown;
  timeFormat?: unknown;
  appUrl?: unknown;
  defaultTypeId?: unknown;
  maxBookingDays?: unknown;
  maxAdvanceDays?: unknown;
  notificationsEnabled?: unknown;
  notifyOnAdded?: unknown;
  reminderHours?: unknown;
  smtp?: unknown;
  smtpRemove?: unknown;
  allowedEmailDomains?: unknown;
}

export async function updateSettings(patch: SettingsPatch): Promise<AppSettings> {
  const current = await getSettings();

  const org: Record<string, unknown> = {
    orgName: typeof patch.orgName === "string" && patch.orgName.trim() ? patch.orgName.trim().slice(0, 80) : current.orgName,
    timezone: typeof patch.timezone === "string" && isValidTimeZone(patch.timezone) ? patch.timezone : current.timezone,
    weekStartsOn: patch.weekStartsOn === 0 || patch.weekStartsOn === 1 ? patch.weekStartsOn : current.weekStartsOn,
    timeFormat: patch.timeFormat === "12h" || patch.timeFormat === "24h" ? patch.timeFormat : current.timeFormat,
    appUrl: typeof patch.appUrl === "string" ? patch.appUrl.trim().slice(0, 300) : current.appUrl,
  };

  const booking: Record<string, unknown> = {
    defaultTypeId: typeof patch.defaultTypeId === "string" ? patch.defaultTypeId || null : current.defaultTypeId,
    maxBookingDays: clampInt(patch.maxBookingDays ?? current.maxBookingDays, 1, 3650, current.maxBookingDays),
    maxAdvanceDays: clampInt(patch.maxAdvanceDays ?? current.maxAdvanceDays, 1, 3650, current.maxAdvanceDays),
  };

  const notifications: Record<string, unknown> = {
    enabled: typeof patch.notificationsEnabled === "boolean" ? patch.notificationsEnabled : current.notificationsEnabled,
    notifyOnAdded: typeof patch.notifyOnAdded === "boolean" ? patch.notifyOnAdded : current.notifyOnAdded,
    reminderHours: Array.isArray(patch.reminderHours) ? patch.reminderHours : current.reminderHours,
  };

  if (patch.smtpRemove === true) {
    notifications.smtp = null;
  } else if (patch.smtp && typeof patch.smtp === "object") {
    const raw = patch.smtp as Record<string, unknown>;
    // An empty pass means "keep the stored one" so the form never echoes secrets.
    const pass = typeof raw.pass === "string" && raw.pass ? raw.pass : current.smtpFromDb?.pass ?? "";
    const merged = normalizeSmtp({ ...raw, pass });
    notifications.smtp = merged;
  } else if (current.smtpFromDb) {
    notifications.smtp = current.smtpFromDb;
  } else {
    notifications.smtp = null;
  }

  const security: Record<string, unknown> = {
    allowedEmailDomains: Array.isArray(patch.allowedEmailDomains) ? patch.allowedEmailDomains : current.allowedEmailDomains,
  };

  await db.setting.upsert({ where: { key: "org" }, update: { value: JSON.stringify(org) }, create: { key: "org", value: JSON.stringify(org) } });
  await db.setting.upsert({ where: { key: "booking" }, update: { value: JSON.stringify(booking) }, create: { key: "booking", value: JSON.stringify(booking) } });
  await db.setting.upsert({ where: { key: "notifications" }, update: { value: JSON.stringify(notifications) }, create: { key: "notifications", value: JSON.stringify(notifications) } });
  await db.setting.upsert({ where: { key: "security" }, update: { value: JSON.stringify(security) }, create: { key: "security", value: JSON.stringify(security) } });

  return getSettings();
}

/** The settings every signed-in person may see — no SMTP secrets here. */
export function publicSettings(settings: AppSettings) {
  return {
    orgName: settings.orgName,
    timezone: settings.timezone,
    weekStartsOn: settings.weekStartsOn,
    timeFormat: settings.timeFormat,
    appUrl: settings.appUrl,
    defaultTypeId: settings.defaultTypeId,
    maxBookingDays: settings.maxBookingDays,
    maxAdvanceDays: settings.maxAdvanceDays,
    notificationsEnabled: settings.notificationsEnabled,
    allowedEmailDomains: settings.allowedEmailDomains,
  };
}

export function emailAllowedByDomain(email: string, settings: AppSettings): boolean {
  if (settings.allowedEmailDomains.length === 0) return true;
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return settings.allowedEmailDomains.includes(domain);
}
