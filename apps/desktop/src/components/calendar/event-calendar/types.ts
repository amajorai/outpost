/**
 * Vendored from the MIT origin-space/event-calendar
 * (https://github.com/origin-space/event-calendar), adapted to Outpost's
 * @repo/ui primitives and Tailwind v4 OKLCH tokens.
 *
 * The upstream component is early-alpha: keyboard a11y on the grid cells and
 * multi-day event handling are known-incomplete. See followUps and the inline
 * NOTE(alpha) comments. We map `scheduled_posts` onto `CalendarEvent` in
 * `calendar-mapping.ts`; the `color` field encodes post status.
 */

export type CalendarView = "month" | "week" | "day" | "agenda";

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  color?: EventColor;
  location?: string;
}

export type EventColor =
  | "sky"
  | "amber"
  | "violet"
  | "rose"
  | "emerald"
  | "orange"
  // Outpost addition: a muted swatch for terminal/cancelled posts that have no
  // natural home in the upstream six-color palette.
  | "muted";
