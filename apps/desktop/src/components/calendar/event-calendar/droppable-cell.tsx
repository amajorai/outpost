/** Vendored from origin-space/event-calendar (MIT). See types.ts. */

import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { useCalendarDnd } from "@/components/calendar/event-calendar";
import { cn } from "@/lib/utils";

interface DroppableCellProps {
  id: string;
  date: Date;
  time?: number; // For week/day views, represents hours (e.g., 9.25 for 9:15)
  children?: ReactNode;
  className?: string;
  onClick?: () => void;
}

export function DroppableCell({
  id,
  date,
  time,
  children,
  className,
  onClick,
}: DroppableCellProps) {
  const { activeEvent } = useCalendarDnd();

  const { setNodeRef, isOver } = useDroppable({
    id,
    data: {
      date,
      time,
    },
  });

  const formattedTime =
    time === undefined
      ? null
      : `${Math.floor(time)}:${Math.round((time - Math.floor(time)) * 60)
          .toString()
          .padStart(2, "0")}`;

  // NOTE(alpha): the droppable cell is a clickable <div>, not a button, so it is
  // not keyboard-focusable. Empty-slot creation is mouse-only upstream; tracked
  // as an a11y followUp.
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: alpha upstream; keyboard slot-create is a tracked a11y followUp
    // biome-ignore lint/a11y/noStaticElementInteractions: ditto — vendored dnd drop target is a div by design
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: ditto — vendored dnd drop target is a div by design
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden px-0.5 py-1 data-dragging:bg-accent sm:px-1",
        className
      )}
      data-dragging={isOver && activeEvent ? true : undefined}
      onClick={onClick}
      ref={setNodeRef}
      title={formattedTime ? `${formattedTime}` : undefined}
    >
      {children}
    </div>
  );
}
