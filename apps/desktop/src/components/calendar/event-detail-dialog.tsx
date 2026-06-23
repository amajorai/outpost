/**
 * App-specific replacement for the upstream event-calendar `EventDialog` (U11).
 *
 * The vendored dialog edited free-form events (title, color, location, all-day,
 * start/end times). None of those map onto a scheduled post, which is a single
 * point-in-time queue entry whose body lives in the composer. So this thin
 * dialog only shows the selected post's details and offers a "Cancel post"
 * action that routes to `onEventDelete`.
 *
 * Creation does NOT route through this dialog: clicking an empty slot or the
 * "New event" button opens the composer at that time (see `calendar-panel.tsx`).
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
import { format } from "date-fns";
import { Ban } from "lucide-react";
import type { CalendarEvent } from "@/components/calendar/event-calendar";

interface EventDetailDialogProps {
  event: CalendarEvent | null;
  isOpen: boolean;
  /** True when the post is in a terminal state and cannot be cancelled. */
  isTerminal: boolean;
  onClose: () => void;
  onCancelPost: (eventId: string) => void;
}

export function EventDetailDialog({
  event,
  isOpen,
  isTerminal,
  onClose,
  onCancelPost,
}: EventDetailDialogProps) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{event?.title || "Scheduled post"}</DialogTitle>
          <DialogDescription>
            {event
              ? format(new Date(event.start), "EEEE, MMMM d, yyyy 'at' h:mm a")
              : ""}
          </DialogDescription>
        </DialogHeader>

        {event?.description && (
          <p className="whitespace-pre-wrap text-muted-foreground text-sm">
            {event.description}
          </p>
        )}

        <DialogFooter className="flex-row sm:justify-between">
          {event && !isTerminal ? (
            <Button
              onClick={() => onCancelPost(event.id)}
              type="button"
              variant="destructive"
            >
              <Ban className="size-4" />
              Cancel post
            </Button>
          ) : (
            <span className="text-muted-foreground text-xs">
              {isTerminal
                ? "This post has already run and cannot be changed."
                : ""}
            </span>
          )}
          <Button onClick={onClose} type="button" variant="outline">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
