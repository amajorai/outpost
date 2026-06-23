/**
 * Workspace switcher (U32).
 *
 * Lives in the sidebar header. A dropdown lists the user's workspaces, switches
 * the active one on click, and opens dialogs to create, rename, or delete a
 * workspace. Switching the active workspace re-scopes every data view — the
 * mechanics of that live in `use-workspace-store` (which mirrors the id to the
 * `current-workspace` seam) and `app-shell` (which remounts the panels on the
 * active id).
 */

import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { Input } from "@repo/ui/input";
import { Check, ChevronsUpDown, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "@/stores/use-workspace-store";

type DialogMode = "create" | "rename" | "delete" | null;

export function WorkspaceSwitcher() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);

  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId),
    [workspaces, activeWorkspaceId]
  );
  const activeLabel = activeWorkspace?.name ?? "Workspace";
  const targetWorkspace = useMemo(
    () => workspaces.find((w) => w.id === targetId),
    [workspaces, targetId]
  );
  const canDelete = workspaces.length > 1;

  // Reset the dialog's draft each time it opens so a previous edit never leaks in.
  useEffect(() => {
    if (dialogMode === null) {
      return;
    }
    setError(null);
    if (dialogMode === "create") {
      setNameDraft("");
    } else if (dialogMode === "rename") {
      setNameDraft(targetWorkspace?.name ?? "");
    }
  }, [dialogMode, targetWorkspace]);

  const closeDialog = useCallback(() => {
    setDialogMode(null);
    setTargetId(null);
  }, []);

  const openCreate = useCallback(() => {
    setMenuOpen(false);
    setTargetId(null);
    setDialogMode("create");
  }, []);

  const openRename = useCallback((id: string) => {
    setMenuOpen(false);
    setTargetId(id);
    setDialogMode("rename");
  }, []);

  const openDelete = useCallback((id: string) => {
    setMenuOpen(false);
    setTargetId(id);
    setDialogMode("delete");
  }, []);

  const handleSwitch = useCallback(
    async (id: string) => {
      setMenuOpen(false);
      await setActiveWorkspace(id);
    },
    [setActiveWorkspace]
  );

  const handleSubmit = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      if (dialogMode === "create") {
        await createWorkspace(nameDraft);
      } else if (dialogMode === "rename" && targetId) {
        await renameWorkspace(targetId, nameDraft);
      } else if (dialogMode === "delete" && targetId) {
        await deleteWorkspace(targetId);
      }
      closeDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsBusy(false);
    }
  }, [
    dialogMode,
    nameDraft,
    targetId,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    closeDialog,
  ]);

  const isNameMode = dialogMode === "create" || dialogMode === "rename";
  const submitDisabled =
    isBusy || (isNameMode && nameDraft.trim().length === 0);

  return (
    <>
      <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className="flex w-full items-center gap-2 rounded-xl border border-sidebar-border bg-background/40 px-3 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            type="button"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 font-semibold text-primary text-xs">
              {activeLabel.slice(0, 1).toUpperCase()}
            </span>
            <span className="flex-1 truncate font-medium">{activeLabel}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.map((workspace) => (
            <div
              className="group/row flex items-center gap-1 rounded-2xl px-1 hover:bg-accent"
              key={workspace.id}
            >
              <button
                className="flex flex-1 items-center gap-2 truncate rounded-xl px-2 py-1.5 text-left text-sm"
                onClick={() => handleSwitch(workspace.id)}
                type="button"
              >
                <Check
                  className={
                    workspace.id === activeWorkspaceId
                      ? "size-4 shrink-0 opacity-100"
                      : "size-4 shrink-0 opacity-0"
                  }
                />
                <span className="flex-1 truncate font-medium">
                  {workspace.name}
                </span>
              </button>
              <button
                aria-label={`Rename ${workspace.name}`}
                className="rounded p-1 text-muted-foreground opacity-0 hover:text-foreground group-hover/row:opacity-100"
                onClick={() => openRename(workspace.id)}
                type="button"
              >
                <Pencil className="size-3.5" />
              </button>
              {canDelete && (
                <button
                  aria-label={`Delete ${workspace.name}`}
                  className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover/row:opacity-100"
                  onClick={() => openDelete(workspace.id)}
                  type="button"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={openCreate}>
            <Plus className="size-4" />
            <span>New workspace</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        onOpenChange={(next) => {
          if (!next) {
            closeDialog();
          }
        }}
        open={dialogMode !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "create" && "New workspace"}
              {dialogMode === "rename" && "Rename workspace"}
              {dialogMode === "delete" && "Delete workspace"}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === "delete"
                ? `This permanently deletes "${targetWorkspace?.name ?? ""}" and all of its accounts, drafts, schedules, and analytics. This cannot be undone.`
                : "A workspace isolates its own accounts, drafts, schedules, and analytics."}
            </DialogDescription>
          </DialogHeader>

          {isNameMode && (
            <Input
              autoFocus
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !submitDisabled) {
                  handleSubmit();
                }
              }}
              placeholder="Workspace name"
              value={nameDraft}
            />
          )}

          {error && <p className="text-destructive text-sm">{error}</p>}

          <DialogFooter>
            <Button
              disabled={isBusy}
              onClick={closeDialog}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={submitDisabled}
              onClick={handleSubmit}
              type="button"
              variant={dialogMode === "delete" ? "destructive" : "default"}
            >
              {dialogMode === "create" && "Create"}
              {dialogMode === "rename" && "Save"}
              {dialogMode === "delete" && "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
