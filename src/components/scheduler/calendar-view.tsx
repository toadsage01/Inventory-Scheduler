"use client";

// The shared calendar: exactly three views in a pill switcher — Day,
// Week, Month. Both Day and Week are rolling windows that lead with
// context: one previous day, then the current day, then the days
// ahead. Every booking renders inside its own day column as a flat,
// single-colour board carrying the team's name — no multi-day
// threads, no gradients. Day headers are clickable in every view. The
// current time draws as a red line that runs BEHIND the boards, and
// the timezone reads IST.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Filter,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import type {
  AssetDTO,
  BookingDTO,
  BookingTypeDTO,
  CalendarViewKind,
  PublicSettings,
  SessionUser,
  TeamDTO,
} from "@/types";
import {
  DAY_END_MIN,
  DAY_START_MIN,
  addDays,
  minutesToStampTime,
  prettyTime,
  shortDate,
  stampFromEpochInZone,
  stampToMinutes,
  todayDatePart,
  weekdayIndex,
  weekdayShort,
} from "@/lib/time";
import { bookingColor, teamColor } from "@/lib/colors";
import { StickerPfp } from "./sticker";

/**
 * Type/team/person/gear filters plus the search focus. They live in the
 * app shell (the team tabs, the sidebar lists, the header search); the
 * calendar just consumes them.
 */
export interface CalendarFilters {
  hiddenTypes: Set<string>;
  hiddenTeams: Set<string>;
  /** Bookings involving these people (owner or participant) are hidden. */
  hiddenPeople: Set<string>;
  hiddenAssets: Set<string>;
  onlyMine: boolean;
  /** Search-jump: show only bookings of this person, or this piece of gear. */
  focus: { kind: "person" | "gear"; id: string; label: string } | null;
}

export const EMPTY_FILTERS: CalendarFilters = {
  hiddenTypes: new Set(),
  hiddenTeams: new Set(),
  hiddenPeople: new Set(),
  hiddenAssets: new Set(),
  onlyMine: false,
  focus: null,
};

interface CalendarViewProps {
  user: SessionUser;
  settings: PublicSettings;
  types: BookingTypeDTO[];
  teams: TeamDTO[];
  assets: AssetDTO[];
  bookings: BookingDTO[];
  loading: boolean;
  focusDay?: { day: string; nonce: number } | null;
  /** Which calendar view is active — lifted up so the sidebar can react. */
  view: CalendarViewKind;
  onViewChange: (view: CalendarViewKind) => void;
  onRangeChange: (from: string, to: string) => void;
  onNewBooking: (prefill?: { start: string; end: string }) => void;
  onOpenEvent: (booking: BookingDTO) => void;
  /** Booking-type / team / person / gear filters — owned by the app shell. */
  filters: CalendarFilters;
  /** Clear the search focus (the chip in the toolbar). */
  onClearFocus?: () => void;
  /** Header-search jump: move the cursor to this day, keep the view. */
  jumpDay?: { day: string; nonce: number } | null;
  /** Slot for the header search box (rendered left of Filter, right of Booking). */
  searchSlot?: React.ReactNode;
  /** Live filter updates from the toolbar's mobile popover. */
  onFiltersChange?: (next: CalendarFilters) => void;
}

/** The day view is a four-day window: yesterday through two days ahead. */
const DAY_WINDOW = 4;
/** The week view is a rolling seven-day window: yesterday plus six ahead. */
const WEEK_WINDOW = 7;

export function CalendarView(props: CalendarViewProps) {
  // The view kind lives in SchedulerApp so the sidebar can react; the
  // filters live in the app shell and this component just consumes them.
  const view = props.view;
  const setView = props.onViewChange;
  const [cursor, setCursor] = useState(todayDatePart());
  // A day picked by clicking a header — highlighted in the week window.
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const filters = props.filters ?? EMPTY_FILTERS;

  const range = useMemo(() => rangeFor(view, cursor, props.settings.weekStartsOn), [view, cursor, props.settings.weekStartsOn]);

  const { onRangeChange } = props;
  useEffect(() => {
    onRangeChange(range.from, range.to);
  }, [onRangeChange, range.from, range.to]);

  // Sidebar mini-month (or any external jump) focuses the day view here.
  const focusNonce = props.focusDay?.nonce ?? 0;
  useEffect(() => {
    if (props.focusDay && focusNonce > 0) {
      // Imperative navigation from outside the calendar (mini month).
      setCursor(props.focusDay.day);
      setView("day");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  // Header-search jump: bring the day into view without forcing a view.
  const jumpNonce = props.jumpDay?.nonce ?? 0;
  useEffect(() => {
    if (props.jumpDay && jumpNonce > 0) {
      setCursor(props.jumpDay.day);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpNonce]);

  const visible = useMemo(() => {
    return props.bookings.filter((booking) => {
      if (filters.onlyMine && booking.ownerId !== props.user.id && !booking.participants.some((p) => p.id === props.user.id)) return false;
      if (booking.typeId && filters.hiddenTypes.has(booking.typeId)) return false;
      if (filters.hiddenTeams.has(booking.teamName ?? "")) return false;
      if (booking.assets.some((a) => filters.hiddenAssets.has(a.id))) return false;
      if (filters.hiddenPeople.size > 0) {
        const involvesHidden =
          filters.hiddenPeople.has(booking.ownerId) || booking.participants.some((p) => filters.hiddenPeople.has(p.id));
        if (involvesHidden) return false;
      }
      if (filters.focus) {
        const focus = filters.focus;
        if (focus.kind === "person") {
          const inBooking = booking.ownerId === focus.id || booking.participants.some((p) => p.id === focus.id);
          if (!inBooking) return false;
        } else if (!booking.assets.some((a) => a.id === focus.id)) {
          return false;
        }
      }
      return true;
    });
  }, [props.bookings, props.user.id, filters]);

  const label = useMemo(() => rangeLabel(view, cursor), [view, cursor]);

  function shift(direction: 1 | -1) {
    setPickedDay(null);
    if (view === "day") setCursor(addDays(cursor, direction));
    else if (view === "week") setCursor(addDays(cursor, WEEK_WINDOW * direction));
    else {
      const [y, m] = cursor.split("-").map(Number);
      const probe = new Date(y, m - 1 + direction, 1);
      setCursor(`${probe.getFullYear()}-${String(probe.getMonth() + 1).padStart(2, "0")}-01`);
    }
  }

  const dayViewDays = useMemo(
    () => Array.from({ length: DAY_WINDOW }, (_, i) => addDays(cursor, i - 1)),
    [cursor],
  );

  // Rolling week: one previous day, the current day, then five ahead —
  // never a wall of past days.
  const weekViewDays = useMemo(
    () => Array.from({ length: WEEK_WINDOW }, (_, i) => addDays(cursor, i - 1)),
    [cursor],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* the toolbar — date navigation, the pill switcher, then Booking
          LEFT of the search box, exactly as asked */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 px-1 pb-3 pt-0.5">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground"
            aria-label="Previous"
            onClick={() => shift(-1)}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground"
            aria-label="Next"
            onClick={() => shift(1)}
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </Button>
          <span className="ml-0.5 truncate text-[20px] font-extrabold tracking-tight sm:text-[22px]">{label}</span>
          {props.loading ? <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden /> : null}
        </div>

        <div className="flex items-center rounded-xl border bg-card p-1 card-shadow" role="tablist" aria-label="Calendar view">
          {(["day", "week", "month"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={view === kind}
              onClick={() => {
                setPickedDay(null);
                setView(kind);
              }}
              className={`rounded-lg px-4 py-1.5 text-[13.5px] capitalize transition-all ${
                view === kind
                  ? "bg-primary font-bold text-primary-foreground shadow-sm"
                  : "font-semibold text-muted-foreground hover:text-foreground"
              }`}
            >
              {kind}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {filters.focus ? (
          <button
            type="button"
            onClick={() => props.onClearFocus?.()}
            className="flex h-9 max-w-44 items-center gap-1 rounded-lg border border-primary/30 bg-accent px-3 text-[12.5px] font-semibold text-accent-foreground transition-colors hover:bg-accent/70"
            title="Clear — show everything again"
            aria-label={`Filtered by ${filters.focus.label}. Clear`}
          >
            <span className="truncate">{filters.focus.label}</span>
            <X className="h-3 w-3" aria-hidden />
          </button>
        ) : null}

        {/* the booking button sits LEFT of the search bar, as asked */}
        <Button
          size="sm"
          className="h-10 rounded-lg bg-primary px-4 text-[13.5px] font-bold shadow-sm hover:bg-primary/90"
          onClick={() => props.onNewBooking()}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          Booking
        </Button>

        {props.searchSlot}

        <MobileFilterPopover types={props.types} teams={props.teams} assets={props.assets} filters={filters} onChange={props.onFiltersChange} />
      </div>

      {view === "month" ? (
        <div className="min-h-0 flex-1 lg:overflow-y-auto scrollbar-thin">
          <MonthGrid
            {...props}
            bookings={visible}
            cursor={cursor}
            filters={filters}
            onDayClick={(day) => {
              setCursor(day);
              setView("day");
            }}
          />
        </div>
      ) : null}
      {view === "week" ? (
        <TimeGrid
          {...props}
          bookings={visible}
          days={weekViewDays}
          activeDay={pickedDay ?? undefined}
          onDayHeaderClick={(day) => {
            setCursor(day);
            setPickedDay(day);
          }}
          onSlotClick={props.onNewBooking}
        />
      ) : null}
      {view === "day" ? (
        <TimeGrid
          {...props}
          bookings={visible}
          days={dayViewDays}
          activeDay={cursor}
          onDayHeaderClick={(day) => {
            setCursor(day);
            setPickedDay(null);
          }}
          onSlotClick={props.onNewBooking}
        />
      ) : null}
    </div>
  );
}

// ---------- range helpers ----------

export function rangeFor(view: CalendarViewKind, cursor: string, weekStartsOn: 0 | 1): { from: string; to: string } {
  if (view === "day") {
    // Cover the whole four-day window (yesterday → two days ahead).
    return { from: `${addDays(cursor, -1)}T00:00`, to: `${addDays(cursor, DAY_WINDOW - 1)}T00:00` };
  }
  if (view === "week") {
    // Rolling week: yesterday through five days ahead.
    return { from: `${addDays(cursor, -1)}T00:00`, to: `${addDays(cursor, WEEK_WINDOW - 1)}T00:00` };
  }
  const monthStart = `${cursor.slice(0, 7)}-01`;
  const [y, m] = monthStart.split("-").map(Number);
  const gridStart = weekStarts(monthStart, weekStartsOn);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const weeks = Math.ceil((last.getDate() + first.getDay()) / 7) + 1;
  return { from: `${gridStart}T00:00`, to: `${addDays(gridStart, weeks * 7)}T00:00` };
}

function weekStarts(day: string, weekStartsOn: 0 | 1): string {
  const idx = weekdayIndex(day);
  const back = (idx - weekStartsOn + 7) % 7;
  return addDays(day, -back);
}

function weekDays(day: string, weekStartsOn: 0 | 1): string[] {
  const start = weekStarts(day, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function rangeLabel(view: CalendarViewKind, cursor: string): string {
  const [y, m, d] = cursor.split("-").map(Number);
  const monthName = new Intl.DateTimeFormat("en-CA", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  if (view === "month") return `${monthName} ${y}`;
  if (view === "day") {
    // Display format: "January, 16 2026"
    return `${monthName}, ${d} ${y}`;
  }
  const start = addDays(cursor, -1);
  const end = addDays(cursor, WEEK_WINDOW - 2);
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  const fmt = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
  const startLabel = fmt.format(new Date(Date.UTC(sy, sm - 1, Number(start.slice(8)))));
  const endLabel = fmt.format(new Date(Date.UTC(ey, em - 1, Number(end.slice(8)))));
  return `${startLabel} – ${endLabel}, ${ey}`;
}

/** "IST" for the studio clock; a readable fallback for any other zone. */
export function timezoneChip(tz: string): string {
  if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") return "IST";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date());
  return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
}

/** Darken/lighten a hex colour so chip text stays readable on the theme. */
function chipText(color: string): string {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const mix = (channel: number, target: number, amount: number) =>
    Math.round(channel * (1 - amount) + target * amount);
  if (luminance < 0.45) {
    // Too dark for dark mode — lift it.
    return `rgb(${mix(r, 255, 0.25)}, ${mix(g, 255, 0.25)}, ${mix(b, 255, 0.25)})`;
  }
  if (luminance > 0.62) {
    // Too light for light mode — sink it.
    return `rgb(${mix(r, 0, 0.42)}, ${mix(g, 0, 0.42)}, ${mix(b, 0, 0.42)})`;
  }
  return color;
}

/**
 * The board surface: ONE flat, light field in the booking's colour —
 * no gradients, no blobs. A hairline border in the same hue keeps it
 * readable on both themes.
 */
function pastelSurface(color: string): React.CSSProperties {
  return {
    background: `${color}26`,
    boxShadow: "0 1px 2px rgba(120, 62, 72, 0.18)",
    border: `1px solid ${color}55`,
  };
}

// ---------- month (the light, scannable overview) ----------

interface DayChip {
  booking: BookingDTO;
  /** The day THIS chip represents — one chip per covered day. */
  day: string;
  continuesLeft: boolean;
  continuesRight: boolean;
  startsHere: boolean;
}

function MonthGrid({
  bookings,
  cursor,
  settings,
  onDayClick,
  onOpenEvent,
}: CalendarViewProps & { bookings: BookingDTO[]; cursor: string; onDayClick: (day: string) => void }) {
  const today = todayDatePart();
  const weekStartsOn = settings.weekStartsOn;
  const days = useMemo(() => {
    const gridStart = weekStarts(`${cursor.slice(0, 7)}-01`, weekStartsOn);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [cursor, weekStartsOn]);

  const weeks = useMemo(() => {
    const out: string[][] = [];
    for (let i = 0; i < 42; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [days]);

  const headerLabels = useMemo(() => {
    const sample = weekDays(today, weekStartsOn);
    return sample.map(weekdayShort);
  }, [today, weekStartsOn]);

  return (
    <div className="overflow-hidden rounded-xl border bg-card card-shadow">
      <div className="grid grid-cols-7 border-b text-center text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
        {headerLabels.map((label) => (
          <div key={label} className="py-2.5">{label}</div>
        ))}
      </div>
      {weeks.map((week, weekIdx) => (
        <MonthWeek
          key={weekIdx}
          days={week}
          bookings={bookings}
          today={today}
          cursorMonth={cursor.slice(0, 7)}
          timeFormat={settings.timeFormat}
          onDayClick={onDayClick}
          onOpenEvent={onOpenEvent}
        />
      ))}
    </div>
  );
}

function MonthWeek({
  days,
  bookings,
  today,
  cursorMonth,
  timeFormat,
  onDayClick,
  onOpenEvent,
}: {
  days: string[];
  bookings: BookingDTO[];
  today: string;
  cursorMonth: string;
  timeFormat: "12h" | "24h";
  onDayClick: (day: string) => void;
  onOpenEvent: (booking: BookingDTO) => void;
}) {
  const weekStart = days[0];
  const weekEndExclusive = addDays(days[6], 1);

  // Every booking lands in EVERY day it covers, as its own flat chip —
  // one continuous-thread look is gone. Multi-day chips carry ‹ / ›
  // continuation marks so a span still reads across days.
  const chipsPerColumn = useMemo(() => {
    const columns: DayChip[][] = Array.from({ length: 7 }, () => []);
    for (const booking of bookings) {
      if (booking.start >= weekEndExclusive || booking.end <= `${weekStart}T00:00`) continue;
      const startDay = booking.start.slice(0, 10);
      const rawEndDay = booking.end.slice(0, 10);
      const endAtMidnight = booking.end.slice(11, 16) === "00:00";
      const lastDay = endAtMidnight && rawEndDay > startDay ? addDays(rawEndDay, -1) : rawEndDay;
      for (let idx = 0; idx < 7; idx++) {
        const day = days[idx];
        if (day < startDay || day > lastDay) continue;
        columns[idx].push({
          booking,
          day,
          continuesLeft: startDay < day,
          continuesRight: lastDay > day,
          startsHere: startDay === day,
        });
      }
    }
    for (const column of columns) column.sort((a, b) => a.booking.start.localeCompare(b.booking.start) || a.day.localeCompare(b.day));
    return columns;
  }, [bookings, weekStart, weekEndExclusive, days]);

  const MAX_SHOWN = 4;

  return (
    <div className="border-b last:border-b-0">
      {/* day numbers — today wears the red square */}
      <div className="grid grid-cols-7">
        {days.map((day, idx) => {
          const inMonth = day.slice(0, 7) === cursorMonth;
          const isToday = day === today;
          const isWeekend = weekdayIndex(day) === 0 || weekdayIndex(day) === 6;
          return (
            <button
              key={day}
              type="button"
              onClick={() => onDayClick(day)}
              aria-label={`Open ${day}`}
              className={`flex h-11 items-center justify-end px-2.5 transition-colors hover:bg-secondary/70 ${
                idx % 7 === 6 ? "" : "border-r"
              } ${inMonth ? (isWeekend ? "bg-secondary/40" : "") : "bg-secondary/30"}`}
            >
              <span
                className={`flex h-8 min-w-8 items-center justify-center px-1.5 text-[17px] tabular-nums ${
                  isToday
                    ? "rounded-lg bg-primary font-bold text-primary-foreground"
                    : inMonth
                      ? "font-bold text-foreground"
                      : "font-bold text-muted-foreground/50"
                }`}
              >
                {Number(day.slice(8, 10))}
              </span>
            </button>
          );
        })}
      </div>
      {/* per-day flat chips */}
      <div className="grid grid-cols-7">
        {days.map((day, idx) => {
          const inMonth = day.slice(0, 7) === cursorMonth;
          const column = chipsPerColumn[idx];
          const overflow = Math.max(0, column.length - MAX_SHOWN);
          const isWeekend = weekdayIndex(day) === 0 || weekdayIndex(day) === 6;
          return (
            <div
              key={day}
              onClick={() => onDayClick(day)}
              role="button"
              aria-label={`Open ${day}`}
              className={`group relative flex min-h-[96px] cursor-pointer flex-col gap-0.5 border-b border-r p-1.5 sm:min-h-[118px] ${
                idx % 7 === 6 ? "border-r-0" : ""
              } ${idx >= 35 ? "border-b-0" : ""} ${
                inMonth ? (isWeekend ? "bg-secondary/40 hover:bg-secondary/70" : "hover:bg-secondary/60") : "bg-secondary/30"
              }`}
            >
              {column.slice(0, MAX_SHOWN).map((chip) => (
                <MonthChip key={`${chip.booking.id}:${chip.day}`} chip={chip} timeFormat={timeFormat} onOpenEvent={onOpenEvent} />
              ))}
              {overflow > 0 ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDayClick(day);
                  }}
                  className="px-1 text-left text-[12px] font-medium text-muted-foreground hover:text-primary"
                >
                  +{overflow} more
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A flat per-day chip: light field, dot, time (or ‹ when it runs in), title, › when it runs on. */
function MonthChip({ chip, timeFormat, onOpenEvent }: { chip: DayChip; timeFormat: "12h" | "24h"; onOpenEvent: (b: BookingDTO) => void }) {
  const b = chip.booking;
  const color = bookingColor(b);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpenEvent(b);
      }}
      className="chip-hover flex w-full items-center gap-1.5 overflow-hidden rounded-lg border px-1.5 py-[2.5px] text-left"
      style={{ background: `${color}26`, borderColor: `${color}55` }}
      title={`${b.title} · ${b.ownerName}`}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      {chip.continuesLeft ? (
        <span className="shrink-0 text-[11px] font-bold leading-none text-foreground/55" aria-hidden>
          ‹
        </span>
      ) : (
        <span className="hidden shrink-0 text-[11.5px] font-semibold tabular-nums text-foreground/75 sm:inline">
          {prettyTime(b.start.slice(11, 16), timeFormat)}
        </span>
      )}
      <span className="truncate text-[12.5px] font-semibold text-foreground/90">{b.title}</span>
      {chip.continuesRight ? (
        <span className="ml-auto shrink-0 text-[11px] font-bold leading-none text-foreground/55" aria-hidden>
          ›
        </span>
      ) : null}
    </button>
  );
}

// ---------- week + the four-day window ----------

// Mobile (< lg) scrolls a fixed-height grid; desktop (lg+) stretches the
// same % positioned grid to fill the viewport, so the whole window and
// its day numbers are visible at once — no scrolling.
const MOBILE_HOUR_PX = 45;

function TimeGrid({
  bookings,
  days,
  activeDay,
  user,
  settings,
  onSlotClick,
  onOpenEvent,
  onDayHeaderClick,
}: Omit<CalendarViewProps, "types" | "teams" | "loading" | "onRangeChange" | "onNewBooking" | "filters" | "focusDay" | "jumpDay" | "onOpenEvent" | "searchSlot" | "onFiltersChange"> & {
  bookings: BookingDTO[];
  days: string[];
  /** The highlighted day inside the window. */
  activeDay?: string;
  onSlotClick: (prefill?: { start: string; end: string }) => void;
  onOpenEvent: (booking: BookingDTO) => void;
  /** Clicking a day header selects that day. */
  onDayHeaderClick?: (day: string) => void;
}) {
  const today = todayDatePart();
  const spanMin = DAY_END_MIN - DAY_START_MIN;
  const hours = Array.from({ length: (DAY_END_MIN - DAY_START_MIN) / 60 + 1 }, (_, i) => DAY_START_MIN + i * 60);
  const scrollRef = useRef<HTMLDivElement>(null);
  const spanKey = `${days[0]}..${days[days.length - 1]}:${bookings.length}`;

  // Wake the grid at a sensible hour: 8 AM, or the first booking if
  // earlier. Desktop has nothing to scroll, so this is a no-op there.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let firstStart = DAY_START_MIN;
    for (const b of bookings) {
      if (b.start.slice(0, 10) >= days[0] && b.start.slice(0, 10) <= days[days.length - 1]) {
        firstStart = Math.min(firstStart, stampToMinutes(b.start));
      }
    }
    const target = Math.max(0, Math.min(firstStart, 8 * 60) - DAY_START_MIN - 30);
    if (el.scrollHeight > el.clientHeight) {
      el.scrollTop = (target / 60) * MOBILE_HOUR_PX;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spanKey]);

  function clickSlot(event: React.MouseEvent<HTMLDivElement>, day: string) {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    const minutes = DAY_START_MIN + ratio * spanMin;
    const snapped = Math.round(minutes / 30) * 30;
    const start = `${day}T${minutesToStampTime(snapped)}`;
    const end = `${day}T${minutesToStampTime(snapped + 60)}`;
    onSlotClick({ start, end });
  }

  // "Now" as the wall clock reads it in the studio's timezone (IST).
  const nowInfo = (() => {
    if (!days.includes(today)) return null;
    const stamp = stampFromEpochInZone(Date.now(), settings.timezone);
    const minutes = stampToMinutes(stamp);
    if (minutes < DAY_START_MIN || minutes > DAY_END_MIN) return null;
    return {
      top: ((minutes - DAY_START_MIN) / spanMin) * 100,
      label: prettyTime(minutesToStampTime(minutes), settings.timeFormat),
    };
  })();

  const gridHeight = (spanMin / 60) * MOBILE_HOUR_PX;
  const tzChip = timezoneChip(settings.timezone);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card card-shadow [--rail-w:56px] sm:[--rail-w:72px]">
      {/* day header — name + date chip row; every day is clickable */}
      <div className="shrink-0 border-b px-2.5 pb-1.5 pt-2">
        <div className="flex">
          <div className="flex w-[var(--rail-w)] shrink-0 items-end justify-start pb-1 pl-0.5">
            <span className="text-[11px] font-bold tracking-wide text-muted-foreground">{tzChip}</span>
          </div>
          {days.map((day) => {
            const isToday = day === today;
            const isFocused = activeDay === day && !isToday;
            const isWeekend = weekdayIndex(day) === 0 || weekdayIndex(day) === 6;
            return (
              <div key={day} className="min-w-0 flex-1 px-1">
                <button
                  type="button"
                  onClick={() => onDayHeaderClick?.(day)}
                  aria-label={`Select ${day}`}
                  aria-current={isToday ? "date" : undefined}
                  className={`w-full rounded-lg px-1 py-2 text-center transition-colors ${
                    isToday
                      ? "bg-accent hover:bg-accent/70"
                      : isFocused
                        ? "bg-secondary ring-1 ring-primary/35 hover:bg-secondary/70"
                        : isWeekend
                          ? "bg-secondary/50 hover:bg-secondary"
                          : "bg-secondary/40 hover:bg-secondary"
                  }`}
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <span className={`truncate text-[14px] font-extrabold ${isToday ? "text-primary" : "text-foreground"}`}>
                      {weekdayShort(day)}
                    </span>
                    {isToday ? (
                      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-primary text-[12px] font-bold leading-none text-primary-foreground">
                        {Number(day.slice(8, 10))}
                      </span>
                    ) : (
                      <span
                        className={`flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-md border bg-card px-1 text-[12px] font-bold leading-none ${
                          isFocused ? "border-primary/40 text-primary" : "text-foreground"
                        }`}
                      >
                        {Number(day.slice(8, 10))}
                      </span>
                    )}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin lg:overflow-hidden">
        <div
          className="flex h-[var(--grid-h)] pt-1.5 lg:h-full"
          style={{ "--grid-h": `${gridHeight}px` } as React.CSSProperties}
        >
          {/* hour ruler — % positioned, so any grid height works */}
          <div className="relative w-[var(--rail-w)] shrink-0">
            {hours.slice(0, -1).map((minute) => (
              <span
                key={minute}
                className="absolute right-1.5 flex -translate-y-1/2 items-baseline whitespace-nowrap"
                style={{ top: `${((minute - DAY_START_MIN) / spanMin) * 100}%` }}
              >
                <span className="text-[12px] font-semibold tabular-nums text-muted-foreground">
                  {prettyTime(minutesToStampTime(minute), settings.timeFormat)}
                </span>
              </span>
            ))}
          </div>
          {/* columns */}
          <div className="relative flex flex-1">
            <div className="relative flex h-full flex-1">
              {/* horizontal hour lines */}
              {hours.slice(0, -1).map((minute) => (
                <div
                  key={minute}
                  className="pointer-events-none absolute left-0 right-0 border-t"
                  style={{ top: `${((minute - DAY_START_MIN) / spanMin) * 100}%`, borderColor: "var(--grid-line)" }}
                  aria-hidden
                />
              ))}
              {nowInfo !== null ? (
                <div
                  className="pointer-events-none absolute left-0 right-0"
                  style={{ top: `${nowInfo.top}%` }}
                  aria-hidden
                >
                  {/* the red current-time line — painted BEFORE the day
                      columns, so it runs BEHIND the booked boards */}
                  <span className="block h-[2px] w-full bg-[var(--teal-brand)]" />
                  <span className="absolute -top-[11px] left-1 flex items-center rounded-md bg-[var(--teal-brand)] px-2 py-[3.5px] text-[11px] font-bold leading-none text-primary-foreground shadow-md">
                    {nowInfo.label}
                  </span>
                </div>
              ) : null}
              {days.map((day) => (
                <DayColumn
                  key={day}
                  day={day}
                  bookings={bookings}
                  user={user}
                  timeFormat={settings.timeFormat}
                  compact={days.length > 4}
                  onSlotClick={(event) => clickSlot(event, day)}
                  onOpenEvent={onOpenEvent}
                  isToday={day === today}
                  isFocused={activeDay === day && day !== today}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  day,
  bookings,
  user,
  timeFormat,
  compact,
  onSlotClick,
  onOpenEvent,
  isToday,
  isFocused,
}: {
  day: string;
  bookings: BookingDTO[];
  user: SessionUser;
  timeFormat: "12h" | "24h";
  /** Week view (7 columns) — tighten the cards. */
  compact: boolean;
  onSlotClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onOpenEvent: (booking: BookingDTO) => void;
  isToday: boolean;
  isFocused: boolean;
}) {
  const dayStart = `${day}T00:00`;
  const dayEnd = `${addDays(day, 1)}T00:00`;
  const spanMin = DAY_END_MIN - DAY_START_MIN;
  const isWeekend = weekdayIndex(day) === 0 || weekdayIndex(day) === 6;

  // EVERY booking that touches this day gets a board here, clamped to
  // the day's visible window — long spans show per-day, never as a
  // thread across columns. A board that runs in from another day (or
  // out to another) says so in one small line.
  const timed = useMemo(() => {
    const slices: DaySlice[] = [];
    for (const b of bookings) {
      if (b.end <= dayStart || b.start >= dayEnd) continue;
      const startDay = b.start.slice(0, 10);
      const rawEndDay = b.end.slice(0, 10);
      const endAtMidnight = b.end.slice(11, 16) === "00:00";
      const lastDay = endAtMidnight && rawEndDay > startDay ? addDays(rawEndDay, -1) : rawEndDay;
      if (day < startDay || day > lastDay) continue;
      const startsHere = startDay === day;
      const endsHere = lastDay === day;
      const startMin = startsHere ? Math.max(DAY_START_MIN, stampToMinutes(b.start)) : DAY_START_MIN;
      let endMin: number;
      if (!endsHere || endAtMidnight) {
        // Runs into tomorrow, or ends exactly at midnight — the whole
        // visible day is held.
        endMin = DAY_END_MIN;
      } else {
        const raw = stampToMinutes(b.end);
        if (raw <= DAY_START_MIN) continue; // ends before the grid wakes
        endMin = Math.min(DAY_END_MIN, raw);
      }
      if (endMin <= startMin) continue;
      slices.push({ booking: b, startMin, endMin, startsHere, endsHere, startDay, lastDay });
    }
    return slices;
  }, [bookings, day, dayStart, dayEnd]);

  const lanes = useMemo(() => layoutLanes(timed), [timed]);

  return (
    <div
      onClick={onSlotClick}
      className={`relative min-w-0 flex-1 cursor-copy border-r last:border-r-0 ${
        isToday ? "bg-accent/45" : isFocused ? "bg-secondary/45" : isWeekend ? "bg-secondary/25" : ""
      }`}
      style={{ height: "100%" }}
      role="presentation"
    >
      {lanes.map((lane, laneIdx) => (
        <div key={laneIdx}>
          {lane.map((entry) => {
            const b = entry.booking;
            const top = ((Math.max(DAY_START_MIN, entry.startMin) - DAY_START_MIN) / spanMin) * 100;
            const height = ((Math.min(DAY_END_MIN, entry.endMin) - Math.max(DAY_START_MIN, entry.startMin)) / spanMin) * 100;
            const color = bookingColor(b);
            const mine = b.ownerId === user.id || b.participants.some((p) => p.id === user.id);
            const faces = b.participants.length > 0 ? b.participants.slice(0, compact ? 3 : 4) : [];
            const team = b.teamName ?? null;
            const runsIn = !entry.startsHere;
            const runsOn = !entry.endsHere;
            return (
              <button
                key={b.id}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenEvent(b);
                }}
                className={`chip-hover absolute flex flex-col overflow-hidden rounded-lg px-2 py-1.5 text-left transition-shadow hover:shadow-lg ${
                  mine ? "ring-[1.5px] ring-primary/55" : ""
                }`}
                style={{
                  top: `${top}%`,
                  height: `${Math.max(height, 4)}%`,
                  left: `${entry.left * 100}%`,
                  width: `${entry.width * 100 - 0.5}%`,
                  ...pastelSurface(color),
                }}
                title={`${b.title} · ${b.ownerName}`}
              >
                {/* team chip first — the boards carry the team's name —
                    then the shoot kind, then the quiet kebab */}
                {height > 5.5 ? (
                  <span className="flex items-center gap-1 overflow-hidden">
                    {team ? (
                      <span
                        className="flex max-w-full shrink items-center gap-1 overflow-hidden rounded-md bg-white/95 px-2 py-[3px] dark:bg-black/35"
                        title={team}
                      >
                        <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: teamColor(team) }} aria-hidden />
                        <span className="truncate text-[10.5px] font-bold leading-none" style={{ color: chipText(teamColor(team)) }}>
                          {team}
                        </span>
                      </span>
                    ) : null}
                    {b.typeName && (!compact || !team) ? (
                      <span
                        className="flex max-w-full shrink items-center gap-1 overflow-hidden rounded-md bg-white/95 px-2 py-[3px] dark:bg-black/35"
                        title={b.typeName}
                      >
                        <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color }} aria-hidden />
                        <span className="truncate text-[10.5px] font-bold leading-none" style={{ color: chipText(color) }}>
                          {b.typeName}
                        </span>
                      </span>
                    ) : null}
                    <Ellipsis className="ml-auto h-3.5 w-3.5 shrink-0 text-foreground/45" aria-hidden />
                  </span>
                ) : null}
                {height > 8 ? (
                  <span className={`mt-1 text-[14px] font-extrabold leading-tight text-foreground ${compact ? "truncate" : height > 16 ? "line-clamp-2" : "truncate"}`}>
                    {b.title}
                  </span>
                ) : null}
                {height > 13 && (runsIn || runsOn) ? (
                  <span className="mt-0.5 truncate text-[10.5px] font-semibold text-foreground/55">
                    {runsIn ? `runs in from ${shortDate(entry.startDay)}` : null}
                    {runsIn && runsOn ? " · " : null}
                    {runsOn ? `on to ${shortDate(entry.lastDay)}` : null}
                  </span>
                ) : null}
                {height > 20 && !compact && b.notes ? (
                  <span className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-foreground/60">{b.notes}</span>
                ) : null}
                {height > 12 ? (
                  <span className="mt-auto flex items-end gap-1.5 pt-1">
                    <span
                      className="flex shrink-0 items-center rounded-md bg-white/95 px-2 py-[3px] text-[10.5px] font-semibold tabular-nums leading-none text-foreground/75 dark:bg-black/35"
                    >
                      {entry.startsHere ? (compact ? b.start.slice(11, 16) : prettyTime(b.start.slice(11, 16), timeFormat)) : "all day"}
                    </span>
                    <span className="ml-auto flex items-center">
                      {faces.map((p, i) => (
                        <span key={p.id} className="ml-[-6px] first:ml-0" style={{ zIndex: 4 - i }}>
                          <StickerPfp pfp={p.pfp} name={p.name} size={compact ? 15 : 19} />
                        </span>
                      ))}
                      {b.participants.length > (compact ? 3 : 4) ? (
                        <span className="ml-1 text-[10px] font-bold text-foreground/60">+{b.participants.length - (compact ? 3 : 4)}</span>
                      ) : null}
                    </span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

interface DaySlice {
  booking: BookingDTO;
  startMin: number;
  endMin: number;
  startsHere: boolean;
  endsHere: boolean;
  startDay: string;
  lastDay: string;
}

function layoutLanes<T extends { startMin: number; endMin: number }>(entries: T[]): Array<Array<T & { left: number; width: number }>> {
  const sorted = [...entries].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const laneEnds: number[] = [];
  const withLanes = sorted.map((entry) => {
    let lane = laneEnds.findIndex((end) => end <= entry.startMin);
    if (lane === -1) {
      laneEnds.push(entry.endMin);
      lane = laneEnds.length - 1;
    } else {
      laneEnds[lane] = entry.endMin;
    }
    return { ...entry, lane };
  });

  // Cluster overlapping chains, split width evenly inside each cluster.
  const result: Array<Array<T & { left: number; width: number }>> = [];
  let cluster: typeof withLanes = [];
  let clusterEnd = -1;
  const flush = () => {
    if (cluster.length === 0) return;
    const columns = Math.max(...cluster.map((e) => e.lane)) + 1;
    const laneGroups: Array<Array<T & { left: number; width: number }>> = Array.from({ length: columns }, () => []);
    for (const entry of cluster) {
      laneGroups[entry.lane].push({
        ...entry,
        left: entry.lane / columns,
        width: 1 / columns,
      });
    }
    for (const group of laneGroups) if (group.length > 0) result.push(group);
    cluster = [];
    clusterEnd = -1;
  };
  for (const entry of withLanes) {
    if (cluster.length > 0 && entry.startMin >= clusterEnd) flush();
    cluster.push(entry);
    clusterEnd = Math.max(clusterEnd, entry.endMin);
  }
  flush();
  return result;
}

/**
 * The mobile filter popover (hidden on desktop, where the sidebar lists
 * do the same job) — shoot kinds, the Praper/Pave/Prave & Pave groups,
 * gear, "only mine".
 */
function MobileFilterPopover({
  types,
  teams,
  assets,
  filters,
  onChange,
}: {
  types: BookingTypeDTO[];
  teams: TeamDTO[];
  assets: AssetDTO[];
  filters: CalendarFilters;
  onChange?: (next: CalendarFilters) => void;
}) {
  const [assetQuery, setAssetQuery] = useState("");
  if (!onChange) return null;
  const filteredAssets = (() => {
    const needle = assetQuery.trim().toLowerCase();
    if (!needle) return assets;
    return assets.filter(
      (a) => a.name.toLowerCase().includes(needle) || a.category.toLowerCase().includes(needle) || (a.tag ?? "").toLowerCase().includes(needle),
    );
  })();
  function toggleHidden(key: "hiddenTypes" | "hiddenTeams" | "hiddenAssets", value: string) {
    const next = new Set(filters[key]);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    if (key === "hiddenTypes") onChange!({ ...filters, hiddenTypes: next });
    else if (key === "hiddenTeams") onChange!({ ...filters, hiddenTeams: next });
    else onChange!({ ...filters, hiddenAssets: next });
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-10 rounded-full px-3.5 text-[13px] lg:hidden">
          <Filter className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Filter
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Shoot kinds</Label>
          {types.map((type) => (
            <label key={type.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={!filters.hiddenTypes.has(type.id)} onCheckedChange={() => toggleHidden("hiddenTypes", type.id)} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: type.color }} aria-hidden />
              {type.name}
            </label>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Teams</Label>
          {teams.map((team) => (
            <label key={team.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={!filters.hiddenTeams.has(team.name)} onCheckedChange={() => toggleHidden("hiddenTeams", team.name)} />
              {team.name}
            </label>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Gear &amp; rooms
            <span className="ml-1.5 normal-case tracking-normal">— hide bookings using them</span>
          </Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <input
              value={assetQuery}
              onChange={(e) => setAssetQuery(e.target.value)}
              placeholder="Find gear…"
              className="h-8 w-full rounded-full border bg-background pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground"
              aria-label="Find gear to filter"
            />
          </div>
          <div className="max-h-44 space-y-0.5 overflow-y-auto scrollbar-thin">
            {filteredAssets.length === 0 ? (
              <p className="px-1 py-2 text-center text-xs text-muted-foreground">No gear matches.</p>
            ) : (
            filteredAssets.map((asset) => (
              <label key={asset.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-secondary">
                <Checkbox checked={!filters.hiddenAssets.has(asset.id)} onCheckedChange={() => toggleHidden("hiddenAssets", asset.id)} />
                <span className="min-w-0 flex-1 truncate">{asset.name}</span>
                {asset.tag ? <span className="text-[10px] text-muted-foreground">{asset.tag}</span> : null}
              </label>
            ))
            )}
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 border-t pt-2 text-sm">
          <Checkbox checked={filters.onlyMine} onCheckedChange={(checked) => onChange({ ...filters, onlyMine: Boolean(checked) })} />
          Only where I am
        </label>
      </PopoverContent>
    </Popover>
  );
}
