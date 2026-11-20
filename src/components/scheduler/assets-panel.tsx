"use client";

// Gear & rooms: the inventory behind the calendar. Grouped by category,
// with CSV import/export so an existing gear sheet can move in as-is.

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Package, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AssetDTO, SessionUser } from "@/types";
import { api } from "./api";
import { offerUndo } from "./undo";

interface AssetsPanelProps {
  user: SessionUser;
  refreshKey: number;
  onChanged: () => void;
}

const ROOM_CATEGORY = "Studio Room";

export function AssetsPanel({ user, refreshKey, onChanged }: AssetsPanelProps) {
  const [assets, setAssets] = useState<AssetDTO[] | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<AssetDTO | "new" | null>(null);
  const [deleting, setDeleting] = useState<AssetDTO | null>(null);
  const canManage = user.role === "ADMIN" || Boolean(user.canManageAssets);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    api<AssetDTO[]>("/api/assets")
      .then((data) => {
        if (!cancelled) setAssets(data);
      })
      .catch(() => {
        if (!cancelled) setAssets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = (assets ?? []).filter(
      (asset) => !needle || asset.name.toLowerCase().includes(needle) || asset.category.toLowerCase().includes(needle) || (asset.tag ?? "").toLowerCase().includes(needle),
    );
    const map = new Map<string, AssetDTO[]>();
    for (const asset of filtered) {
      const list = map.get(asset.category) ?? [];
      list.push(asset);
      map.set(asset.category, list);
    }
    // Rooms float to the top — they're the spaces everything happens in.
    return [...map.entries()].sort(([a], [b]) => (a === ROOM_CATEGORY ? -1 : b === ROOM_CATEGORY ? 1 : a.localeCompare(b)));
  }, [assets, search]);

  const quickMatches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return (assets ?? [])
      .filter(
        (asset) =>
          asset.name.toLowerCase().includes(needle) ||
          asset.category.toLowerCase().includes(needle) ||
          (asset.tag ?? "").toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [assets, search]);

  async function remove(asset: AssetDTO) {
    try {
      await api(`/api/assets/${asset.id}`, { method: "DELETE" });
      offerUndo("asset", asset.id, `Removed “${asset.name}” from the inventory.`, onChanged);
      setDeleting(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove that.");
    }
  }

  async function onImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const result = await api<{ created: number; updated: number; errors: string[] }>("/api/import", {
        method: "POST",
        body: JSON.stringify({ area: "assets", format: "csv", payload: text }),
      });
      toast.success(`Imported ${result.created} new, updated ${result.updated}.`);
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
          <CardTitle className="text-base">Gear & rooms</CardTitle>
          <span className="text-xs text-muted-foreground">{assets?.length ?? "…"} items</span>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="h-9 w-56 pl-8" aria-label="Search gear" />
              {search.trim() ? (
                <div className="absolute right-0 top-11 z-30 w-80 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
                  {quickMatches.length === 0 ? (
                    <p className="px-3 py-3 text-center text-sm text-muted-foreground">No gear matches that search.</p>
                  ) : (
                    <>
                      {quickMatches.map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => setSearch(asset.name)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                        >
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
                              asset.category === ROOM_CATEGORY ? "bg-violet-400/20 text-violet-500" : "bg-primary/15 text-primary"
                            }`}
                            aria-hidden
                          >
                            {asset.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{asset.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {asset.category}
                              {asset.tag ? ` · ${asset.tag}` : ""}
                            </span>
                          </span>
                        </button>
                      ))}
                      <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
                        Click a result to zero in — the list below keeps updating as you type.
                      </p>
                    </>
                  )}
                </div>
              ) : null}
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href="/api/export?area=assets&format=csv" download>
                <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Export
              </a>
            </Button>
            {canManage ? (
              <>
                <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                  <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Import CSV
                </Button>
                <Button size="sm" onClick={() => setEditing("new")}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Add
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={onImportFile} aria-label="Import gear CSV" />

        {assets === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : assets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
            <Package className="h-8 w-8" aria-hidden />
            <p>The inventory is empty.</p>
            {canManage ? <p>Add the first item, or import a CSV from your gear sheet.</p> : <p>Ask a team lead to add gear.</p>}
          </div>
        ) : (
          groups.map(([category, list]) => (
            <div key={category}>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{category}</h3>
                <span className="rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">{list.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((asset) => (
                  <div
                    key={asset.id}
                    className={`group flex items-center gap-2.5 rounded-lg border p-2.5 transition-colors hover:border-primary/40 ${asset.active ? "" : "opacity-55"}`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                        asset.category === ROOM_CATEGORY ? "bg-violet-400/20 text-violet-500" : "bg-primary/15 text-primary"
                      }`}
                      aria-hidden
                    >
                      {asset.category === ROOM_CATEGORY ? "R" : asset.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[15px] font-semibold">{asset.name}</span>
                        {!asset.active ? <span className="shrink-0 rounded bg-secondary px-1 text-[10px] text-muted-foreground">inactive</span> : null}
                      </div>
                      <div className="truncate text-[13px] text-muted-foreground">
                        {asset.tag ? `${asset.tag} · ` : ""}
                        {asset.notes ?? "—"}
                      </div>
                    </div>
                    {canManage ? (
                      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Edit ${asset.name}`} onClick={() => setEditing(asset)}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label={`Remove ${asset.name}`} onClick={() => setDeleting(asset)}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </CardContent>

      {editing ? (
        <AssetDialog
          asset={editing === "new" ? null : editing}
          onOpenChange={(open) => (open ? null : setEditing(null))}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}

      <Dialog open={Boolean(deleting)} onOpenChange={(open) => (open ? null : setDeleting(null))}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              It leaves the picker right away, but nothing is lost — undo here, or restore it later from Settings → Trash.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Keep it</Button>
            <Button variant="destructive" onClick={() => deleting && void remove(deleting)}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AssetDialog({
  asset,
  onOpenChange,
  onSaved,
}: {
  asset: AssetDTO | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(asset?.name ?? "");
  const [category, setCategory] = useState(asset?.category ?? "Camera");
  const [customCategory, setCustomCategory] = useState("");
  const [tag, setTag] = useState(asset?.tag ?? "");
  const [notes, setNotes] = useState(asset?.notes ?? "");
  const [active, setActive] = useState(asset?.active ?? true);
  const [busy, setBusy] = useState(false);

  const effectiveCategory = customCategory.trim() || category;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = { name: name.trim(), category: effectiveCategory, tag: tag.trim() || null, notes: notes.trim() || null, active };
      if (asset) {
        await api(`/api/assets/${asset.id}`, { method: "PATCH", body: JSON.stringify(payload) });
        toast.success("Item updated.");
      } else {
        await api("/api/assets", { method: "POST", body: JSON.stringify(payload) });
        toast.success(`“${name.trim()}” added to the inventory.`);
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{asset ? "Edit item" : "Add to the inventory"}</DialogTitle>
          <DialogDescription>Gear, lenses, audio — or a whole studio room.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="asset-name">Name</Label>
            <Input id="asset-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sony A7 IV body" required maxLength={120} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              {!asset ? (
                <Select value={category === "__custom" ? "" : category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue placeholder="Pick one" /></SelectTrigger>
                  <SelectContent>
                    {["Camera", "Lens", "Audio", "Lighting", "Support", "Drone", "Storage", ROOM_CATEGORY, "__custom"].map((c) => (
                      <SelectItem key={c} value={c}>{c === "__custom" ? "Custom…" : c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} />
              )}
              {category === "__custom" && !asset ? (
                <Input value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} placeholder="Custom category" maxLength={60} />
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="asset-tag">Tag / ID</Label>
              <Input id="asset-tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="GEAR-013" maxLength={60} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-notes">Notes</Label>
            <Input id="asset-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Kit bag, batteries, quirks…" maxLength={500} />
          </div>
          <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
            <span>
              Bookable
              <span className="block text-xs text-muted-foreground">Inactive items can&apos;t be picked for new bookings.</span>
            </span>
            <Switch checked={active} onCheckedChange={setActive} aria-label="Bookable" />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              {asset ? "Save" : "Add item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
