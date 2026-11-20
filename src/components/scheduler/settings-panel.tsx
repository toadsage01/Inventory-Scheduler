"use client";

// Deep settings: everything the studio can tune — org identity, booking
// rules, booking types, teams, Gmail notifications, security, and the
// data door (import / export / backup).

import { useEffect, useRef, useState } from "react";
import {
  Bell,
  CalendarCheck2,
  CheckCircle2,
  Database,
  Download,
  Loader2,
  Palette,
  Plus,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BookingTypeDTO, PublicSettings, TeamDTO, TrashItemDTO } from "@/types";
import { api } from "./api";
import { offerUndo } from "./undo";

interface SettingsPanelProps {
  settings: PublicSettings;
  onSettingsChanged: (next: PublicSettings) => void;
  onChanged: () => void;
  admin: boolean;
}

const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

const COLOR_SWATCHES = ["#f59e0b", "#a78bfa", "#34d399", "#38bdf8", "#f472b6", "#f87171", "#facc15", "#4ade80"];

export function SettingsPanel({ settings, onSettingsChanged, onChanged, admin }: SettingsPanelProps) {
  const full = settings.managedBy === "full";
  return (
    <Tabs defaultValue="general" className="space-y-4">
      <TabsList className="flex flex-wrap">
        <TabsTrigger value="general"><SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" aria-hidden />General</TabsTrigger>
        <TabsTrigger value="rules"><SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" aria-hidden />Booking rules</TabsTrigger>
        <TabsTrigger value="types"><Palette className="mr-1.5 h-3.5 w-3.5" aria-hidden />Booking types</TabsTrigger>
        <TabsTrigger value="teams">Teams</TabsTrigger>
        <TabsTrigger value="notifications"><Bell className="mr-1.5 h-3.5 w-3.5" aria-hidden />Notifications</TabsTrigger>
        <TabsTrigger value="gcal"><CalendarCheck2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />Google Calendar</TabsTrigger>
        <TabsTrigger value="security"><ShieldCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden />Security</TabsTrigger>
        <TabsTrigger value="data"><Database className="mr-1.5 h-3.5 w-3.5" aria-hidden />Data</TabsTrigger>
        {admin ? <TabsTrigger value="trash"><Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />Trash</TabsTrigger> : null}
      </TabsList>

      <TabsContent value="general"><GeneralTab settings={settings} canEdit={full} onSaved={onSettingsChanged} /></TabsContent>
      <TabsContent value="rules"><RulesTab settings={settings} canEdit={full} onSaved={onSettingsChanged} onChanged={onChanged} /></TabsContent>
      <TabsContent value="types"><TypesTab canEdit={full} onChanged={onChanged} /></TabsContent>
      <TabsContent value="teams"><TeamsTab canEdit={full} onChanged={onChanged} /></TabsContent>
      <TabsContent value="notifications"><NotificationsTab settings={settings} canEdit={full} onSaved={onSettingsChanged} /></TabsContent>
      <TabsContent value="gcal"><GoogleCalendarTab /></TabsContent>
      <TabsContent value="security"><SecurityTab settings={settings} canEdit={full} onSaved={onSettingsChanged} /></TabsContent>
      <TabsContent value="data"><DataTab onChanged={onChanged} /></TabsContent>
      {admin ? <TabsContent value="trash"><TrashTab onChanged={onChanged} /></TabsContent> : null}
    </Tabs>
  );
}

function SaveBar({ busy, onSave, dirty, label = "Save changes" }: { busy: boolean; onSave: () => void; dirty: boolean; label?: string }) {
  return (
    <div className="flex justify-end border-t pt-3">
      <Button onClick={onSave} disabled={busy || !dirty} className="brand-gradient font-semibold text-primary-foreground">
        {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
        {label}
      </Button>
    </div>
  );
}

function GeneralTab({ settings, canEdit, onSaved }: { settings: PublicSettings; canEdit: boolean; onSaved: (next: PublicSettings) => void }) {
  const [orgName, setOrgName] = useState(settings.orgName);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [weekStartsOn, setWeekStartsOn] = useState<"0" | "1">(String(settings.weekStartsOn) as "0" | "1");
  const [timeFormat, setTimeFormat] = useState(settings.timeFormat);
  const [appUrl, setAppUrl] = useState(settings.appUrl);
  const [busy, setBusy] = useState(false);

  const dirty = orgName !== settings.orgName || timezone !== settings.timezone || weekStartsOn !== String(settings.weekStartsOn) || timeFormat !== settings.timeFormat || appUrl !== settings.appUrl;

  async function save() {
    setBusy(true);
    try {
      const next = await api<PublicSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ orgName, timezone, weekStartsOn: Number(weekStartsOn), timeFormat, appUrl }),
      });
      onSaved(next);
      toast.success("General settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Studio identity & time</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="set-org">Studio / org name</Label>
            <Input id="set-org" value={orgName} onChange={(e) => setOrgName(e.target.value)} disabled={!canEdit} maxLength={80} />
            <p className="text-xs text-muted-foreground">Shown on the sidebar and in every email.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="set-tz">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone} disabled={!canEdit}>
              <SelectTrigger id="set-tz"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[...new Set([timezone, ...TIMEZONES])].map((tz) => (
                  <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Booking times are wall-clock in this zone.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Week starts on</Label>
            <Select value={weekStartsOn} onValueChange={(v) => setWeekStartsOn(v as "0" | "1")} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Monday</SelectItem>
                <SelectItem value="0">Sunday</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Clock format</Label>
            <Select value={timeFormat} onValueChange={(v) => setTimeFormat(v as "12h" | "24h")} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">24-hour (14:30)</SelectItem>
                <SelectItem value="12h">12-hour (2:30 pm)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="set-url">App URL (for email links)</Label>
            <Input id="set-url" value={appUrl} onChange={(e) => setAppUrl(e.target.value)} disabled={!canEdit} placeholder="https://schedule.yourstudio.com" />
            <p className="text-xs text-muted-foreground">When set, emails include an “Open the scheduler” button.</p>
          </div>
        </div>
        {canEdit ? <SaveBar busy={busy} dirty={dirty} onSave={() => void save()} /> : <p className="text-xs text-muted-foreground">Only people with settings access can change these.</p>}
      </CardContent>
    </Card>
  );
}

function RulesTab({ settings, canEdit, onSaved, onChanged }: { settings: PublicSettings; canEdit: boolean; onSaved: (next: PublicSettings) => void; onChanged: () => void }) {
  const [maxBookingDays, setMaxBookingDays] = useState(String(settings.maxBookingDays));
  const [maxAdvanceDays, setMaxAdvanceDays] = useState(String(settings.maxAdvanceDays));
  const [defaultTypeId, setDefaultTypeId] = useState(settings.defaultTypeId ?? "none");
  const [types, setTypes] = useState<BookingTypeDTO[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<BookingTypeDTO[]>("/api/booking-types").then(setTypes).catch(() => undefined);
  }, [onChanged]);

  const dirty =
    maxBookingDays !== String(settings.maxBookingDays) ||
    maxAdvanceDays !== String(settings.maxAdvanceDays) ||
    defaultTypeId !== (settings.defaultTypeId ?? "none");

  async function save() {
    setBusy(true);
    try {
      const next = await api<PublicSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ maxBookingDays: Number(maxBookingDays), maxAdvanceDays: Number(maxAdvanceDays), defaultTypeId: defaultTypeId === "none" ? null : defaultTypeId }),
      });
      onSaved(next);
      toast.success("Booking rules saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Booking rules</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="set-span">Longest booking (days)</Label>
            <Input id="set-span" type="number" min={1} max={3650} value={maxBookingDays} onChange={(e) => setMaxBookingDays(e.target.value)} disabled={!canEdit} />
            <p className="text-xs text-muted-foreground">A film shoot week is 7 — set what fits the studio.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="set-advance">Book ahead limit (days)</Label>
            <Input id="set-advance" type="number" min={1} max={3650} value={maxAdvanceDays} onChange={(e) => setMaxAdvanceDays(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label>Default booking type</Label>
            <Select value={defaultTypeId} onValueChange={setDefaultTypeId} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {types.map((type) => (
                  <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="rounded-lg border bg-secondary/40 p-3 text-xs leading-relaxed text-muted-foreground">
          How conflicts work: gear and rooms are <strong className="text-foreground">hard-locked</strong> — if an item is already booked in the window, saving is refused with the holder&apos;s name.
          People overlapping is allowed with a warning (a producer can float between two setups).
        </p>
        {canEdit ? <SaveBar busy={busy} dirty={dirty} onSave={() => void save()} /> : null}
      </CardContent>
    </Card>
  );
}

function TypesTab({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const [types, setTypes] = useState<BookingTypeDTO[] | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLOR_SWATCHES[0]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<BookingTypeDTO[]>("/api/booking-types").then(setTypes).catch(() => setTypes([]));
  }, [onChanged]);

  async function add() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await api("/api/booking-types", { method: "POST", body: JSON.stringify({ name: newName.trim(), color: newColor }) });
      toast.success(`Type “${newName.trim()}” added.`);
      setNewName("");
      const fresh = await api<BookingTypeDTO[]>("/api/booking-types");
      setTypes(fresh);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the type.");
    } finally {
      setBusy(false);
    }
  }

  async function update(type: BookingTypeDTO, patch: Partial<BookingTypeDTO>) {
    try {
      await api(`/api/booking-types/${type.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setTypes((prev) => (prev ?? []).map((t) => (t.id === type.id ? { ...t, ...patch } : t)));
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rename that.");
    }
  }

  async function remove(type: BookingTypeDTO) {
    try {
      await api(`/api/booking-types/${type.id}`, { method: "DELETE" });
      offerUndo("type", type.id, `Type “${type.name}” removed.`, onChanged);
      setTypes((prev) => (prev ?? []).filter((t) => t.id !== type.id));
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove that.");
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Booking types</CardTitle>
        <p className="text-xs text-muted-foreground">Shoots, studio days, edits — each with its own colour on the calendar.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {(types ?? []).map((type) => (
          <div key={type.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5">
            <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: type.color }} aria-hidden />
            <Input
              defaultValue={type.name}
              className="h-8 w-40"
              maxLength={40}
              disabled={!canEdit}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value && value !== type.name) void update(type, { name: value });
              }}
              aria-label={`Name of ${type.name}`}
            />
            <div className="flex gap-1">
              {COLOR_SWATCHES.map((color) => (
                <button
                  key={color}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => void update(type, { color })}
                  className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${type.color === color ? "ring-2 ring-ring ring-offset-2 ring-offset-card" : ""}`}
                  style={{ background: color }}
                  aria-label={`Set ${type.name} colour`}
                />
              ))}
            </div>
            <div className="flex-1" />
            {canEdit ? (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => void remove(type)} aria-label={`Remove ${type.name}`}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            ) : null}
          </div>
        ))}
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2.5">
            <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: newColor }} aria-hidden />
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="h-8 w-40" placeholder="New type name" maxLength={40} />
            <div className="flex gap-1">
              {COLOR_SWATCHES.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setNewColor(color)}
                  className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${newColor === color ? "ring-2 ring-ring ring-offset-2 ring-offset-card" : ""}`}
                  style={{ background: color }}
                  aria-label={`Pick ${color}`}
                />
              ))}
            </div>
            <div className="flex-1" />
            <Button size="sm" onClick={() => void add()} disabled={busy || !newName.trim()}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />}
              Add type
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TeamsTab({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const [teams, setTeams] = useState<TeamDTO[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<TeamDTO[]>("/api/teams").then(setTeams).catch(() => setTeams([]));
  }, [onChanged]);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api("/api/teams", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      setTeams(await api<TeamDTO[]>("/api/teams"));
      setName("");
      onChanged();
      toast.success("Team added.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the team.");
    } finally {
      setBusy(false);
    }
  }

  async function rename(team: TeamDTO, next: string) {
    if (!next.trim() || next === team.name) return;
    try {
      await api(`/api/teams/${team.id}`, { method: "PATCH", body: JSON.stringify({ name: next.trim() }) });
      setTeams((prev) => (prev ?? []).map((t) => (t.id === team.id ? { ...t, name: next.trim() } : t)));
      onChanged();
      toast.success("Team renamed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rename.");
    }
  }

  async function remove(team: TeamDTO) {
    try {
      await api(`/api/teams/${team.id}`, { method: "DELETE" });
      offerUndo("team", team.id, `Team “${team.name}” retired.`, onChanged);
      setTeams((prev) => (prev ?? []).filter((t) => t.id !== team.id));
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the team.");
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Teams</CardTitle>
        <p className="text-xs text-muted-foreground">The crews sharing the gear. Rename them any time — people keep their bookings.</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {(teams ?? []).map((team) => (
          <div key={team.id} className="flex items-center gap-2 rounded-lg border p-2.5">
            <Input
              defaultValue={team.name}
              className="h-8 w-48"
              maxLength={60}
              disabled={!canEdit}
              onBlur={(e) => void rename(team, e.target.value)}
              aria-label={`Name of ${team.name}`}
            />
            <span className="text-xs text-muted-foreground">{team.memberCount} member{team.memberCount === 1 ? "" : "s"}</span>
            {canEdit ? (
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-7 w-7 text-destructive"
                aria-label={`Remove ${team.name}`}
                onClick={() => void remove(team)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            ) : null}
          </div>
        ))}
        {canEdit ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed p-2.5">
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-48" placeholder="New team name" maxLength={60} />
            <Button size="sm" variant="outline" onClick={() => void add()} disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />}
              Add team
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NotificationsTab({ settings, canEdit, onSaved }: { settings: PublicSettings; canEdit: boolean; onSaved: (next: PublicSettings) => void }) {
  const n = settings.notifications;
  const [enabled, setEnabled] = useState(n?.enabled ?? true);
  const [notifyOnAdded, setNotifyOnAdded] = useState(n?.notifyOnAdded ?? true);
  const [reminderHours, setReminderHours] = useState((n?.reminderHours ?? [24, 1]).join(", "));
  const [smtpHost, setSmtpHost] = useState(n?.smtpHost ?? "");
  const [smtpPort, setSmtpPort] = useState(String(n?.smtpPort ?? 465));
  const [smtpUser, setSmtpUser] = useState(n?.smtpUser ?? "");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState(n?.smtpFrom ?? "");
  const [smtpSecure, setSmtpSecure] = useState(n?.smtpSecure ?? true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [outbox, setOutbox] = useState<Array<{ id: string; kind: string; toEmail: string; subject: string; ok: boolean; error: string | null; createdAt: string }>>([]);

  const fromEnv = n?.smtpFromEnv ?? false;

  useEffect(() => {
    api<typeof outbox>("/api/notifications").then(setOutbox).catch(() => undefined);
  }, [canEdit]);

  const dirty =
    enabled !== (n?.enabled ?? true) ||
    notifyOnAdded !== (n?.notifyOnAdded ?? true) ||
    reminderHours !== (n?.reminderHours ?? [24, 1]).join(", ") ||
    (!fromEnv && (smtpHost !== (n?.smtpHost ?? "") || smtpPort !== String(n?.smtpPort ?? 465) || smtpUser !== (n?.smtpUser ?? "") || smtpFrom !== (n?.smtpFrom ?? "") || smtpSecure !== (n?.smtpSecure ?? true) || smtpPass.length > 0));

  async function save() {
    setBusy(true);
    try {
      const hours = reminderHours.split(",").map((s) => Number(s.trim())).filter((h) => Number.isFinite(h) && h > 0 && h <= 720);
      const next = await api<PublicSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          notificationsEnabled: enabled,
          notifyOnAdded,
          reminderHours: hours,
          ...(!fromEnv
            ? {
                smtp: {
                  host: smtpHost.trim(),
                  port: Number(smtpPort) || 465,
                  secure: smtpSecure,
                  user: smtpUser.trim(),
                  pass: smtpPass, // empty = keep the stored password
                  from: smtpFrom.trim() || smtpUser.trim(),
                },
              }
            : {}),
        }),
      });
      onSaved(next);
      setSmtpPass("");
      toast.success("Notification settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const result = await api<{ ok: boolean; error: string | null; to: string }>("/api/settings/test-email", { method: "POST" });
      if (result.ok) toast.success(`Test email sent to ${result.to}. Check the inbox.`);
      else toast.error(result.error ?? "The test email failed.");
      api<typeof outbox>("/api/notifications").then(setOutbox).catch(() => undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The test email failed.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Email notifications</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <span>
              <span className="block font-medium">Notifications on</span>
              <span className="block text-xs text-muted-foreground">Master switch for every outgoing email.</span>
            </span>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} aria-label="Notifications on" />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <span>
              <span className="block font-medium">“You were added” emails</span>
              <span className="block text-xs text-muted-foreground">Sent the moment someone puts a person on a booking.</span>
            </span>
            <Switch checked={notifyOnAdded} onCheckedChange={setNotifyOnAdded} disabled={!canEdit} aria-label="Added emails" />
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="set-reminders">Reminder offsets (hours before start)</Label>
            <Input id="set-reminders" value={reminderHours} onChange={(e) => setReminderHours(e.target.value)} disabled={!canEdit} placeholder="24, 1" />
            <p className="text-xs text-muted-foreground">Comma separated. Each person gets one email per offset, never duplicates.</p>
          </div>
          {canEdit ? <SaveBar busy={busy} dirty={dirty} onSave={() => void save()} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Gmail / SMTP account</CardTitle>
          <p className="text-xs text-muted-foreground">
            Gmail needs a 16-character App Password (Google Account → Security → 2-Step Verification → App passwords).
            {fromEnv ? " SMTP is currently supplied by environment variables on the server, so the fields below are read-only." : ""}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="smtp-host">SMTP host</Label>
              <Input id="smtp-host" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} disabled={!canEdit || fromEnv} placeholder="smtp.gmail.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-port">Port</Label>
              <Input id="smtp-port" type="number" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} disabled={!canEdit || fromEnv} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-user">Account (Gmail address)</Label>
              <Input id="smtp-user" type="email" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} disabled={!canEdit || fromEnv} placeholder="scheduler@yourstudio.com" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-pass">App password</Label>
              <Input id="smtp-pass" type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} disabled={!canEdit || fromEnv} placeholder={n?.smtpConfigured && !fromEnv ? "saved — leave blank to keep" : "xxxxxxxxxxxxxxxx"} autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-from">From name / address override</Label>
              <Input id="smtp-from" value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} disabled={!canEdit || fromEnv} placeholder={`Studio Scheduler <${smtpUser || "scheduler@yourstudio.com"}>`} />
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <span>
                <span className="block font-medium">TLS / SSL</span>
                <span className="block text-xs text-muted-foreground">On for port 465, off for 587 (STARTTLS).</span>
              </span>
              <Switch checked={smtpSecure} onCheckedChange={setSmtpSecure} disabled={!canEdit || fromEnv} aria-label="SMTP TLS" />
            </label>
          </div>
          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">The password is stored in the app database, never in code or git.</p>
            <Button variant="outline" onClick={() => void test()} disabled={testing || !canEdit}>
              {testing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
              Send test email
            </Button>
          </div>
        </CardContent>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Outbox (last 100)</CardTitle></CardHeader>
          <CardContent>
            {outbox.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
            ) : (
              <div className="max-h-72 space-y-1.5 overflow-y-auto scrollbar-thin pr-1">
                {outbox.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-2 rounded-md border p-2 text-xs">
                    {entry.ok ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                    ) : (
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{entry.subject}</div>
                      <div className="truncate text-muted-foreground">
                        {entry.kind} → {entry.toEmail} · {new Date(entry.createdAt).toLocaleString()}
                        {entry.error ? ` · ${entry.error}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function SecurityTab({ settings, canEdit, onSaved }: { settings: PublicSettings; canEdit: boolean; onSaved: (next: PublicSettings) => void }) {
  const [domains, setDomains] = useState(settings.allowedEmailDomains.join(", "));
  const [busy, setBusy] = useState(false);
  const dirty = domains !== settings.allowedEmailDomains.join(", ");

  async function save() {
    setBusy(true);
    try {
      const list = domains.split(",").map((d) => d.trim()).filter(Boolean);
      const next = await api<PublicSettings>("/api/settings", { method: "PUT", body: JSON.stringify({ allowedEmailDomains: list }) });
      onSaved(next);
      toast.success("Security settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Security</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="set-domains">Allowed email domains for new accounts</Label>
          <Input id="set-domains" value={domains} onChange={(e) => setDomains(e.target.value)} disabled={!canEdit} placeholder="yourstudio.com, freelancers.studio" />
          <p className="text-xs text-muted-foreground">
            Empty means any address is fine. Blocks sign-ups (first-run and invites) from personal addresses when set.
          </p>
        </div>
        <div className="rounded-lg border bg-secondary/40 p-3 text-xs leading-relaxed text-muted-foreground">
          <ul className="list-disc space-y-1 pl-4">
            <li>Emails are permanent — accounts can&apos;t be hijacked by changing the sign-in address.</li>
            <li>Passwords are hashed with scrypt; sessions are signed JWTs valid for 30 days.</li>
            <li>Sign-in attempts are rate-limited; role and permission changes apply on the very next request.</li>
            <li>Sessions can be tightened with the NEXTAUTH_SESSION_DAYS env var (1–90 days).</li>
          </ul>
        </div>
        {canEdit ? <SaveBar busy={busy} dirty={dirty} onSave={() => void save()} /> : null}
      </CardContent>
    </Card>
  );
}

function DataTab({ onChanged }: { onChanged: () => void }) {
  const [area, setArea] = useState("bookings");
  const [payload, setPayload] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function importText() {
    setBusy(true);
    try {
      const result = await api<{ created: number; updated: number; errors: string[]; issuedPasswords?: Array<{ email: string; password: string }> }>("/api/import", {
        method: "POST",
        body: JSON.stringify({ area, format: "auto", payload }),
      });
      toast.success(`Imported ${result.created} new, updated ${result.updated}.`);
      if (result.issuedPasswords && result.issuedPasswords.length > 0) {
        toast.info("New passwords to hand out", { description: result.issuedPasswords.map((p) => `${p.email}: ${p.password}`).join("\n"), duration: 30000 });
      }
      if (result.errors.length > 0) toast.warning(`${result.errors.length} rows need attention`, { description: result.errors.slice(0, 3).join(" · ") });
      setPayload("");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPayload(await file.text());
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Export</CardTitle>
          <p className="text-xs text-muted-foreground">CSV opens in any spreadsheet; JSON is a full backup copy.</p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href="/api/export?area=bookings&format=csv" download><Download className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Bookings CSV</a>
          </Button>
          <Button variant="outline" asChild>
            <a href="/api/export?area=assets&format=csv" download><Download className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Gear CSV</a>
          </Button>
          <Button variant="outline" asChild>
            <a href="/api/export?area=people&format=csv" download><Download className="mr-1.5 h-3.5 w-3.5" aria-hidden /> People CSV</a>
          </Button>
          <Button asChild>
            <a href="/api/export?area=all&format=json" download><Download className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Full backup (JSON)</a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Import</CardTitle>
          <p className="text-xs text-muted-foreground">
            Paste CSV (a Google Sheet export works as-is) or JSON. Bookings match gear and people by name; people match by email.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={area} onValueChange={setArea}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bookings">Bookings</SelectItem>
                <SelectItem value="assets">Gear & rooms</SelectItem>
                <SelectItem value="people">People</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => fileInput.current?.click()}>
              <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Choose file
            </Button>
            <input ref={fileInput} type="file" accept=".csv,.json,text/csv,application/json" className="hidden" onChange={onFile} aria-label="Choose import file" />
          </div>
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            className="min-h-40 w-full rounded-md border bg-secondary/30 p-3 font-mono text-xs outline-none placeholder:text-muted-foreground"
            placeholder={"title,type,start,end,owner,assets,participants\nBrand shoot,Shoot,2026-11-09T10:00,2026-11-09T14:00,manas@studio.com,Sony A7 IV body; Studio Room 1 · Praper,ravi@studio.com"}
          />
          <div className="flex justify-end">
            <Button onClick={() => void importText()} disabled={busy || !payload.trim()} className="brand-gradient font-semibold text-primary-foreground">
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              Import
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

type GoogleStatus = {
  enabled: boolean;
  connected: boolean;
  mirrored: number;
};

/** Google Calendar mirroring: status, one-click repair sync, and the
 * explanation of what actually lands in people's Google calendars. */
function GoogleCalendarTab() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    api<GoogleStatus>("/api/calendar/status")
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, connected: false, mirrored: 0 }));
  }, []);

  async function syncNow() {
    setSyncing(true);
    try {
      const result = await api<{ synced: number; failed: number; removed: number }>("/api/calendar/sync", { method: "POST" });
      if (result.failed > 0) {
        toast.warning(`Synced ${result.synced} booking(s); ${result.failed} could not reach Google.`);
      } else {
        toast.success(`Google Calendar is up to date — ${result.synced} upcoming booking(s) mirrored.`);
      }
      api<GoogleStatus>("/api/calendar/status").then(setStatus).catch(() => undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sync right now.");
    } finally {
      setSyncing(false);
    }
  }

  if (status === null) {
    return (
      <Card>
        <CardContent className="flex h-24 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        </CardContent>
      </Card>
    );
  }

  if (!status.enabled) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Google Calendar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Bookings can mirror themselves into every crew member&apos;s own Google Calendar — each person gets a
            dedicated <span className="font-medium text-foreground">“Praper Scheduler”</span> calendar, so their main
            calendar stays untouched.
          </p>
          <p>
            This server is missing the Google OAuth client, so syncing is off. An admin needs to add
            <code className="mx-1 rounded bg-secondary px-1.5 py-0.5 text-[12px] text-foreground">GOOGLE_CLIENT_ID</code>
            and
            <code className="mx-1 rounded bg-secondary px-1.5 py-0.5 text-[12px] text-foreground">GOOGLE_CLIENT_SECRET</code>
            to the deployment (see README → “Google Calendar sync”).
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Your Google Calendar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            {status.connected ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                <span>
                  Connected{status.mirrored > 0 ? ` — ${status.mirrored} booking(s) mirrored` : ""}
                </span>
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span>
                  Not connected yet. Sign out and use <span className="font-medium text-foreground">“Sign in with company Google account”</span> once to switch syncing on.
                </span>
              </>
            )}
          </div>
          <Button onClick={() => void syncNow()} disabled={syncing || !status.connected} className="font-semibold">
            {syncing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
            Sync my upcoming bookings now
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">How it stays tidy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5 text-sm text-muted-foreground">
          <p>· Events go to a separate <span className="font-medium text-foreground">“Praper Scheduler”</span> calendar, never your main one.</p>
          <p>· Create, edit, or cancel here and the same event is updated in place — no duplicates.</p>
          <p>· Cancel a booking here and the mirror disappears there too.</p>
          <p>· Events carry only text: title, time, gear, notes. Portraits and sticker faces stay inside this app.</p>
          <p>· Hide the whole thing in Google Calendar by unticking “Praper Scheduler” in the calendar list.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function TrashTab({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<TrashItemDTO[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<TrashItemDTO[]>("/api/trash")
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [onChanged]);

  async function act(item: TrashItemDTO, action: "restore" | "purge") {
    const key = `${item.kind}:${item.id}`;
    setBusyKey(key);
    try {
      await api("/api/trash", { method: "POST", body: JSON.stringify({ kind: item.kind, id: item.id, action }) });
      toast.success(action === "restore" ? `Restored “${item.label}”.` : `“${item.label}” deleted forever.`);
      setItems((prev) => (prev ?? []).filter((i) => !(i.kind === item.kind && i.id === item.id)));
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusyKey(null);
    }
  }

  const kindLabel: Record<TrashItemDTO["kind"], string> = { booking: "Booking", asset: "Gear", type: "Type", team: "Team" };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Trash</CardTitle>
        <p className="text-xs text-muted-foreground">
          Everything anyone deleted — bookings, gear, types, teams. Restore it like it never happened, or clear it out forever.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {items === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
            <Undo2 className="h-8 w-8" aria-hidden />
            <p>The trash is empty. Deleted things wait here until you decide.</p>
          </div>
        ) : (
          items.map((item) => {
            const key = `${item.kind}:${item.id}`;
            return (
              <div key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border p-2.5">
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {kindLabel[item.kind]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{item.label}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {item.detail}
                    {item.deletedByName ? <> · deleted by {item.deletedByName}</> : null}
                    {item.deletedAt ? <> · {new Date(item.deletedAt).toLocaleString()}</> : null}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button variant="outline" size="sm" disabled={busyKey === key} onClick={() => void act(item, "restore")}>
                    <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Restore
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={busyKey === key}
                    onClick={() => void act(item, "purge")}
                  >
                    Delete forever
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
