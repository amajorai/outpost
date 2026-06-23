/** Vendored from origin-space/event-calendar (MIT). See types.ts. */

import {
  addHours,
  areIntervalsOverlapping,
  differenceInMinutes,
  eachDayOfInterval,
  eachHourOfInterval,
  endOfWeek,
  format,
  getHours,
  getMinutes,
  isBefore,
  isSameDay,
  isToday,
  startOfDay,
  startOfWeek,
} from "date-fns";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useMemo } from "react";
import {
  type CalendarEvent,
  DraggableEvent,
  DroppableCell,
  EndHour,
  EventItem,
  isMultiDayEvent,
  StartHour,
  useCurrentTimeIndicator,
  WeekCellsHeight,
} from "@/components/calendar/event-calendar";
import { cn } from "@/lib/utils";

interface WeekViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  onEventSelect: (event: CalendarEvent) => void;
  onEventCreate: (startTime: Date) => void;
}

interface PositionedEvent {
  event: CalendarEvent;
  top: number;
  height: number;
  left: number;
  width: number;
  zIndex: number;
}

export function WeekView({
  currentDate,
  events,
  onEventSelect,
  onEventCreate,
}: WeekViewProps) {
  const days = useMemo(() => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: weekStart, end: weekEnd });
  }, [currentDate]);

  const weekStart = useMemo(
    () => startOfWeek(currentDate, { weekStartsOn: 0 }),
    [currentDate]
  );

  const hours = useMemo(() => {
    const dayStart = startOfDay(currentDate);
    return eachHourOfInterval({
      start: addHours(dayStart, StartHour),
      end: addHours(dayStart, EndHour - 1),
    });
  }, [currentDate]);

  // Get all-day events and multi-day events for the week
  const allDayEvents = useMemo(() => {
    return events
      .filter((event) => event.allDay || isMultiDayEvent(event))
      .filter((event) => {
        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end);
        return days.some(
          (day) =>
            isSameDay(day, eventStart) ||
            isSameDay(day, eventEnd) ||
            (day > eventStart && day < eventEnd)
        );
      });
  }, [events, days]);

  // Process events for each day to calculate positions
  const processedDayEvents = useMemo(() => {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: vendored upstream column-packing layout algorithm, kept faithful
    return days.map((day) => {
      const dayEvents = events.filter((event) => {
        if (event.allDay || isMultiDayEvent(event)) {
          return false;
        }

        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end);

        return (
          isSameDay(day, eventStart) ||
          isSameDay(day, eventEnd) ||
          (eventStart < day && eventEnd > day)
        );
      });

      const sortedEvents = [...dayEvents].sort((a, b) => {
        const aStart = new Date(a.start);
        const bStart = new Date(b.start);
        const aEnd = new Date(a.end);
        const bEnd = new Date(b.end);

        if (aStart < bStart) {
          return -1;
        }
        if (aStart > bStart) {
          return 1;
        }

        const aDuration = differenceInMinutes(aEnd, aStart);
        const bDuration = differenceInMinutes(bEnd, bStart);
        return bDuration - aDuration;
      });

      const positionedEvents: PositionedEvent[] = [];
      const dayStart = startOfDay(day);

      // Track columns for overlapping events
      const columns: { event: CalendarEvent; end: Date }[][] = [];

      for (const event of sortedEvents) {
        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end);

        const adjustedStart = isSameDay(day, eventStart)
          ? eventStart
          : dayStart;
        const adjustedEnd = isSameDay(day, eventEnd)
          ? eventEnd
          : addHours(dayStart, 24);

        const startHour =
          getHours(adjustedStart) + getMinutes(adjustedStart) / 60;
        const endHour = getHours(adjustedEnd) + getMinutes(adjustedEnd) / 60;

        const top = (startHour - StartHour) * WeekCellsHeight;
        const height = (endHour - startHour) * WeekCellsHeight;

        // Find a column for this event
        let columnIndex = 0;
        let placed = false;

        while (!placed) {
          const col = columns[columnIndex] || [];
          if (col.length === 0) {
            columns[columnIndex] = col;
            placed = true;
          } else {
            const overlaps = col.some((c) =>
              areIntervalsOverlapping(
                { start: adjustedStart, end: adjustedEnd },
                {
                  start: new Date(c.event.start),
                  end: new Date(c.event.end),
                }
              )
            );
            if (overlaps) {
              columnIndex++;
            } else {
              placed = true;
            }
          }
        }

        const currentColumn = columns[columnIndex] || [];
        columns[columnIndex] = currentColumn;
        currentColumn.push({ event, end: adjustedEnd });

        const width = columnIndex === 0 ? 1 : 1 - columnIndex * 0.1;
        const left = columnIndex === 0 ? 0 : columnIndex * 0.1;

        positionedEvents.push({
          event,
          top,
          height,
          left,
          width,
          zIndex: 10 + columnIndex,
        });
      }

      return positionedEvents;
    });
  }, [days, events]);

  const handleEventClick = (event: CalendarEvent, e: ReactMouseEvent) => {
    e.stopPropagation();
    onEventSelect(event);
  };

  const showAllDaySection = allDayEvents.length > 0;
  const { currentTimePosition, currentTimeVisible } = useCurrentTimeIndicator(
    currentDate,
    "week"
  );

  return (
    <div className="flex h-full flex-col" data-slot="week-view">
      <div className="sticky top-0 z-30 grid grid-cols-8 border-border/70 border-b bg-background/80 backdrop-blur-md">
        <div className="py-2 text-center text-muted-foreground/70 text-sm">
          <span className="max-[479px]:sr-only">{format(new Date(), "O")}</span>
        </div>
        {days.map((day) => (
          <div
            className="py-2 text-center text-muted-foreground/70 text-sm data-today:font-medium data-today:text-foreground"
            data-today={isToday(day) || undefined}
            key={day.toString()}
          >
            <span aria-hidden="true" className="sm:hidden">
              {format(day, "E")[0]} {format(day, "d")}
            </span>
            <span className="max-sm:hidden">{format(day, "EEE dd")}</span>
          </div>
        ))}
      </div>

      {showAllDaySection && (
        <div className="border-border/70 border-b bg-muted/50">
          <div className="grid grid-cols-8">
            <div className="relative border-border/70 border-r">
              <span className="absolute bottom-0 left-0 h-6 w-16 max-w-full pe-2 text-right text-[10px] text-muted-foreground/70 sm:pe-4 sm:text-xs">
                All day
              </span>
            </div>
            {days.map((day, dayIndex) => {
              const dayAllDayEvents = allDayEvents.filter((event) => {
                const eventStart = new Date(event.start);
                const eventEnd = new Date(event.end);
                return (
                  isSameDay(day, eventStart) ||
                  (day > eventStart && day < eventEnd) ||
                  isSameDay(day, eventEnd)
                );
              });

              return (
                <div
                  className="relative border-border/70 border-r p-1 last:border-r-0"
                  data-today={isToday(day) || undefined}
                  key={day.toString()}
                >
                  {dayAllDayEvents.map((event) => {
                    const eventStart = new Date(event.start);
                    const eventEnd = new Date(event.end);
                    const isFirstDay = isSameDay(day, eventStart);
                    const isLastDay = isSameDay(day, eventEnd);

                    const isFirstVisibleDay =
                      dayIndex === 0 && isBefore(eventStart, weekStart);
                    const shouldShowTitle = isFirstDay || isFirstVisibleDay;

                    return (
                      <EventItem
                        event={event}
                        isFirstDay={isFirstDay}
                        isLastDay={isLastDay}
                        key={`spanning-${event.id}`}
                        onClick={(e) => handleEventClick(event, e)}
                        view="month"
                      >
                        <div
                          aria-hidden={!shouldShowTitle}
                          className={cn(
                            "truncate",
                            !shouldShowTitle && "invisible"
                          )}
                        >
                          {event.title}
                        </div>
                      </EventItem>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid flex-1 grid-cols-8 overflow-hidden">
        <div className="grid auto-cols-fr border-border/70 border-r">
          {hours.map((hour, index) => (
            <div
              className="relative min-h-[var(--week-cells-height)] border-border/70 border-b last:border-b-0"
              key={hour.toString()}
            >
              {index > 0 && (
                <span className="absolute -top-3 left-0 flex h-6 w-16 max-w-full items-center justify-end bg-background pe-2 text-[10px] text-muted-foreground/70 sm:pe-4 sm:text-xs">
                  {format(hour, "h a")}
                </span>
              )}
            </div>
          ))}
        </div>

        {days.map((day, dayIndex) => (
          <div
            className="relative grid auto-cols-fr border-border/70 border-r last:border-r-0"
            data-today={isToday(day) || undefined}
            key={day.toString()}
          >
            {/* Positioned events */}
            {(processedDayEvents[dayIndex] ?? []).map((positionedEvent) => (
              // Positioning wrapper only; the inner EventItem button is the
              // interactive control and stops propagation on click itself
              // (matching upstream day-view, which has no wrapper handler).
              <div
                className="absolute z-10 px-0.5"
                key={positionedEvent.event.id}
                style={{
                  top: `${positionedEvent.top}px`,
                  height: `${positionedEvent.height}px`,
                  left: `${positionedEvent.left * 100}%`,
                  width: `${positionedEvent.width * 100}%`,
                  zIndex: positionedEvent.zIndex,
                }}
              >
                <div className="h-full w-full">
                  <DraggableEvent
                    event={positionedEvent.event}
                    height={positionedEvent.height}
                    onClick={(e) => handleEventClick(positionedEvent.event, e)}
                    showTime
                    view="week"
                  />
                </div>
              </div>
            ))}

            {/* Current time indicator - only show for today's column */}
            {currentTimeVisible && isToday(day) && (
              <div
                className="pointer-events-none absolute right-0 left-0 z-20"
                style={{ top: `${currentTimePosition}%` }}
              >
                <div className="relative flex items-center">
                  <div className="absolute -left-1 h-2 w-2 rounded-full bg-primary" />
                  <div className="h-[2px] w-full bg-primary" />
                </div>
              </div>
            )}
            {hours.map((hour) => {
              const hourValue = getHours(hour);
              return (
                <div
                  className="relative min-h-[var(--week-cells-height)] border-border/70 border-b last:border-b-0"
                  key={hour.toString()}
                >
                  {/* Quarter-hour intervals */}
                  {[0, 1, 2, 3].map((quarter) => {
                    const quarterHourTime = hourValue + quarter * 0.25;
                    return (
                      <DroppableCell
                        className={cn(
                          "absolute h-[calc(var(--week-cells-height)/4)] w-full",
                          quarter === 0 && "top-0",
                          quarter === 1 &&
                            "top-[calc(var(--week-cells-height)/4)]",
                          quarter === 2 &&
                            "top-[calc(var(--week-cells-height)/4*2)]",
                          quarter === 3 &&
                            "top-[calc(var(--week-cells-height)/4*3)]"
                        )}
                        date={day}
                        id={`week-cell-${day.toISOString()}-${quarterHourTime}`}
                        key={`${hour.toString()}-${quarter}`}
                        onClick={() => {
                          const startTime = new Date(day);
                          startTime.setHours(hourValue);
                          startTime.setMinutes(quarter * 15);
                          onEventCreate(startTime);
                        }}
                        time={quarterHourTime}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
