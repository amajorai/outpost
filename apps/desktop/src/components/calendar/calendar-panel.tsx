/**
 * The Calendar section's main panel (U11).
 *
 * Loads scheduled posts, maps them onto the vendored event-calendar's
 * `CalendarEvent`, and wires the three mutations:
 * - drag-to-reschedule -> `rescheduleScheduledPost` (scheduled posts only)
 * - delete -> `cancelScheduledPost`
 * - add (empty-slot click / New post) -> prefill the composer time and switch
 *   to the Compose section.
 *
 * Color encodes status (see calendar-mapping.ts); terminal posts are read-only.
 */

import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  enrichEventsWithTitles,
  isTerminalStatus,
  scheduledPostToEvent,
} from "@/components/calendar/calendar-mapping";
import {
  type CalendarEvent,
  EventCalendar,
} from "@/components/calendar/event-calendar";
import { TimingRecommendations } from "@/components/calendar/timing-recommendations";
import { getSectionMeta } from "@/components/nav/sections";
import { logger } from "@/lib/logger";
import {
  cancelScheduledPost,
  listScheduledPosts,
  rescheduleScheduledPost,
} from "@/lib/repos/scheduled-posts";
import type { ScheduledPost } from "@/lib/social-schema";
import { useComposerStore } from "@/stores/use-composer-store";
import { useNavigationStore } from "@/stores/use-navigation-store";

export function CalendarPanel() {
  const { label } = getSectionMeta("calendar");
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  const prefillSchedule = useComposerStore((s) => s.prefillSchedule);
  const setActiveSection = useNavigationStore((s) => s.setActiveSection);

  const load = useCallback(async () => {
    try {
      const loaded = await listScheduledPosts();
      const mapped = loaded.map(scheduledPostToEvent);
      const enriched = await enrichEventsWithTitles(loaded, mapped);
      setPosts(loaded);
      // Spread to a new array so React sees the in-place title mutation.
      setEvents([...enriched]);
    } catch (error) {
      logger.error({ err: error }, "[Calendar] Failed to load scheduled posts");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Quick status lookup so the calendar can gate reschedule/cancel and the
  // detail dialog can disable the cancel action for terminal posts.
  const statusById = useMemo(() => {
    return new Map(posts.map((post) => [post.id, post.status]));
  }, [posts]);

  const isEventTerminal = useCallback(
    (event: CalendarEvent) => {
      const status = statusById.get(event.id);
      return status ? isTerminalStatus(status) : false;
    },
    [statusById]
  );

  const handleEventAdd = useCallback(
    (startTime: Date) => {
      prefillSchedule(startTime.getTime());
      setActiveSection("compose");
    },
    [prefillSchedule, setActiveSection]
  );

  // Picking a recommended slot reuses the empty-slot path: seed the composer's
  // schedule time and jump to Compose.
  const handlePickSlot = useCallback(
    (epochMillis: number) => {
      prefillSchedule(epochMillis);
      setActiveSection("compose");
    },
    [prefillSchedule, setActiveSection]
  );

  const handleEventUpdate = useCallback(
    async (event: CalendarEvent) => {
      const status = statusById.get(event.id);
      if (status !== "scheduled") {
        toast("Only posts that haven't started can be rescheduled");
        return;
      }
      try {
        await rescheduleScheduledPost(event.id, event.start.getTime());
        toast(`Rescheduled to ${format(event.start, "MMM d, h:mm a")}`);
        await load();
      } catch (error) {
        logger.error({ err: error }, "[Calendar] Failed to reschedule post");
        toast("Could not reschedule the post");
      }
    },
    [statusById, load]
  );

  const handleEventDelete = useCallback(
    async (eventId: string) => {
      try {
        await cancelScheduledPost(eventId);
        toast("Post cancelled");
        await load();
      } catch (error) {
        logger.error({ err: error }, "[Calendar] Failed to cancel post");
        toast("Could not cancel the post");
      }
    },
    [load]
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6">
      <h1 className="sr-only">{label}</h1>
      <TimingRecommendations onPickSlot={handlePickSlot} />
      <div className="flex min-h-0 flex-1 flex-col">
        <EventCalendar
          events={events}
          initialView="month"
          isEventTerminal={isEventTerminal}
          onEventAdd={handleEventAdd}
          onEventDelete={handleEventDelete}
          onEventUpdate={handleEventUpdate}
        />
      </div>
    </section>
  );
}
