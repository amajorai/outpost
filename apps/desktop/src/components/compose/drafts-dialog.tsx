/**
 * Saved-drafts browser for the composer (U8).
 *
 * Lists the workspace's drafts and loads one into the composer on click. This is
 * the load half of the save/load draft flow; saving lives in the composer panel.
 */

import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { FileText } from "lucide-react";
import { useCallback, useState } from "react";
import { decodeDraftBody, listDrafts as fetchDrafts } from "@/lib/repos/drafts";
import type { Draft } from "@/lib/social-schema";
import { useComposerStore } from "@/stores/use-composer-store";

function draftSummary(draft: Draft): string {
  const body = decodeDraftBody(draft.body);
  const text = body.text.trim();
  if (text.length > 0) {
    return text.length > 80 ? `${text.slice(0, 80)}...` : text;
  }
  if (body.media.length > 0) {
    return `${body.media.length} attachment${body.media.length === 1 ? "" : "s"}`;
  }
  return "Empty draft";
}

export function DraftsDialog() {
  const loadDraft = useComposerStore((s) => s.loadDraft);
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setDrafts(await fetchDrafts());
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        refresh();
      }
    },
    [refresh]
  );

  const handleSelect = useCallback(
    async (id: string) => {
      await loadDraft(id);
      setOpen(false);
    },
    [loadDraft]
  );

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <Button
        onClick={() => handleOpenChange(true)}
        size="sm"
        type="button"
        variant="ghost"
      >
        <FileText className="size-4" />
        Drafts
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Drafts</DialogTitle>
          <DialogDescription>
            Open a saved draft to keep working on it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
          {isLoading && (
            <p className="text-muted-foreground text-sm">Loading...</p>
          )}
          {!isLoading && drafts.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No saved drafts yet.
            </p>
          )}
          {drafts.map((draft) => (
            <button
              className="flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
              key={draft.id}
              onClick={() => handleSelect(draft.id)}
              type="button"
            >
              <span className="line-clamp-2">{draftSummary(draft)}</span>
              <span className="text-muted-foreground text-xs">
                {new Date(draft.updatedAt).toLocaleString()}
              </span>
            </button>
          ))}
        </div>
        <DialogClose
          render={
            <Button type="button" variant="ghost">
              Close
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
