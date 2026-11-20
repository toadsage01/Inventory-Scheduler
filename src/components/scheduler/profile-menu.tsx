"use client";

import { useRef, useState } from "react";
import { Bell, Camera, Cat, KeyRound, Loader2, LogOut, Lock, Moon, Pencil, Settings2, Sun } from "lucide-react";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CalendarViewKind, SessionUser } from "@/types";
import { StickerPfp } from "./sticker";
import { api } from "./api";

const CAT_STICKER = "/cat-sticker.png";

interface ProfileMenuProps {
  user: SessionUser;
  onUpdated: () => void;
  /** "header" = compact pill (mobile); "sidebar" = PFP-only, bottom-left edge. */
  variant?: "header" | "sidebar";
  /** Admins get a Settings jump straight from the PFP menu. */
  canOpenSettings?: boolean;
  onOpenSettings?: () => void;
}

export function ProfileMenu({ user, onUpdated, variant = "header", canOpenSettings = false, onOpenSettings }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(user.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const { resolvedTheme, setTheme } = useTheme();

  const sidebar = variant === "sidebar";
  const roleLabel = user.role === "ADMIN" ? "Admin" : user.role === "LEAD" ? "Team lead" : user.teamName ?? "Member";

  async function patch(body: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    try {
      await api("/api/me", { method: "PATCH", body: JSON.stringify(body) });
      toast.success(successMessage);
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Pick an image file.");
      return;
    }
    try {
      const dataUrl = await downscaleSource(URL.createObjectURL(file), 256);
      await patch({ pfp: dataUrl }, "Portrait updated — looking sharp.");
    } catch {
      toast.error("Could not read that image.");
    }
  }

  async function applyCat() {
    try {
      const dataUrl = await downscaleSource(CAT_STICKER, 256);
      await patch({ pfp: dataUrl }, "The studio cat is now you.");
    } catch {
      toast.error("Could not load the cat.");
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {sidebar ? (
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-full transition-transform hover:scale-105"
              aria-label="Open profile and settings menu"
              title="Profile & settings"
            >
              <StickerPfp pfp={user.pfp} name={user.name} size={34} />
            </button>
          ) : (
            <button
              type="button"
              className="flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-2.5 card-shadow transition-colors hover:bg-accent"
              aria-label="Open profile menu"
            >
              <StickerPfp pfp={user.pfp} name={user.name} size={28} />
              <span className="hidden min-w-0 text-left sm:block">
                <span className="block max-w-32 truncate text-[12.5px] font-semibold leading-tight">{user.name}</span>
                <span className="block text-[10px] leading-tight text-muted-foreground">{roleLabel}</span>
              </span>
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent side={sidebar ? "top" : "bottom"} align={sidebar ? "start" : "end"} className="w-60">
          <DropdownMenuLabel className="flex items-center gap-2">
            <StickerPfp pfp={user.pfp} name={user.name} size={30} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">{user.email}</span>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            <Pencil className="h-4 w-4" aria-hidden /> Edit profile
          </DropdownMenuItem>
          {canOpenSettings && onOpenSettings ? (
            <DropdownMenuItem onSelect={() => onOpenSettings()}>
              <Settings2 className="h-4 w-4" aria-hidden /> Settings
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
            <Camera className="h-4 w-4" aria-hidden /> Change portrait
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void applyCat()}>
            <Cat className="h-4 w-4" aria-hidden /> Use the studio cat
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
            {resolvedTheme === "dark" ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
            {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => signOut({ callbackUrl: window.location.origin })}>
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onFile} aria-label="Upload portrait" />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Your profile</DialogTitle>
            <DialogDescription>
              Your email is permanent — it&apos;s how people find and invite you.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <StickerPfp pfp={user.pfp} name={user.name} size={56} />
              <div className="space-y-1">
                <Button type="button" size="sm" variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}>
                  <Camera className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Upload photo
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => void applyCat()} disabled={busy}>
                  <Cat className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Use the studio cat
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-name">Name</Label>
              <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-email">Email</Label>
              <div className="flex items-center gap-2">
                <Input id="profile-email" value={user.email ?? ""} disabled />
                <span className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
                  <Lock className="h-3 w-3" aria-hidden /> locked
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-default-view">Open the calendar in</Label>
              <Select
                value={user.defaultView === "year" ? "week" : user.defaultView ?? "week"}
                onValueChange={(next) => void patch({ defaultView: next }, `The calendar now opens in ${next} view.`)}
              >
                <SelectTrigger id="profile-default-view">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["week", "day", "month"] as CalendarViewKind[]).map((kind) => (
                    <SelectItem key={kind} value={kind} className="capitalize">
                      {kind} view
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Your own choice — it follows you, not the whole studio.</p>
            </div>

            <div className="rounded-lg border p-3">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                <Bell className="h-4 w-4 text-primary" aria-hidden /> Email notifications
              </div>
              <div className="space-y-2.5">
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>When someone adds me to a booking</span>
                  <Switch
                    checked={user.notifyOnAdded ?? true}
                    onCheckedChange={(checked) => void patch({ notifyOnAdded: checked }, checked ? "Added-me emails on." : "Added-me emails off.")}
                    disabled={busy}
                    aria-label="Email me when added to a booking"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>Reminders before my bookings</span>
                  <Switch
                    checked={user.notifyReminder ?? true}
                    onCheckedChange={(checked) => void patch({ notifyReminder: checked }, checked ? "Reminder emails on." : "Reminder emails off.")}
                    disabled={busy}
                    aria-label="Email me reminders"
                  />
                </label>
              </div>
            </div>

            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                <KeyRound className="mr-1 inline h-3.5 w-3.5" aria-hidden /> Change password
              </summary>
              <div className="mt-3 space-y-2">
                <Input
                  type="password"
                  placeholder="Current password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
                <Input
                  type="password"
                  placeholder="New password (8+ characters)"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !currentPassword || newPassword.length < 8}
                  onClick={() =>
                    void patch({ currentPassword, newPassword }, "Password changed.").then(() => {
                      setCurrentPassword("");
                      setNewPassword("");
                    })
                  }
                >
                  {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                  Update password
                </Button>
              </div>
            </details>
          </div>
          <DialogFooter>
            <Button
              onClick={() =>
                void patch({ name }, "Profile saved.").then(() => setOpen(false))
              }
              disabled={busy || !name.trim() || name === user.name}
            >
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              Save profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Draw any image source (file URL, path, data URL) into a square canvas. */
function downscaleSource(src: string, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("no canvas"));
        return;
      }
      // Cover-crop to a square centred on the image.
      const side = Math.min(img.width, img.height);
      ctx.drawImage(
        img,
        (img.width - side) / 2,
        (img.height - side) / 2,
        side,
        side,
        0,
        0,
        size,
        size,
      );
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("bad image"));
    img.src = src;
  });
}
