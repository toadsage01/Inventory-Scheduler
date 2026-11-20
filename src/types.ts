export type Role = "ADMIN" | "LEAD" | "MEMBER";

export interface SessionUser {
  id?: string;
  name?: string | null;
  email?: string | null;
  role?: Role;
  teamId?: string | null;
  teamName?: string | null;
  pfp?: string | null;
  canManageAssets?: boolean;
  canManageBookings?: boolean;
  canManagePeople?: boolean;
  canManageSettings?: boolean;
  googleConnected?: boolean;
  notifyOnAdded?: boolean;
  notifyReminder?: boolean;
  /** Which view this person's calendar opens in. */
  defaultView?: CalendarViewKind;
}

export interface TeamDTO {
  id: string;
  name: string;
  memberCount: number;
}

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  role: Role;
  teamId: string | null;
  teamName: string | null;
  pfp: string | null;
  canManageAssets: boolean;
  canManageBookings: boolean;
  canManagePeople: boolean;
  canManageSettings: boolean;
  notifyOnAdded: boolean;
  notifyReminder: boolean;
}

export interface AssetDTO {
  id: string;
  name: string;
  category: string;
  tag: string | null;
  notes: string | null;
  active: boolean;
}

export interface BookingTypeDTO {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface ParticipantDTO {
  id: string;
  name: string;
  pfp: string | null;
  teamName: string | null;
}

export interface BookingDTO {
  id: string;
  title: string;
  typeId: string | null;
  typeName: string | null;
  typeColor: string | null;
  color: string | null;
  start: string;
  end: string;
  notes: string | null;
  ownerId: string;
  ownerName: string;
  ownerPfp: string | null;
  teamName: string | null;
  assets: Array<{ id: string; name: string; category: string }>;
  participants: ParticipantDTO[];
}

export interface ConflictInfo {
  assetName: string;
  userName: string;
  teamName: string | null;
  title: string;
  start: string;
  end: string;
}

export interface ParticipantOverlap {
  userId: string;
  name: string;
  bookings: Array<{ id: string; title: string; start: string; end: string }>;
}

export interface CheckResult {
  assetConflicts: Array<{
    assetId: string;
    assetName: string;
    bookingId: string;
    title: string;
    userName: string;
    teamName: string | null;
    start: string;
    end: string;
  }>;
  participantConflicts: ParticipantOverlap[];
}

export interface PublicSettings {
  orgName: string;
  timezone: string;
  weekStartsOn: 0 | 1;
  timeFormat: "12h" | "24h";
  appUrl: string;
  defaultTypeId: string | null;
  maxBookingDays: number;
  maxAdvanceDays: number;
  notificationsEnabled: boolean;
  allowedEmailDomains: string[];
  managedBy?: "public" | "full";
  notifications?: {
    enabled: boolean;
    notifyOnAdded: boolean;
    reminderHours: number[];
    smtpConfigured: boolean;
    smtpFromEnv: boolean;
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpFrom: string;
    smtpSecure: boolean;
  };
}

export interface NotificationLogDTO {
  id: string;
  kind: string;
  bookingId: string | null;
  userId: string | null;
  toEmail: string;
  subject: string;
  ok: boolean;
  error: string | null;
  createdAt: string;
}

export type CalendarViewKind = "year" | "month" | "week" | "day";

export type TrashKind = "booking" | "asset" | "type" | "team";

export interface TrashItemDTO {
  kind: TrashKind;
  id: string;
  label: string;
  detail: string;
  deletedAt: string | null;
  deletedByName: string | null;
}
