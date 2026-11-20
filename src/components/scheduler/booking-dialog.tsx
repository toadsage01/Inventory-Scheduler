"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Lock, CalendarPlus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  AssetDTO,
  BookingDTO,
  BookingTypeDTO,
  CheckResult,
  ConflictInfo,
  PublicSettings,
  UserDTO,
} from "@/types";
import { addDays, prettyDuration, prettyStampRange, todayDatePart } from "@/lib/time";
import { BOOKING_COLORS } from "@/lib/colors";
import { StickerPfp } from "./sticker";
import { api, ApiError } from "./api";

interface BookingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assets: AssetDTO[];
  people: UserDTO[];
  types: BookingTypeDTO[];
  settings: PublicSettings;
  booking?: BookingDTO | null; // present → edit mode
  defaultStart: string;
  defaultEnd: string;
  /** Bookings in the visible calendar range — powers the taken-colour dots. */
  rangeBookings: BookingDTO[];
  onSaved: () => void;
}

export function BookingDialog(props: BookingDialogProps) {
  // Keep the form mounted through the close animation (260ms > the 200ms
  // exit) so the dialog never flashes as an empty white box.
  const [holdForm, setHoldForm] = useState(props.open);
  useEffect(() => {
    if (props.open) {
      setHoldForm(true);
      return;
    }
    const timer = setTimeout(() => setHoldForm(false), 260);
    return () => clearTimeout(timer);
  }, [props.open]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92vh] gap-3 overflow-y-auto scrollbar-thin sm:max-w-lg">
        {holdForm ? (
          <BookingForm {...props} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function timeOptions(): string[] {
  const out: string[] = [];
  for (let minute = 0; minute <= 23 * 60 + 30; minute += 30) {
    out.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
  }
  return out;
}

// Mounted fresh every time the dialog opens, so state always starts from
// the caller's defaults — no reset effects needed.
function BookingForm({
  assets,
  people,
  types,
  settings,
  booking,
  defaultStart,
  defaultEnd,
  rangeBookings,
  onOpenChange,
  onSaved,
}: BookingDialogProps) {
  const editing = Boolean(booking);
  const times = useMemo(() => timeOptions(), []);
  const activeAssets = assets.filter((asset) => asset.active);

  const [title, setTitle] = useState(booking?.title ?? "");
  const [typeId, setTypeId] = useState<string>(booking?.typeId ?? settings.defaultTypeId ?? "none");
  const [startDate, setStartDate] = useState(booking?.start.slice(0, 10) ?? defaultStart.slice(0, 10));
  const [startTime, setStartTime] = useState(booking?.start.slice(11, 16) ?? defaultStart.slice(11, 16));
  const [endDate, setEndDate] = useState(booking?.end.slice(0, 10) ?? defaultEnd.slice(0, 10));
  const [endTime, setEndTime] = useState(booking?.end.slice(11, 16) ?? defaultEnd.slice(11, 16));
  const [assetIds, setAssetIds] = useState<Set<string>>(new Set(booking?.assets.map((a) => a.id) ?? []));
  const [participantIds, setParticipantIds] = useState<Set<string>>(new Set(booking?.participants.map((p) => p.id) ?? []));
  const [notes, setNotes] = useState(booking?.notes ?? "");
  // "" = Auto: the booking wears its type's colour. Otherwise a #rrggbb
  // swatch from the palette below.
  const [color, setColor] = useState<string>(booking?.color ?? "");
  const [assetSearch, setAssetSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [pendingCheck, setPendingCheck] = useState<CheckResult | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const startStamp = `${startDate}T${startTime}`;
  const endStamp = `${endDate}T${endTime}`;
  const duration = startStamp < endStamp ? prettyDuration(startStamp, endStamp) : null;
  const multiDay = startDate !== endDate;

  // Colours already worn by overlapping bookings — shown as taken so two
  // neighbours never share a hue. Only explicit colours count; Auto books
  // keep following their type colour.
  const takenColors = useMemo(() => {
    const taken = new Map<string, string>();
    for (const other of rangeBookings) {
      if (!other.color || other.id === booking?.id) continue;
      if (other.start < endStamp && other.end > startStamp) {
        taken.set(other.color.toLowerCase(), other.title);
      }
    }
    return taken;
  }, [rangeBookings, booking?.id, startStamp, endStamp]);

  function toggleAsset(id: string) {
    setConflict(null);
    setAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleParticipant(id: string) {
    setParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setErrorText(null);
    setConflict(null);
    if (!title.trim()) {
      setErrorText("Give the booking a title first.");
      return;
    }
    if (startStamp >= endStamp) {
      setErrorText("The end must be after the start.");
      return;
    }
    setBusy(true);
    try {
      const check = await api<CheckResult>("/api/bookings/check", {
        method: "POST",
        body: JSON.stringify({
          start: startStamp,
          end: endStamp,
          assetIds: [...assetIds],
          participantIds: [...participantIds],
          excludeId: booking?.id,
        }),
      });
      if (check.assetConflicts.length > 0) {
        // The server will hard-block anyway; surface it now in one step.
        const c = check.assetConflicts[0];
        setConflict({
          assetName: c.assetName,
          userName: c.userName,
          teamName: c.teamName,
          title: c.title,
          start: c.start,
          end: c.end,
        });
        setBusy(false);
        return;
      }
      if (check.participantConflicts.length > 0) {
        setPendingCheck(check);
        setBusy(false);
        return;
      }
      await save();
    } catch (err) {
      handleError(err);
      setBusy(false);
    }
  }

  async function save() {
    setPendingCheck(null);
    setBusy(true);
    try {
      const payload = {
        title: title.trim(),
        typeId: typeId === "none" ? null : typeId,
        start: startStamp,
        end: endStamp,
        notes: notes.trim() || null,
        color: color || null,
        assetIds: [...assetIds],
        participantIds: [...participantIds],
      };
      if (editing && booking) {
        await api(`/api/bookings/${booking.id}`, { method: "PATCH", body: JSON.stringify(payload) });
        toast.success("Booking updated.");
      } else {
        await api("/api/bookings", { method: "POST", body: JSON.stringify(payload) });
        toast.success(`Booked: ${title.trim()} · ${prettyStampRange(startStamp, endStamp)}`);
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      handleError(err);
      setBusy(false);
    }
  }

  function handleError(err: unknown) {
    if (err instanceof ApiError && err.data.conflict) {
      setConflict(err.data.conflict as ConflictInfo);
    } else {
      setErrorText(err instanceof Error ? err.message : "Could not save the booking.");
    }
  }

  const groupedAssets = useMemo(() => {
    const needle = assetSearch.trim().toLowerCase();
    const filtered = activeAssets.filter(
      (asset) =>
        !needle ||
        asset.name.toLowerCase().includes(needle) ||
        asset.category.toLowerCase().includes(needle) ||
        (asset.tag ?? "").toLowerCase().includes(needle),
    );
    const groups = new Map<string, AssetDTO[]>();
    for (const asset of filtered) {
      const list = groups.get(asset.category) ?? [];
      list.push(asset);
      groups.set(asset.category, list);
    }
    return [...groups.entries()];
  }, [activeAssets, assetSearch]);

  const invitedPeople = people.filter((p) => participantIds.has(p.id));

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2.5 text-[17px]">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
            style={{ background: "linear-gradient(135deg, var(--primary), var(--deep))" }}
            aria-hidden
          >
            <CalendarPlus className="h-4.5 w-4.5" />
          </span>
          {editing ? "Edit booking" : "Create Schedule"}
        </DialogTitle>
        <DialogDescription className="pl-[46px]">
          {editing
            ? "Change anything — taken gear is re-checked on save."
            : "Fill in the data below to add a schedule."}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="booking-title">Title</Label>
          <Input
            id="booking-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Brand shoot — studio day 1"
            maxLength={120}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  <span className="text-muted-foreground">No type</span>
                </SelectItem>
                {types.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: type.color }} />
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Duration</Label>
            <div className="flex h-9 items-center rounded-md border bg-secondary/50 px-3 text-sm text-muted-foreground">
              {duration ? (multiDay ? `${duration} · multi-day` : duration) : "end before start"}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>
            Colour
            <span className="ml-1.5 font-normal text-muted-foreground">— faded swatches are already taken nearby</span>
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setColor("")}
              title="Auto — wear the booking type's colour"
              aria-label="Auto colour"
              aria-pressed={color === ""}
              className={`flex h-7 w-7 items-center justify-center rounded-full brand-gradient text-[10px] font-bold text-white transition-transform ${
                color === "" ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "opacity-70 hover:opacity-100"
              }`}
            >
              A
            </button>
            {BOOKING_COLORS.map((swatch) => {
              const takenBy = takenColors.get(swatch);
              const isTaken = Boolean(takenBy) && color !== swatch;
              return (
                <button
                  key={swatch}
                  type="button"
                  disabled={isTaken}
                  onClick={() => setColor(swatch)}
                  title={takenBy ? `${swatch} — taken by “${takenBy}”` : swatch}
                  aria-label={isTaken ? `Colour ${swatch} taken` : `Colour ${swatch}`}
                  aria-pressed={color === swatch}
                  className={`h-7 w-7 rounded-full transition-transform ${
                    isTaken ? "cursor-not-allowed opacity-25" : "hover:scale-110"
                  } ${color === swatch ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
                  style={{ background: swatch }}
                />
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="booking-start-date">From</Label>
            <div className="flex gap-2">
              <Input
                id="booking-start-date"
                type="date"
                value={startDate}
                min={addDays(todayDatePart(), -370)}
                max={addDays(todayDatePart(), settings.maxAdvanceDays)}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (endDate < e.target.value) setEndDate(e.target.value);
                }}
                className="w-full"
                required
              />
              <Select value={startTime} onValueChange={setStartTime}>
                <SelectTrigger className="w-[92px] shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">{times.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="booking-end-date">Until</Label>
            <div className="flex gap-2">
              <Input
                id="booking-end-date"
                type="date"
                value={endDate}
                min={startDate}
                max={addDays(startDate, settings.maxBookingDays - 1)}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full"
                required
              />
              <Select value={endTime} onValueChange={setEndTime}>
                <SelectTrigger className="w-[92px] shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">{times.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>
            Gear & rooms
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {assetIds.size === 0 ? "none — ok for meetings" : `${assetIds.size} selected`}
            </span>
          </Label>
          <div className="rounded-md border">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <input
                value={assetSearch}
                onChange={(e) => setAssetSearch(e.target.value)}
                placeholder="Search gear, rooms, tags…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                aria-label="Search gear"
              />
            </div>
            <div className="max-h-44 overflow-y-auto scrollbar-thin p-1">
              {groupedAssets.length === 0 ? (
                <p className="px-2 py-4 text-center text-sm text-muted-foreground">Nothing matches that search.</p>
              ) : (
                groupedAssets.map(([category, list]) => (
                  <div key={category}>
                    <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{category}</div>
                    {list.map((asset) => (
                      <label key={asset.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
                        <Checkbox checked={assetIds.has(asset.id)} onCheckedChange={() => toggleAsset(asset.id)} />
                        <span className="min-w-0 flex-1 truncate">{asset.name}</span>
                        {asset.tag ? <span className="text-[10px] text-muted-foreground">{asset.tag}</span> : null}
                      </label>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>
            <Users className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            Who&apos;s on it
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              they&apos;ll get an email when added
            </span>
          </Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="h-auto w-full flex-wrap justify-start gap-1 py-1.5 text-left font-normal">
                {invitedPeople.length === 0 ? (
                  <span className="text-muted-foreground">Invite teammates…</span>
                ) : (
                  invitedPeople.map((person) => (
                    <span key={person.id} className="flex items-center gap-1 rounded-full border bg-secondary/60 py-0.5 pl-0.5 pr-2 text-xs">
                      <StickerPfp pfp={person.pfp} name={person.name} size={18} />
                      {person.name}
                    </span>
                  ))
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-1">
              <div className="max-h-64 overflow-y-auto scrollbar-thin">
                {people.map((person) => (
                  <label key={person.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
                    <Checkbox checked={participantIds.has(person.id)} onCheckedChange={() => toggleParticipant(person.id)} />
                    <StickerPfp pfp={person.pfp} name={person.name} size={22} />
                    <span className="min-w-0 flex-1 truncate">{person.name}</span>
                    {person.teamName ? <span className="text-[10px] text-muted-foreground">{person.teamName}</span> : null}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-2">
          <Label htmlFor="booking-notes">Notes (optional)</Label>
          <Input
            id="booking-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Client, call sheet, anything the crew needs"
            maxLength={500}
          />
        </div>

        {conflict ? (
          <Alert variant="destructive">
            <Lock className="h-4 w-4" aria-hidden />
            <AlertTitle>That window is taken</AlertTitle>
            <AlertDescription>
              “{conflict.assetName}” is held by {conflict.userName}
              {conflict.teamName ? ` (${conflict.teamName})` : ""} for “{conflict.title}”{" "}
              {prettyStampRange(conflict.start, conflict.end)}. Overwrites are blocked — coordinate or pick another slot.
            </AlertDescription>
          </Alert>
        ) : null}
        {pendingCheck ? (
          <Alert>
            <AlertTitle>Some people are already booked then</AlertTitle>
            <AlertDescription className="space-y-1">
              {pendingCheck.participantConflicts.map((p) => (
                <div key={p.userId}>
                  <strong>{p.name}</strong> — {p.bookings.map((b) => `“${b.title}” ${prettyStampRange(b.start, b.end)}`).join(", ")}
                </div>
              ))}
              <p className="pt-1">Overlap for people is allowed (they can float between setups). Add them anyway?</p>
            </AlertDescription>
            <div className="mt-3 flex gap-2">
              <Button type="button" size="sm" onClick={() => void save()} disabled={busy}>
                Add anyway
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setPendingCheck(null)}>
                Go back
              </Button>
            </div>
          </Alert>
        ) : null}
        {errorText ? (
          <Alert variant="destructive">
            <AlertDescription>{errorText}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
            {editing ? "Save changes" : "Book it"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
