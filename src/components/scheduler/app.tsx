"use client";

// The app shell: one big white card floating on the ambient sheet. The
// top bar carries the real Praper logo (icon + wordmark), the word
// Inventory, the panel launchers, a dark-mode toggle, the settings cog
// and Share. The sidebar leads with Upcoming and today's bookings, and
// the month calendar sits at the bottom, just above the person's own
// PFP corner, which opens profile and settings. The booking button sits
// LEFT of the search bar in the calendar toolbar.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import {
  Bell,
  CalendarDays,
  ClipboardList,
  Ellipsis,
  Loader2,
  Moon,
  Package,
  Search,
  Settings,
  Share2,
  Sun,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  AssetDTO,
  BookingDTO,
  BookingTypeDTO,
  CalendarViewKind,
  PublicSettings,
  SessionUser,
  TeamDTO,
  UserDTO,
} from "@/types";
import { todayDatePart } from "@/lib/time";
import { api } from "./api";
import { AuthGate } from "./auth-gate";
import { CalendarView, EMPTY_FILTERS, timezoneChip, type CalendarFilters } from "./calendar-view";
import { BookingDialog } from "./booking-dialog";
import { EventDialog } from "./event-dialog";
import { MyBookings } from "./my-bookings";
import { AssetsPanel } from "./assets-panel";
import { PeoplePanel } from "./people-panel";
import { SettingsPanel } from "./settings-panel";
import { ProfileMenu } from "./profile-menu";
import { ThemeToggle } from "./theme-toggle";
import { StickerPfp } from "./sticker";
import { MyBookingsCard, NextUpCard, SidebarMiniMonth } from "./sidebar-cards";

type TabKind = "calendar" | "mine" | "assets" | "people" | "settings";

export function SchedulerApp() {
  const { data: session, status } = useSession();
  const [needsInit, setNeedsInit] = useState<boolean | null>(null);
  const [tab, setTab] = useState<TabKind>("calendar");

  const [self, setSelf] = useState<SessionUser | null>(null);
  const [assets, setAssets] = useState<AssetDTO[]>([]);
  const [fetchedPeople, setFetchedPeople] = useState<UserDTO[]>([]);
  const [teams, setTeams] = useState<TeamDTO[]>([]);
  const [types, setTypes] = useState<BookingTypeDTO[]>([]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);

  const [range, setRange] = useState({ from: `${todayDatePart()}T00:00`, to: `${todayDatePart()}T23:59` });
  const [rangeBookings, setRangeBookings] = useState<BookingDTO[]>([]);
  const [loadedRange, setLoadedRange] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editBooking, setEditBooking] = useState<BookingDTO | null>(null);
  // Which calendar view is active — lifted here so the sidebar can react.
  // Opens in the person's saved view; defaults to the week.
  const [calendarView, setCalendarView] = useState<CalendarViewKind>("week");
  const [dialogDefaults, setDialogDefaults] = useState({
    start: `${todayDatePart()}T10:00`,
    end: `${todayDatePart()}T11:00`,
  });
  const [openEvent, setOpenEvent] = useState<BookingDTO | null>(null);
  const [focusDay, setFocusDay] = useState<{ day: string; nonce: number } | null>(null);
  // Calendar filters live here so the team tabs and the sidebar own them.
  const [filters, setFilters] = useState<CalendarFilters>(EMPTY_FILTERS);
  // This person's own bookings (owner or participant) — they power the
  // sidebar's Next-up reminder card and the My-bookings list.
  const [mineBookings, setMineBookings] = useState<BookingDTO[]>([]);
  const viewTouched = useRef(false);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    if (status === "unauthenticated") {
      api<{ needsInit: boolean }>("/api/bootstrap")
        .then((data) => setNeedsInit(data.needsInit))
        .catch(() => setNeedsInit(false));
    }
  }, [status]);

  // Core data: self, settings, assets, teams, types.
  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    Promise.all([
      api<SessionUser & { notifyOnAdded: boolean; notifyReminder: boolean; defaultView: CalendarViewKind }>("/api/me"),
      api<PublicSettings>("/api/settings"),
      api<AssetDTO[]>("/api/assets"),
      api<TeamDTO[]>("/api/teams"),
      api<BookingTypeDTO[]>("/api/booking-types"),
    ])
      .then(([me, settingsData, assetsData, teamsData, typesData]) => {
        if (cancelled) return;
        setSelf({ ...me });
        // Open in this person's chosen view until they pick one themselves.
        // The old "year" choice folds into the month now that the switcher
        // is exactly Day / Week / Month.
        if (!viewTouched.current) setCalendarView(me.defaultView === "year" ? "week" : me.defaultView || "week");
        setSettings(settingsData);
        setAssets(assetsData);
        setTeams(teamsData);
        setTypes(typesData);
      })
      .catch(() => {
        if (!cancelled) toastError("Could not load the workspace.");
      });
    return () => {
      cancelled = true;
    };
  }, [status, refreshKey]);

  // People list only for those allowed to see it — but the search needs
  // names for everyone, so non-managers get the light roster instead.
  useEffect(() => {
    if (status !== "authenticated") return;
    const allowed = self && (self.role === "ADMIN" || self.canManagePeople);
    if (!allowed) return; // `people` derives to [] below for non-managers
    let cancelled = false;
    api<UserDTO[]>("/api/users")
      .then((data) => {
        if (!cancelled) setFetchedPeople(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [status, self, refreshKey]);

  // Bookings for the visible calendar range.
  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    const rangeKey = `${range.from}..${range.to}`;
    api<BookingDTO[]>(`/api/bookings?from=${range.from}&to=${range.to}`)
      .then((data) => {
        if (!cancelled) {
          setRangeBookings(data);
          setLoadedRange(rangeKey);
        }
      })
      .catch(() => {
        if (!cancelled) toastError("Could not load bookings.");
      });
    return () => {
      cancelled = true;
    };
  }, [status, range, refreshKey]);

  // The person's own bookings, one fetch, refreshed with everything else.
  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    api<BookingDTO[]>("/api/bookings?mine=1")
      .then((data) => {
        if (!cancelled) setMineBookings(data);
      })
      .catch(() => {
        if (!cancelled) setMineBookings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [status, refreshKey]);

  const people = self && (self.role === "ADMIN" || self.canManagePeople) ? fetchedPeople : [];
  const rangeLoading = loadedRange !== `${range.from}..${range.to}`;
  if (status === "loading" || (status === "unauthenticated" && needsInit === null)) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" aria-hidden />
      </main>
    );
  }

  if (status === "unauthenticated") {
    return <AuthGate needsInit={needsInit ?? false} />;
  }

  const sessionUser: SessionUser = { ...session!.user, role: session!.user.role as SessionUser["role"] };
  const user = self ?? sessionUser;
  const canPeople = user.role === "ADMIN" || Boolean(user.canManagePeople);
  const canSettings = user.role === "ADMIN" || Boolean(user.canManageSettings);
  const activeTab: TabKind = tab === "people" && !canPeople ? "calendar" : tab === "settings" && !canSettings ? "calendar" : tab;
  // Week and the four-day window fill the viewport height exactly — the
  // whole window and its day numbers, visible at once, no scrolling.
  const fitWeekGrid = activeTab === "calendar" && (calendarView === "week" || calendarView === "day");
  const tzChip = settings ? timezoneChip(settings.timezone) : "IST";

  function openNewBooking(prefill?: { start: string; end: string }) {
    setEditBooking(null);
    setDialogDefaults({
      start: prefill?.start ?? `${todayDatePart()}T10:00`,
      end: prefill?.end ?? `${todayDatePart()}T11:00`,
    });
    setDialogOpen(true);
  }

  function openEditBooking(booking: BookingDTO) {
    setEditBooking(booking);
    setDialogOpen(true);
  }

  function focusSearch(kind: "person" | "gear", id: string, label: string) {
    setTab("calendar");
    setFilters((prev) => ({ ...prev, focus: { kind, id, label } }));
  }

  function shareWorkspace() {
    const url = window.location.origin;
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("Workspace link copied — paste it to the team."))
      .catch(() => toast.error(url));
  }

  const searchSlot = (
    <HeaderSearch
      people={people}
      assets={assets}
      onFocusPerson={(p) => focusSearch("person", p.id, p.name)}
      onFocusAsset={(a) => focusSearch("gear", a.id, a.name)}
    />
  );

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden lg:p-5">
      <div className="app-frame flex min-h-0 flex-1 flex-col overflow-hidden border bg-card">
        {/* ── Top bar: logo · team tabs · launcher icons · Share ── */}
        <header className="flex h-[66px] shrink-0 items-center gap-2 border-b bg-[var(--sidebar)] px-3 sm:px-4 lg:h-[72px] lg:gap-3 lg:px-5">
          {/* the real Praper logo — icon and wordmark together — then the app name */}
          <div className="flex min-w-0 items-center gap-2.5 pr-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/praper-logo.png" alt="Praper" className="h-9 w-auto shrink-0" />
            <span className="min-w-0 truncate text-[17px] font-black leading-none tracking-tight">Inventory</span>
          </div>

          <div className="flex-1 lg:hidden" />

          {/* panel launchers, dark-mode toggle, the settings cog, Share */}
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Panels">
            <LauncherButton icon={ClipboardList} label="My bookings" active={activeTab === "mine"} onClick={() => setTab("mine")} />
            <LauncherButton icon={Package} label="Gear & rooms" active={activeTab === "assets"} onClick={() => setTab("assets")} />
            {canPeople ? (
              <LauncherButton icon={Users} label="People" active={activeTab === "people"} onClick={() => setTab("people")} />
            ) : null}
          </nav>
          <ThemeToggle className="hidden lg:inline-flex" />
          <SettingsCog
            user={user}
            canSettings={canSettings}
            onOpenSettings={() => setTab("settings")}
            onUpdated={refresh}
          />
          <Button
            variant="outline"
            size="sm"
            className="hidden h-10 rounded-lg px-3.5 text-[13px] font-semibold sm:flex"
            onClick={shareWorkspace}
            title="Copy the workspace link"
          >
            <Share2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Share
          </Button>
          <span className="lg:hidden">
            <ThemeToggle />
          </span>
          <span className="lg:hidden">
            <ProfileMenu user={user} onUpdated={refresh} canOpenSettings={canSettings} onOpenSettings={() => setTab("settings")} />
          </span>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* ── Sidebar: month · shoot kinds · crew · (bottom) the PFP ── */}
          <aside className="hidden w-[288px] shrink-0 border-r bg-[var(--sidebar)] lg:flex lg:flex-col" aria-label="Sidebar">
            {/* top: the person's Upcoming reminder + today's own bookings */}
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3.5 py-4 scrollbar-thin">
              <NextUpCard bookings={mineBookings} onOpenEvent={setOpenEvent} />
              <MyBookingsCard
                user={user}
                bookings={mineBookings}
                onOpenEvent={setOpenEvent}
                onNewBooking={() => openNewBooking()}
              />
            </div>
            {/* bottom: the month calendar sits under the cards, above the PFP edge */}
            <div className="shrink-0 border-t px-3.5 py-3.5">
              <SidebarMiniMonth
                focusDay={focusDay?.day ?? null}
                onPick={(day) => {
                  setTab("calendar");
                  setFocusDay((prev) => ({ day, nonce: (prev?.nonce ?? 0) + 1 }));
                }}
              />
            </div>
            {/* bottom-left edge: ONLY the person's PFP — profile & settings live inside */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-t px-3.5 py-3">
              <ProfileMenu
                user={user}
                onUpdated={refresh}
                variant="sidebar"
                canOpenSettings={canSettings}
                onOpenSettings={() => setTab("settings")}
              />
              <p className="text-right text-[10px] font-medium leading-tight text-muted-foreground">
                All times {tzChip}.
                <br />
                Booked slots are locked.
              </p>
            </div>
          </aside>

          {/* ── Main panel ── */}
          <main className="min-w-0 flex-1 px-2.5 pb-24 pt-2.5 sm:px-3.5 lg:pb-3 lg:pr-3.5 lg:pt-3">
            {settings === null ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
              </div>
            ) : (
              <div
                className={`min-h-0 ${
                  fitWeekGrid ? "lg:flex lg:h-full lg:min-h-0 lg:flex-col" : "lg:h-full lg:min-h-0 lg:overflow-y-auto scrollbar-thin"
                }`}
              >
                <div className={activeTab === "calendar" ? (fitWeekGrid ? "flex min-h-0 flex-1 flex-col" : "") : "hidden"}>
                  <CalendarView
                    user={user}
                    settings={settings}
                    types={types}
                    teams={teams}
                    assets={assets}
                    bookings={rangeBookings}
                    loading={rangeLoading}
                    focusDay={focusDay}
                    view={calendarView}
                    onViewChange={(next) => {
                      viewTouched.current = true;
                      setCalendarView(next);
                    }}
                    filters={filters}
                    onFiltersChange={setFilters}
                    onClearFocus={() => setFilters((prev) => ({ ...prev, focus: null }))}
                    onRangeChange={(from, to) => setRange((prev) => (prev.from === from && prev.to === to ? prev : { from, to }))}
                    onNewBooking={openNewBooking}
                    onOpenEvent={setOpenEvent}
                    searchSlot={searchSlot}
                  />
                </div>
                <div className={activeTab === "mine" ? "" : "hidden"}>
                  <MyBookings user={user} refreshKey={refreshKey} onChanged={refresh} />
                </div>
                <div className={activeTab === "assets" ? "" : "hidden"}>
                  <AssetsPanel user={user} refreshKey={refreshKey} onChanged={refresh} />
                </div>
                {canPeople ? (
                  <div className={activeTab === "people" ? "" : "hidden"}>
                    <PeoplePanel selfId={user.id ?? ""} refreshKey={refreshKey} onChanged={refresh} />
                  </div>
                ) : null}
                {canSettings ? (
                  <div className={activeTab === "settings" ? "" : "hidden"}>
                    <SettingsPanel
                      settings={settings}
                      admin={user.role === "ADMIN"}
                      onSettingsChanged={(next) => {
                        setSettings(next);
                        refresh();
                      }}
                      onChanged={refresh}
                    />
                  </div>
                ) : null}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Bottom nav (mobile) — fixed, safe-area aware */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-card pb-safe-nav lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-label="Main"
      >
        <MobileNavItem icon={CalendarDays} label="Calendar" active={activeTab === "calendar"} onClick={() => setTab("calendar")} />
        <MobileNavItem icon={ClipboardList} label="Bookings" active={activeTab === "mine"} onClick={() => setTab("mine")} />
        <MobileNavItem icon={Package} label="Gear" active={activeTab === "assets"} onClick={() => setTab("assets")} />
        <MobileMoreMenu canPeople={canPeople} canSettings={canSettings} onOpenTab={setTab} />
      </nav>

      {settings ? (
        <>
          <BookingDialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) setEditBooking(null);
            }}
            assets={assets}
            people={people}
            types={types}
            settings={settings}
            booking={editBooking}
            defaultStart={dialogDefaults.start}
            defaultEnd={dialogDefaults.end}
            rangeBookings={rangeBookings}
            onSaved={refresh}
          />
          <EventDialog
            booking={openEvent}
            user={user}
            onOpenChange={(open) => (open ? null : setOpenEvent(null))}
            onEdit={(booking) => {
              setOpenEvent(null);
              openEditBooking(booking);
            }}
            onChanged={refresh}
          />
        </>
      ) : null}
    </div>
  );
}

/** One launcher icon of the top bar: quiet until active, then red. */
function LauncherButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`flex h-10 w-10 items-center justify-center rounded-[14px] border transition-colors ${
        active
          ? "border-primary/40 bg-accent text-primary"
          : "border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground"
      }`}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden />
    </button>
  );
}

/**
 * The settings cog, top right. The quick settings most people touch —
 * dark mode, the view the calendar opens in, email notifications — plus
 * the full settings panel for those who manage the studio.
 */
function SettingsCog({
  user,
  canSettings,
  onOpenSettings,
  onUpdated,
}: {
  user: SessionUser & { defaultView?: CalendarViewKind; notifyOnAdded?: boolean; notifyReminder?: boolean };
  canSettings: boolean;
  onOpenSettings: () => void;
  onUpdated: () => void;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  async function patch(body: Record<string, unknown>) {
    try {
      await api("/api/me", { method: "PATCH", body: JSON.stringify(body) });
      onUpdated();
    } catch {
      toast.error("Could not save that.");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Settings className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="end"
        className="w-60 border-zinc-800 bg-zinc-900 text-zinc-100 shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
      >
        <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider text-zinc-400">
          Quick settings
        </DropdownMenuLabel>
        <DropdownMenuItem
          className="gap-2 focus:bg-white/10 focus:text-zinc-50"
          onSelect={() => setTheme(dark ? "light" : "dark")}
        >
          {dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
          {dark ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-zinc-800" />
        <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider text-zinc-400">
          Open the calendar in
        </DropdownMenuLabel>
        {(["day", "week", "month"] as CalendarViewKind[]).map((kind) => (
          <DropdownMenuItem
            key={kind}
            className="capitalize focus:bg-white/10 focus:text-zinc-50"
            onSelect={() => void patch({ defaultView: kind })}
          >
            {kind} view
            {(user.defaultView ?? "week") === kind ? (
              <span className="ml-auto text-[11px] font-bold text-primary">current</span>
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator className="bg-zinc-800" />
        <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider text-zinc-400">
          Email me
        </DropdownMenuLabel>
        <DropdownMenuItem
          className="gap-2 focus:bg-white/10 focus:text-zinc-50"
          onSelect={() => void patch({ notifyOnAdded: !(user.notifyOnAdded ?? true) })}
        >
          <Bell className="h-4 w-4" aria-hidden />
          When I&apos;m added to a booking
          <span className="ml-auto text-[11px] font-bold text-zinc-400">
            {(user.notifyOnAdded ?? true) ? "on" : "off"}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2 focus:bg-white/10 focus:text-zinc-50"
          onSelect={() => void patch({ notifyReminder: !(user.notifyReminder ?? true) })}
        >
          <Bell className="h-4 w-4 opacity-0" aria-hidden />
          Reminders before my bookings
          <span className="ml-auto text-[11px] font-bold text-zinc-400">
            {(user.notifyReminder ?? true) ? "on" : "off"}
          </span>
        </DropdownMenuItem>
        {canSettings ? (
          <>
            <DropdownMenuSeparator className="bg-zinc-800" />
            <DropdownMenuItem className="gap-2 focus:bg-white/10 focus:text-zinc-50" onSelect={() => onOpenSettings()}>
              <Settings className="h-4 w-4" aria-hidden />
              All settings
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator className="bg-zinc-800" />
        <DropdownMenuItem
          className="gap-2 focus:bg-white/10 focus:text-zinc-50"
          onSelect={() => signOut({ callbackUrl: window.location.origin })}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileNavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium transition-colors ${
        active ? "text-primary" : "text-muted-foreground"
      }`}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden />
      {label}
    </button>
  );
}

function MobileMoreMenu({
  canPeople,
  canSettings,
  onOpenTab,
}: {
  canPeople: boolean;
  canSettings: boolean;
  onOpenTab: (tab: TabKind) => void;
}) {
  const anyPanel = canPeople || canSettings;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium text-muted-foreground transition-colors"
          aria-label="More"
        >
          <Ellipsis className="h-[18px] w-[18px]" aria-hidden />
          More
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" className="min-w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">More panels</DropdownMenuLabel>
        {anyPanel ? (
          <>
            {canPeople ? (
              <DropdownMenuItem onSelect={() => onOpenTab("people")}>
                <Users className="h-4 w-4" aria-hidden /> People
              </DropdownMenuItem>
            ) : null}
            {canSettings ? (
              <DropdownMenuItem onSelect={() => onOpenTab("settings")}>
                <ClipboardList className="h-4 w-4" aria-hidden /> Settings
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onSelect={() => signOut({ callbackUrl: window.location.origin })}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function toastError(message: string) {
  toast.error(message);
}

/**
 * The header search: people and gear. Picking a person narrows the
 * calendar to their bookings; picking a piece of gear narrows it to that
 * gear's bookings. ⌘K / Ctrl+K jumps to the box.
 */
function HeaderSearch({
  people,
  assets,
  onFocusPerson,
  onFocusAsset,
}: {
  people: UserDTO[];
  assets: AssetDTO[];
  onFocusPerson: (person: UserDTO) => void;
  onFocusAsset: (asset: AssetDTO) => void;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const needle = query.trim().toLowerCase();
  const peopleHits = useMemo(() => {
    if (!needle) return [];
    return people
      .filter((p) => p.name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle))
      .slice(0, 6);
  }, [people, needle]);
  const assetHits = useMemo(() => {
    if (!needle) return [];
    return assets
      .filter((a) => a.name.toLowerCase().includes(needle) || (a.tag ?? "").toLowerCase().includes(needle) || a.category.toLowerCase().includes(needle))
      .slice(0, 6);
  }, [assets, needle]);

  const open = focused && needle.length > 0;
  const nothing = open && peopleHits.length === 0 && assetHits.length === 0;

  return (
    <div
      className="relative hidden w-full max-w-[360px] md:block"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        placeholder="Search employee or gear…"
        aria-label="Search employees and gear"
        className="h-10 w-full rounded-full border bg-card pl-10 pr-14 text-[13.5px] outline-none transition-[box-shadow] placeholder:text-muted-foreground/80 focus:ring-2 focus:ring-primary/35"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border bg-secondary px-1.5 py-0.5 text-[9.5px] font-semibold text-muted-foreground lg:block">
        ⌘K
      </kbd>
      {open || nothing ? (
        <div className="card-shadow scrollbar-thin absolute left-0 top-[calc(100%+8px)] z-50 max-h-96 w-[340px] overflow-y-auto rounded-2xl border bg-popover p-2">
          {nothing ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">No person or gear matches “{query.trim()}”.</p>
          ) : (
            <>
              {peopleHits.length > 0 ? (
                <SearchSection label="People">
                  {peopleHits.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onFocusPerson(p);
                        setQuery("");
                        // keep focused: the cleared query closes the list, and
                        // typing again re-opens it without a re-click.
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-secondary"
                      title={`Show ${p.name}'s bookings on the calendar`}
                    >
                      <StickerPfp pfp={p.pfp} name={p.name} size={24} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{p.name}</span>
                      {p.teamName ? <span className="shrink-0 text-[10.5px] text-muted-foreground">{p.teamName}</span> : null}
                    </button>
                  ))}
                </SearchSection>
              ) : null}
              {assetHits.length > 0 ? (
                <SearchSection label="Gear & rooms">
                  {assetHits.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onFocusAsset(a);
                        setQuery("");
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-secondary"
                      title={`Show bookings using ${a.name}`}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-secondary">
                        <Package className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{a.name}</span>
                      {a.tag ? <span className="shrink-0 text-[10px] text-muted-foreground">{a.tag}</span> : null}
                    </button>
                  ))}
                </SearchSection>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SearchSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-0.5">
      <div className="px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
