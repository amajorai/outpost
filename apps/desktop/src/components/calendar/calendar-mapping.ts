/**
 * Maps `scheduled_posts` rows onto the vendored calendar's `CalendarEvent` (U11).
 *
 * A scheduled post is a single point in time, not a range, so we synthesize a
 * fixed-length block (`EVENT_DURATION_MINUTES`) purely for rendering. The
 * `CalendarEvent.color` field is repurposed to encode the post status, and the
 * title is enriched from the linked draft body (see `enrichEventsWithTitles`).
 *
 * The `CalendarEvent.id` is the `scheduled_posts.id`, so drag-reschedule and
 * cancel can map straight back to the row.
 */

import type {
  CalendarEvent,
  EventColor,
} from "@/components/calendar/event-calendar";
import { decodeDraftBody, getDraft } from "@/lib/repos/drafts";
import type { ScheduledPost, ScheduledPostStatus } from "@/lib/social-schema";

/** Synthetic block length for an otherwise instantaneous scheduled post. */
export const EVENT_DURATION_MINUTES = 30;

/** Default title when a post has no linked/decodable draft body. */
const FALLBACK_TITLE = "Scheduled post";

/**
 * Status -> swatch. All seven `ScheduledPostStatus` values are mapped explicitly
 * so a new status is a compile error here rather than a silent default.
 */
const STATUS_COLOR: Record<ScheduledPostStatus, EventColor> = {
  scheduled: "sky",
  due: "amber",
  publishing: "violet",
  published: "emerald",
  partial: "orange",
  failed: "rose",
  cancelled: "muted",
};

/** Posts in these states have already run and must not be rescheduled/cancelled. */
const TERMINAL_STATUSES: ReadonlySet<ScheduledPostStatus> =
  new Set<ScheduledPostStatus>(["published", "partial", "failed", "cancelled"]);

export function isTerminalStatus(status: ScheduledPostStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Map a single scheduled post to a calendar event (title filled in later). */
export function scheduledPostToEvent(post: ScheduledPost): CalendarEvent {
  const start = new Date(post.scheduledFor);
  const end = new Date(post.scheduledFor + EVENT_DURATION_MINUTES * 60 * 1000);
  return {
    id: post.id,
    title: FALLBACK_TITLE,
    start,
    end,
    allDay: false,
    color: STATUS_COLOR[post.status],
  };
}

/** First non-empty line of the draft text, trimmed for a calendar block. */
function titleFromText(text: string): string {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return FALLBACK_TITLE;
  }
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
}

/**
 * Enrich mapped events with titles/descriptions from their linked drafts.
 * Reads are done in parallel; a missing or undecodable draft falls back to the
 * generic title so an ad-hoc (`draftId === null`) post still renders.
 */
export async function enrichEventsWithTitles(
  posts: ScheduledPost[],
  events: CalendarEvent[]
): Promise<CalendarEvent[]> {
  const byId = new Map(events.map((event) => [event.id, event]));

  await Promise.all(
    posts.map(async (post) => {
      const event = byId.get(post.id);
      if (!(event && post.draftId)) {
        return;
      }
      try {
        const draft = await getDraft(post.draftId);
        if (!draft) {
          return;
        }
        const body = decodeDraftBody(draft.body);
        if (body.text.trim()) {
          event.title = titleFromText(body.text);
          event.description = body.text;
        }
      } catch {
        // Leave the fallback title; a bad draft body must not break the calendar.
      }
    })
  );

  return events;
}
