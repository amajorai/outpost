/**
 * Vendored from origin-space/event-calendar (MIT). Barrel kept from upstream so
 * the internal cross-imports (`@/components/calendar/event-calendar`) resolve as
 * a single module, mirroring the source layout. External callers should import
 * the `EventCalendar` and `CalendarEvent` type from here.
 */

// Component exports
// biome-ignore lint/performance/noBarrelFile: vendored upstream layout relies on a single-module barrel so internal cross-imports resolve
export { AgendaView } from "./agenda-view";
export { CalendarDndProvider, useCalendarDnd } from "./calendar-dnd-context";
// Constants and utility exports
export * from "./constants";
export { DayView } from "./day-view";
export { DraggableEvent } from "./draggable-event";
export { DroppableCell } from "./droppable-cell";
export { EventCalendar } from "./event-calendar";
export { EventItem } from "./event-item";
export { EventsPopup } from "./events-popup";
// Hook exports
export * from "./hooks/use-current-time-indicator";
export * from "./hooks/use-event-visibility";
export { MonthView } from "./month-view";
// Type exports
export type { CalendarEvent, CalendarView, EventColor } from "./types";
export * from "./utils";
export { WeekView } from "./week-view";
