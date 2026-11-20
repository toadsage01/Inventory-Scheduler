"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Loader2, NotebookPen, Package, Pencil, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { BookingDTO, SessionUser } from "@/types";
import { hrsRange, prettyDateLong } from "@/lib/time";
import { bookingColor } from "@/lib/colors";
import { StickerPfp } from "./sticker";
import { api } from "./api";
import { offerUndo } from "./undo";

interface EventDialogProps {
  booking: BookingDTO | null;
  user: SessionUser;
  onOpenChange: (open: boolean) => void;
  onEdit: (booking: BookingDTO) => void;
  onChanged: () => void;
}

export function EventDialog({ booking, user, onOpenChange, onEdit, onChanged }: EventDialogProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Hold the last booking through the close animation so the dialog never
  // flashes as an empty white box while it fades out.
  const [lastBooking, setLastBooking] = useState<BookingDTO | null>(null);
  useEffect(() => {
    if (booking) setLastBooking(booking);
  }, [booking]);
  const shown = booking ?? lastBooking;
  if (!shown) return null;

  const isOwner = shown.ownerId === user.id;
  const canEdit = isOwner || user.role === "ADMIN" || user.canManageBookings;
  const color = bookingColor(shown);

  async function cancelBooking() {
    if (!booking) return;
    setBusy(true);
    try {
      await api(`/api/bookings/${booking.id}`, { method: "DELETE" });
      offerUndo("booking", booking.id, "Booking cancelled — everyone involved gets an email. Restore it with Undo.", onChanged);
      setConfirming(false);
      onOpenChange(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel the booking.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={Boolean(booking)} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: color }} aria-hidden />
              <DialogTitle className="text-left">{shown.title}</DialogTitle>
            </div>
            <DialogDescription className="text-left">
              {shown.typeName ? `${shown.typeName} · ` : ""}
              {hrsRange(shown.start, shown.end)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            {/* The day itself, front and centre — the thing people came for. */}
            <div className="flex items-start gap-2.5 rounded-lg border bg-secondary/50 px-2.5 py-2">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold leading-tight">{prettyDateLong(shown.start.slice(0, 10))}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{hrsRange(shown.start, shown.end)}</div>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <StickerPfp pfp={shown.ownerPfp} name={shown.ownerName} size={30} variable />
              <div>
                <div className="font-medium leading-tight">{shown.ownerName}</div>
                <div className="text-xs text-muted-foreground">
                  holds the booking{shown.teamName ? ` · ${shown.teamName}` : ""}
                </div>
              </div>
            </div>

            {shown.assets.length > 0 ? (
              <div>
                <div className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Package className="h-3 w-3" aria-hidden /> Gear &amp; rooms
                  <span className="ml-auto font-normal normal-case tracking-normal">{shown.assets.length} reserved</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {shown.assets.map((asset) => (
                    <span key={asset.id} className="rounded-md border bg-secondary/60 px-2 py-0.5 text-xs">
                      {asset.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {shown.participants.length > 0 ? (
              <div>
                <div className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <UserRound className="h-3 w-3" aria-hidden /> Crew
                  <span className="ml-auto font-normal normal-case tracking-normal">{shown.participants.length} on it</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {shown.participants.map((person) => (
                    <span key={person.id} className="flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs">
                      <StickerPfp pfp={person.pfp} name={person.name} size={20} />
                      {person.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {shown.notes ? (
              <div>
                <div className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <NotebookPen className="h-3 w-3" aria-hidden /> Notes
                </div>
                <p className="whitespace-pre-wrap rounded-md border bg-secondary/40 p-2 text-xs leading-relaxed">{shown.notes}</p>
              </div>
            ) : null}
          </div>

          {canEdit ? (
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { onOpenChange(false); onEdit(shown); }}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Edit
              </Button>
              <Button variant="destructive" onClick={() => setConfirming(true)}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Cancel booking
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel “{shown.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The gear frees up for everyone, and {shown.ownerName === user.name ? "the crew" : `${shown.ownerName} and the crew`} gets an email.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void cancelBooking();
              }}
            >
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              Cancel booking
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
