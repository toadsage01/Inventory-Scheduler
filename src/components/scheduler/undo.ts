"use client";

// The undo ribbon: after any delete, a toast offers "Undo" for a few
// seconds. Behind the scenes it calls /api/trash with action=restore —
// the original deleter can restore their own kind, and admins can
// restore anything (also later, from Settings → Trash).

import { toast } from "sonner";
import { api } from "./api";

export type TrashKind = "booking" | "asset" | "type" | "team";

export function offerUndo(kind: TrashKind, id: string, message: string, onChanged?: () => void) {
  toast.success(message, {
    description: "Deleted items can be restored — undo here, or via Settings → Trash.",
    duration: 9000,
    action: {
      label: "Undo",
      onClick: () => {
        api("/api/trash", { method: "POST", body: JSON.stringify({ kind, id, action: "restore" }) })
          .then(() => {
            toast.success("Restored — like it never happened.");
            onChanged?.();
          })
          .catch((err: unknown) => {
            toast.error(err instanceof Error ? err.message : "Could not restore. An admin can do it from Settings → Trash.");
          });
      },
    },
  });
}
