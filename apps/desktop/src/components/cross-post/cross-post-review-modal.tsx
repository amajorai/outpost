/**
 * Review/confirm dialog for auto cross-post (U19).
 *
 * Mounted once at the app root (like {@link VersionGateModal}). It reads the
 * cross-post review queue and, while any post is pending, renders the front item
 * for the user to confirm or skip. Confirming routes the post to its target
 * platforms through the publish pipeline; skipping drops it. This is the
 * acceptance-critical "never silently post to real accounts" gate.
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
import { Send, Share2 } from "lucide-react";
import { useCallback } from "react";
import { sileo } from "sileo";
import { platformLabel } from "@/components/compose/platform-meta";
import { routeDetectedPost } from "@/lib/cross-post/route";
import { logger } from "@/lib/logger";
import { useCrossPostStore } from "@/stores/use-cross-post-store";

export function CrossPostReviewModal() {
  const pending = useCrossPostStore((s) => s.pending);
  const publishingId = useCrossPostStore((s) => s.publishingId);
  const dequeue = useCrossPostStore((s) => s.dequeue);
  const setPublishing = useCrossPostStore((s) => s.setPublishing);

  const item = pending[0] ?? null;

  const handleConfirm = useCallback(async () => {
    if (!item) {
      return;
    }
    // Guard against a double-click double-posting: `publishingId` from the
    // render is stale across two rapid clicks, so read the live store state.
    // zustand `set` is synchronous, so the first click's `setPublishing` is
    // visible to the second click before its re-render lands.
    if (useCrossPostStore.getState().publishingId) {
      return;
    }
    setPublishing(item.id);
    try {
      const result = await routeDetectedPost(
        item.detected,
        item.targetPlatforms
      );
      if (result.targetCount === 0) {
        sileo.info({
          title: "No connected target accounts",
          description: "Connect an account on a target platform first.",
        } as Parameters<typeof sileo.info>[0]);
      } else {
        sileo.success({
          title: "Cross-posting your post",
          description: `Routing to ${result.targetCount} target${result.targetCount === 1 ? "" : "s"}`,
        } as Parameters<typeof sileo.success>[0]);
      }
    } catch (err) {
      logger.error({ err }, "[CrossPost] Failed to route confirmed post");
      sileo.error({
        title: "Couldn't cross-post",
        description: "Something went wrong routing your post.",
      } as Parameters<typeof sileo.error>[0]);
    } finally {
      dequeue(item.id);
    }
  }, [item, dequeue, setPublishing]);

  const handleSkip = useCallback(() => {
    if (item) {
      dequeue(item.id);
    }
  }, [item, dequeue]);

  if (!item) {
    return null;
  }

  const isPublishing = publishingId === item.id;
  const targetNames = item.targetPlatforms.map(platformLabel).join(", ");

  return (
    <Dialog open>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-primary/10">
            <Share2 className="size-5 text-primary" />
          </div>
          <DialogTitle>Cross-post this?</DialogTitle>
          <DialogDescription>
            You just posted on{" "}
            <strong className="text-foreground">
              {platformLabel(item.detected.platform)}
            </strong>
            . Send it to {targetNames} too?
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm">
          {item.detected.text || "(no text)"}
        </div>

        {pending.length > 1 && (
          <p className="text-muted-foreground text-xs">
            {pending.length - 1} more waiting for review.
          </p>
        )}

        <DialogFooter>
          <Button onClick={handleSkip} type="button" variant="ghost">
            Skip
          </Button>
          <Button
            className="gap-2"
            disabled={isPublishing}
            onClick={handleConfirm}
            type="button"
          >
            <Send className="size-4" />
            {isPublishing ? "Posting..." : "Cross-post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
