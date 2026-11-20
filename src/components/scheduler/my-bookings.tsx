"use client";

// My bookings as a Notion-style timeline: a single quiet spine on the left,
// date markers beside it, and one roomy card per booking. No more small
// rectangular rows — the schedule reads like a story.

import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, Inbox, Package, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { BookingDTO, SessionUser } from "@/types";
import { prettyStampRange, prettyDuration, shortDate, weekdayShort } from "@/lib/time";
import { bookingColor } from "@/lib/colors";
import { StickerPfp } from "./sticker";
import { api } from "./api";
import { offerUndo } from "./undo";

interface MyBookingsProps {
  user: SessionUser;
  refreshKey: number;
  onChanged: () => void;
}

interface DayGroup {
  day: string; // YYYY-MM-DD
  bookings: BookingDTO[];
}

export function MyBookings({ user, refreshKey, onChanged }: MyBookingsProps) {
  const [bookings, setBookings] = useState<BookingDTO[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<BookingDTO[]>("/api/bookings?mine=1")
      .then((data) => {
        if (!cancelled) setBookings(data);
      })
      .catch(() => {
        if (!cancelled) setBookings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  async function cancel(booking: BookingDTO) {
    setBusyId(booking.id);
    try {
      await api(`/api/bookings/${booking.id}`, { method: "DELETE" });
      offerUndo("booking", booking.id, `Cancelled “${booking.title}”.`, onChanged);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel that booking.");
    } finally {
      setBusyId(null);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (bookings ?? []).filter((b) => b.end.slice(0, 10) >= today);
  const past = (bookings ?? []).filter((b) => b.end.slice(0, 10) < today).reverse();

  return (
    <div className="space-y-8">
      <section aria-label="Upcoming bookings">
        <div className="mb-4 flex items-baseline gap-2">
          <h2 className="text-[17px] font-semibold tracking-tight">Upcoming</h2>
          {bookings !== null ? <span className="text-[13px] text-muted-foreground">{upcoming.length}</span> : null}
        </div>
        {bookings === null ? (
          <TimelineSkeleton />
        ) : upcoming.length === 0 ? (
          <EmptyLine text="Nothing coming up. The calendar is your move." />
        ) : (
          <Timeline
            bookings={upcoming}
            today={today}
            userId={user.id ?? ""}
            canCancel={(booking) =>
              booking.ownerId === user.id || user.role === "ADMIN" || Boolean(user.canManageBookings)
            }
            busyId={busyId}
            onCancel={(booking) => void cancel(booking)}
          />
        )}
      </section>

      {past.length > 0 ? (
        <section aria-label="Past bookings">
          <div className="mb-4 flex items-baseline gap-2">
            <h2 className="text-[17px] font-semibold tracking-tight text-muted-foreground">Past</h2>
            <span className="text-[13px] text-muted-foreground">{past.length}</span>
          </div>
          <Timeline bookings={past.slice(0, 20)} today={today} userId={user.id ?? ""} canCancel={() => false} busyId={busyId} muted />
        </section>
      ) : null}
    </div>
  );
}

/** Group bookings by their starting day, in order. */
function groupByDay(bookings: BookingDTO[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const booking of bookings) {
    const day = booking.start.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.bookings.push(booking);
    else groups.push({ day, bookings: [booking] });
  }
  return groups;
}

function Timeline({
  bookings,
  today,
  userId,
  canCancel,
  busyId,
  onCancel,
  muted = false,
}: {
  bookings: BookingDTO[];
  today: string;
  userId: string;
  canCancel: (booking: BookingDTO) => boolean;
  busyId: string | null;
  onCancel?: (booking: BookingDTO) => void;
  muted?: boolean;
}) {
  const groups = useMemo(() => groupByDay(bookings), [bookings]);

  return (
    <div className="relative">
      {/* the spine — sits on the centre of the dot column (64px mobile, 80px sm+) */}
      <span className="absolute top-3 bottom-3 left-16 w-px bg-border sm:left-20" aria-hidden />
      <div className="space-y-1">
        {groups.map((group, groupIdx) => {
          const isToday = group.day === today;
          return (
            <div key={group.day} className="relative flex gap-3 sm:gap-4">
              {/* date rail */}
              <div className="w-11 shrink-0 pt-3 text-right sm:w-[56px]">
                <div className={`text-[10.5px] font-semibold uppercase tracking-wide ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                  {weekdayShort(group.day)}
                </div>
                <div className={`text-[19px] font-semibold leading-tight tabular-nums ${isToday ? "text-primary" : muted ? "text-muted-foreground" : "text-foreground"}`}>
                  {Number(group.day.slice(8, 10))}
                </div>
                <div className="text-[10.5px] leading-tight text-muted-foreground">
                  {shortDate(group.day).split(" ")[0]}
                </div>
              </div>
              {/* spine dot */}
              <div className="relative w-4 shrink-0">
                <span
                  className={`absolute left-1/2 top-[21px] h-[9px] w-[9px] -translate-x-1/2 rounded-full border-2 bg-background ${
                    isToday ? "border-primary" : muted ? "border-muted-foreground/50" : "border-foreground/35"
                  }`}
                  aria-hidden
                />
              </div>
              {/* cards */}
              <div className="min-w-0 flex-1 space-y-2.5 py-1.5">
                {isToday ? (
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Today</div>
                ) : groupIdx === 0 ? null : null}
                {group.bookings.map((booking) => (
                  <TimelineCard
                    key={booking.id}
                    booking={booking}
                    userId={userId}
                    canCancel={canCancel(booking)}
                    busy={busyId === booking.id}
                    onCancel={onCancel}
                    muted={muted}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineCard({
  booking,
  userId,
  canCancel,
  busy,
  onCancel,
  muted = false,
}: {
  booking: BookingDTO;
  userId: string;
  canCancel: boolean;
  busy: boolean;
  onCancel?: (booking: BookingDTO) => void;
  muted?: boolean;
}) {
  const color = bookingColor(booking);
  const isOwner = booking.ownerId === userId;
  const multiDay = booking.start.slice(0, 10) !== booking.end.slice(0, 10);

  return (
    <div
      className={`group rounded-lg border bg-card p-3 transition-shadow sm:p-3.5 ${muted ? "opacity-65" : "hover:shadow-[0_1px_4px_rgba(0,0,0,0.06)]"}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {booking.typeName ? (
              <span
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-[3px] text-[11px] font-semibold"
                style={{ background: `${color}1c`, color }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />
                {booking.typeName}
              </span>
            ) : null}
            <span className="text-[12px] font-medium tabular-nums text-muted-foreground">
              {prettyStampRange(booking.start, booking.end)}
            </span>
            {multiDay ? <span className="text-[11px] text-muted-foreground">· {prettyDuration(booking.start, booking.end)}</span> : null}
            {isOwner ? <span className="text-[11px] text-muted-foreground">· yours</span> : null}
          </div>
          <h3 className={`mt-1 truncate text-[15px] font-semibold leading-snug ${muted ? "text-muted-foreground" : ""}`}>
            {booking.title}
          </h3>
          {booking.assets.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {booking.assets.map((asset) => (
                <span
                  key={asset.id}
                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-secondary px-2 py-[3px] text-[11px] font-medium text-secondary-foreground"
                >
                  <Package className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{asset.name}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="flex -space-x-2">
            <StickerPfp pfp={booking.ownerPfp} name={booking.ownerName} size={24} />
            {booking.participants.slice(0, 3).map((p) => (
              <StickerPfp key={p.id} pfp={p.pfp} name={p.name} size={24} />
            ))}
            {booking.participants.length > 3 ? (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[9px] font-semibold text-muted-foreground ring-2 ring-white dark:ring-[#202020]">
                +{booking.participants.length - 3}
              </span>
            ) : null}
          </span>
          {canCancel ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
              aria-label={`Cancel ${booking.title}`}
              onClick={() => onCancel?.(booking)}
              disabled={busy}
            >
              {busy ? <CalendarPlus className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-2.5">
      <Skeleton className="h-[74px] w-full rounded-lg" />
      <Skeleton className="h-[74px] w-full rounded-lg" />
      <Skeleton className="h-[74px] w-[92%] rounded-lg" />
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
      <Inbox className="h-6 w-6" aria-hidden />
      <p>{text}</p>
      <p className="flex items-center gap-1 text-xs">
        <CalendarPlus className="h-3 w-3" aria-hidden /> Make one from the Calendar tab.
      </p>
    </div>
  );
}
