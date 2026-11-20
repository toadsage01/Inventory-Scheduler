"use client";

// The sidebar cards:
//   SidebarMiniMonth — the month block with chevron buttons and the
//     picked day in the studio red, bookings as colour marks under their day.
//   NextUpCard — the "reminder" card on the studio red: the next booking
//     the person is in, with the crew's sticker faces on it.
//   MyBookingsCard — the person's own bookings for today as compact rows.

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, Plus } from "lucide-react";
import type {
  BookingDTO,
  SessionUser,
} from "@/types";
import {
  addDays,
  monthLabel,
  nowStamp,
  prettyRange,
  shortDate,
  todayDatePart,
  weekdayShort,
} from "@/lib/time";
import { bookingColor } from "@/lib/colors";
import { StickerPfp } from "./sticker";
import { api } from "./api";

// -------------------------------------------------------------- mini month

/**
 * The sidebar month: "‹ Month Year ›" with round chevron buttons,
 * red weekday initials, generous day numbers, today in the red circle,
 * and bookings as colour marks under their day.
 */
export function SidebarMiniMonth({
  onPick,
  focusDay,
}: {
  onPick: (day: string) => void;
  focusDay?: string | null;
}) {
  const today = todayDatePart();
  // The month the card is looking at; starts on this month.
  const [cursor, setCursor] = useState(`${today.slice(0, 7)}-01`);
  const [monthBookings, setMonthBookings] = useState<BookingDTO[]>([]);

  const [y, m] = cursor.split("-").map(Number);
  const monthStart = `${cursor.slice(0, 7)}-01`;
  const nextMonthFirst = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;

  useEffect(() => {
    let cancelled = false;
    api<BookingDTO[]>(`/api/bookings?from=${monthStart}T00:00&to=${nextMonthFirst}T00:00`)
      .then((data) => {
        if (!cancelled) setMonthBookings(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [monthStart, nextMonthFirst]);

  function shiftMonth(direction: 1 | -1) {
    const probe = new Date(y, m - 1 + direction, 1);
    setCursor(`${probe.getFullYear()}-${String(probe.getMonth() + 1).padStart(2, "0")}-01`);
  }

  const cells = useMemo(() => {
    // Monday-first grid, six weeks, matching the calendar's default.
    const firstIdx = new Date(Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7)) - 1, 1).getDay();
    const back = (firstIdx - 1 + 7) % 7;
    const gridStart = addDays(monthStart, -back);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [monthStart]);

  // Per-day colour marks: dot = single-day booking, thin line = multi-day.
  const marks = useMemo(() => {
    const map = new Map<string, Array<{ color: string; multi: boolean }>>();
    for (const b of monthBookings) {
      const color = bookingColor(b);
      const startDay = b.start.slice(0, 10);
      const rawEndDay = b.end.slice(0, 10);
      const endDay = b.end.slice(11, 16) === "00:00" ? addDays(rawEndDay, -1) : rawEndDay;
      const multi = endDay !== startDay;
      for (let day = startDay; day <= endDay; day = addDays(day, 1)) {
        const list = map.get(day) ?? [];
        if (list.length < 2) list.push({ color, multi });
        map.set(day, list);
      }
    }
    return map;
  }, [monthBookings]);

  return (
    <section aria-label="Month overview">
      <div className="flex items-center justify-between px-0.5 pb-2">
        <span className="text-[15.5px] font-extrabold tracking-tight">{monthLabel(y, m - 1)}</span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg border bg-card text-primary shadow-sm transition-colors hover:bg-accent"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg border bg-card text-primary shadow-sm transition-colors hover:bg-accent"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </span>
      </div>
      <div className="grid grid-cols-7 px-0.5 pb-1 text-center text-[10px] font-bold uppercase tracking-wide text-primary/85">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day) => {
          const inMonth = day.slice(0, 7) === monthStart.slice(0, 7);
          const isToday = day === today;
          const isSelected = day === focusDay && !isToday;
          const dayMarks = isToday ? [] : marks.get(day) ?? [];
          return (
            <button
              key={day}
              type="button"
              onClick={() => onPick(day)}
              className={`mx-auto flex h-[30px] w-[27px] flex-col items-center justify-center rounded-lg transition-colors ${
                isToday
                  ? "bg-primary font-bold text-primary-foreground"
                  : isSelected
                    ? "bg-accent font-bold text-primary ring-1 ring-primary/40"
                    : inMonth
                      ? "text-foreground hover:bg-secondary"
                      : "text-muted-foreground/40 hover:bg-secondary/50"
              }`}
              aria-label={`Open ${day}`}
              aria-current={isToday ? "date" : undefined}
            >
              <span className="text-[12.5px] tabular-nums leading-none">{Number(day.slice(8, 10))}</span>
              <span className="mt-[3px] flex h-[4px] items-center gap-[2px]">
                {dayMarks.map((mark, i) => (
                  <span
                    key={i}
                    aria-hidden
                    className={mark.multi ? "h-[3px] w-[11px] rounded-full" : "h-[3px] w-[3px] rounded-full"}
                    style={{ background: mark.color }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// --------------------------------------------------------------- next up

/**
 * The reminder card on the studio red: the person's next booking —
 * title, the time, the crew faces — the whole card opens the booking.
 */
export function NextUpCard({
  bookings,
  onOpenEvent,
}: {
  bookings: BookingDTO[];
  onOpenEvent: (booking: BookingDTO) => void;
}) {
  const next = useMemo(() => {
    const now = nowStamp();
    return bookings
      .filter((b) => b.end >= now)
      .sort((a, b) => a.start.localeCompare(b.start))[0] ?? null;
  }, [bookings]);

  if (!next) return null;

  const today = todayDatePart();
  const day = next.start.slice(0, 10);
  const dayLabel = day === today ? "Today" : day === addDays(today, 1) ? "Tomorrow" : `${weekdayShort(day)} ${Number(day.slice(8, 10))}`;
  const multiDay = next.end.slice(0, 10) !== day;
  const color = bookingColor(next);

  return (
    <section
      className="rounded-xl p-3.5 text-white card-shadow"
      style={{ background: "linear-gradient(135deg, var(--primary), var(--deep))" }}
      aria-label="Next booking"
    >
      <div className="flex items-center gap-1.5 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] opacity-90">
        <Clock className="h-3 w-3" aria-hidden /> Next up · {dayLabel}
      </div>
      <button
        type="button"
        onClick={() => onOpenEvent(next)}
        className="block w-full text-left"
        title="Open this booking"
      >
        <span className="block truncate text-[16.5px] font-extrabold leading-snug">{next.title}</span>
        <span className="mt-1 flex items-center gap-1.5 text-[12px] font-medium opacity-95">
          <Clock className="h-3 w-3 shrink-0" aria-hidden />
          {multiDay
            ? `${shortDate(day)} ${next.start.slice(11, 16)} → ${shortDate(next.end.slice(0, 10))} ${next.end.slice(11, 16)}`
            : prettyRange(next.start, next.end)}
        </span>
        <span className="mt-2 flex items-center">
          {next.participants.slice(0, 4).map((p, i) => (
            <span key={p.id} className="ml-[-7px] first:ml-0" style={{ zIndex: 4 - i }}>
              <StickerPfp pfp={p.pfp} name={p.name} size={22} />
            </span>
          ))}
          {next.participants.length > 4 ? (
            <span className="ml-1.5 text-[11.5px] font-semibold opacity-95">+{next.participants.length - 4}</span>
          ) : null}
        </span>
      </button>
      <span aria-hidden className="pointer-events-none absolute" />
      <span
        aria-hidden
        className="mt-2.5 block h-1 w-10 rounded-full"
        style={{ background: color, boxShadow: `0 0 0 3px ${color}33` }}
      />
    </section>
  );
}

// ---------------------------------------------------------- my bookings

/**
 * This person's own bookings for today as compact rows — colour bar on
 * the left, bold title, the time range, the gear count and the crew's
 * faces. The + button opens the booking dialog; a card opens details.
 */
export function MyBookingsCard({
  user,
  bookings,
  onOpenEvent,
  onNewBooking,
}: {
  user: SessionUser;
  bookings: BookingDTO[];
  onOpenEvent: (booking: BookingDTO) => void;
  onNewBooking: () => void;
}) {
  const today = todayDatePart();
  const dayStart = `${today}T00:00`;
  const dayEnd = `${addDays(today, 1)}T00:00`;

  const list = bookings
    .filter((b) => b.start < dayEnd && b.end > dayStart)
    .sort((a, b) => a.start.localeCompare(b.start));

  return (
    <section aria-label="My bookings today">
      <div className="flex items-start justify-between px-0.5 pb-1.5">
        <div className="min-w-0">
          <div className="text-[14.5px] font-extrabold tracking-tight">{weekdayShort(today)}, {shortDate(today)}</div>
          <div className="text-[11.5px] font-medium text-muted-foreground">
            Today · {list.length} {list.length === 1 ? "booking" : "bookings"}
          </div>
        </div>
        <button
          type="button"
          onClick={onNewBooking}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          aria-label="New booking"
          title="New booking"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {list.length === 0 ? (
        <p className="px-0.5 pb-1 pt-1 text-[12px] leading-relaxed text-muted-foreground">
          Nothing on your plate today — the studio is all yours.
        </p>
      ) : (
        <div className="space-y-1">
          {list.map((b) => {
            const color = bookingColor(b);
            const now = nowStamp();
            const live = b.start <= now && b.end > now;
            const gearCount = b.assets.length;
            const mineAsOwner = b.ownerId === user.id;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => onOpenEvent(b)}
                className="card-hover flex w-full items-center gap-2.5 rounded-lg border bg-card px-2 py-2 text-left"
                title={`${b.title} · ${b.ownerName}`}
              >
                <span className="h-[38px] w-[3.5px] shrink-0 rounded-full" style={{ background: color }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold leading-tight text-foreground">
                    {b.title}
                    {live ? <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" aria-label="live now" /> : null}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                    {prettyRange(b.start, b.end)}
                    {gearCount > 0 ? <span className="opacity-80">· {gearCount} gear</span> : null}
                    {mineAsOwner ? null : <span className="truncate opacity-80">· {b.ownerName}</span>}
                  </span>
                </span>
                <span className="flex shrink-0 items-center">
                  {b.participants.slice(0, 3).map((p, i) => (
                    <span key={p.id} className="ml-[-6px] first:ml-0" style={{ zIndex: 3 - i }}>
                      <StickerPfp pfp={p.pfp} name={p.name} size={17} />
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
