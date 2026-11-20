"use client";

// People: who exists, which team, and what they're authorized to do.
// Team leads and admins hand out specific powers per person here.

import { useEffect, useRef, useState } from "react";
import { Download, KeyRound, Loader2, ShieldCheck, Trash2, Upload, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { teamColor } from "./team-colors";
import { StickerPfp } from "./sticker";
import { api } from "./api";
import type { Role, TeamDTO, UserDTO } from "@/types";

interface PeoplePanelProps {
  selfId: string;
  refreshKey: number;
  onChanged: () => void;
}

export function PeoplePanel({ selfId, refreshKey, onChanged }: PeoplePanelProps) {
  const [people, setPeople] = useState<UserDTO[] | null>(null);
  const [teams, setTeams] = useState<TeamDTO[]>([]);
  const [inviting, setInviting] = useState(false);
  const [permissionsFor, setPermissionsFor] = useState<UserDTO | null>(null);
  const [removing, setRemoving] = useState<UserDTO | null>(null);
  const [resetting, setResetting] = useState<UserDTO | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api<UserDTO[]>("/api/users"), api<TeamDTO[]>("/api/teams")])
      .then(([peopleData, teamsData]) => {
        if (cancelled) return;
        setPeople(peopleData);
        setTeams(teamsData);
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  async function patchUser(id: string, body: Record<string, unknown>, message: string) {
    try {
      await api(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast.success(message);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that.");
    }
  }

  async function remove(user: UserDTO) {
    try {
      await api(`/api/users/${user.id}`, { method: "DELETE" });
      toast.success(`${user.name} removed.`);
      setRemoving(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove that account.");
    }
  }

  async function onImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const result = await api<{ created: number; updated: number; errors: string[]; issuedPasswords: Array<{ email: string; password: string }> }>("/api/import", {
        method: "POST",
        body: JSON.stringify({ area: "people", format: "csv", payload: text }),
      });
      toast.success(`Imported ${result.created} new, updated ${result.updated}.`);
      if (result.issuedPasswords.length > 0) {
        toast.info(
          `${result.issuedPasswords.length} new password${result.issuedPasswords.length === 1 ? "" : "s"} to hand out`,
          { description: result.issuedPasswords.map((p) => `${p.email}: ${p.password}`).join("\n"), duration: 30000 },
        );
      }
      if (result.errors.length > 0) toast.warning(`${result.errors.length} rows need attention`, { description: result.errors.slice(0, 3).join(" · ") });
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">People</CardTitle>
          <span className="text-xs text-muted-foreground">{people?.length ?? "…"}</span>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href="/api/export?area=people&format=csv" download>
                <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Export
              </a>
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Import CSV
            </Button>
            <Button size="sm" onClick={() => setInviting(true)}>
              <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Invite
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={onImportFile} aria-label="Import people CSV" />

        {people === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          people.map((person) => (
            <div key={person.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3 transition-colors hover:border-primary/40">
              <StickerPfp pfp={person.pfp} name={person.name} size={36} variable />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{person.name}</span>
                  {person.id === selfId ? <span className="text-[10px] text-muted-foreground">· you</span> : null}
                  <RoleBadge role={person.role} />
                  {person.teamName ? (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${teamColor(person.teamName).dot} ${teamColor(person.teamName).text}`}>
                      {person.teamName}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  {person.email}
                  <span className="inline-flex items-center gap-0.5" title="Email is permanent">
                    <KeyRound className="h-3 w-3" aria-hidden />
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Select
                  value={person.teamId ?? "none"}
                  onValueChange={(value) => void patchUser(person.id, { teamId: value === "none" ? null : value }, `${person.name} moved teams.`)}
                >
                  <SelectTrigger className="h-8 w-28 text-xs" aria-label={`Team for ${person.name}`}>
                    <SelectValue placeholder="No team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No team</SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={person.role}
                  onValueChange={(value) => void patchUser(person.id, { role: value }, `${person.name} is now ${value.toLowerCase()}.`)}
                  disabled={person.id === selfId}
                >
                  <SelectTrigger className="h-8 w-24 text-xs" aria-label={`Role for ${person.name}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ADMIN">Admin</SelectItem>
                    <SelectItem value="LEAD">Lead</SelectItem>
                    <SelectItem value="MEMBER">Member</SelectItem>
                  </SelectContent>
                </Select>

                <Button variant="outline" size="sm" className="h-8" onClick={() => setPermissionsFor(person)}>
                  <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Authorize
                </Button>

                {person.id !== selfId ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground" aria-label={`More for ${person.name}`}>
                        •••
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => { setResetting(person); setNewPassword(""); }}>
                        <KeyRound className="h-4 w-4" aria-hidden /> Reset password
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onSelect={() => setRemoving(person)}>
                        <Trash2 className="h-4 w-4" aria-hidden /> Remove account
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </div>
          ))
        )}
      </CardContent>

      {inviting ? (
        <InviteDialog
          teams={teams}
          onOpenChange={(open) => (open ? null : setInviting(false))}
          onSaved={() => {
            setInviting(false);
            onChanged();
          }}
        />
      ) : null}

      {permissionsFor ? (
        <PermissionsDialog
          person={permissionsFor}
          selfId={selfId}
          onOpenChange={(open) => (open ? null : setPermissionsFor(null))}
          onToggle={(flag, value) => {
            void patchUser(permissionsFor.id, { [flag]: value }, `${permissionsFor.name}'s powers updated.`);
            setPermissionsFor({ ...permissionsFor, [flag]: value });
          }}
        />
      ) : null}

      <Dialog open={Boolean(removing)} onOpenChange={(open) => (open ? null : setRemoving(null))}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
            <DialogDescription>
              Their sign-in stops working immediately. People holding bookings can&apos;t be removed until those are cancelled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>Keep</Button>
            <Button variant="destructive" onClick={() => removing && void remove(removing)}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(resetting)} onOpenChange={(open) => (open ? null : setResetting(null))}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset password for {resetting?.name}</DialogTitle>
            <DialogDescription>
              Type a temporary password and share it with them — they can change it from their profile.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reset-password">Temporary password</Label>
            <Input id="reset-password" type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} placeholder="at least 8 characters" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetting(null)}>Cancel</Button>
            <Button
              disabled={newPassword.length < 8}
              onClick={() => resetting && void patchUser(resetting.id, { password: newPassword }, "Password reset.").then(() => setResetting(null))}
            >
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function RoleBadge({ role }: { role: Role }) {
  if (role === "ADMIN") {
    return <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">ADMIN</span>;
  }
  if (role === "LEAD") {
    return <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-secondary-foreground">LEAD</span>;
  }
  return null;
}

const PERMISSIONS: Array<{ flag: "canManageAssets" | "canManageBookings" | "canManagePeople" | "canManageSettings"; title: string; description: string }> = [
  { flag: "canManageBookings", title: "Manage all bookings", description: "Edit or cancel anyone's booking, not just their own." },
  { flag: "canManageAssets", title: "Manage gear & rooms", description: "Add or edit inventory, import a gear sheet." },
  { flag: "canManagePeople", title: "Invite & manage people", description: "Add accounts, set teams, roles and powers." },
  { flag: "canManageSettings", title: "Change settings", description: "Booking types, teams, notifications, security." },
];

function PermissionsDialog({
  person,
  selfId,
  onOpenChange,
  onToggle,
}: {
  person: UserDTO;
  selfId: string;
  onOpenChange: (open: boolean) => void;
  onToggle: (flag: (typeof PERMISSIONS)[number]["flag"], value: boolean) => void;
}) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Authorize {person.name}</DialogTitle>
          <DialogDescription>
            {person.role === "ADMIN"
              ? "Admins already hold every power — these switches are informational for them."
              : "Each power can be handed out separately. It applies the moment you flip it."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2.5">
          {PERMISSIONS.map((permission) => (
            <label key={permission.flag} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <span>
                <span className="block text-sm font-medium">{permission.title}</span>
                <span className="block text-xs text-muted-foreground">{permission.description}</span>
              </span>
              <Switch
                checked={person.role === "ADMIN" ? true : Boolean(person[permission.flag])}
                disabled={person.role === "ADMIN" || person.id === selfId}
                onCheckedChange={(checked) => onToggle(permission.flag, checked)}
                aria-label={permission.title}
              />
            </label>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({
  teams,
  onOpenChange,
  onSaved,
}: {
  teams: TeamDTO[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("MEMBER");
  const [teamId, setTeamId] = useState("none");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({
          name,
          email,
          password,
          role,
          teamId: teamId === "none" ? null : teamId,
          canManageAssets: role === "LEAD",
          canManageBookings: role === "LEAD",
        }),
      });
      toast.success(`${name} is in. Share their password privately — email stays permanent.`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add that person.");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            The email becomes their permanent sign-in. Hand the password over privately.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">Name</Label>
            <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@studio.com" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="invite-password">Temporary password</Label>
              <Input id="invite-password" type="text" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} placeholder="8+ characters" />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(value) => setRole(value as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MEMBER">Member</SelectItem>
                  <SelectItem value="LEAD">Team lead</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Team</Label>
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger><SelectValue placeholder="No team" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No team</SelectItem>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {role === "LEAD" ? (
            <p className="rounded-md bg-primary/10 px-3 py-2 text-xs text-primary">
              Team leads start with “manage bookings” and “manage gear” — adjust any power after with Authorize.
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="brand-gradient font-semibold text-primary-foreground" disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              Add person
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
