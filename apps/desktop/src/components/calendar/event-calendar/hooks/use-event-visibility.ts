/** Vendored from origin-space/event-calendar (MIT). See ../types.ts. */

import type { RefObject } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

interface EventVisibilityOptions {
  eventHeight: number;
  eventGap: number;
}

interface EventVisibilityResult {
  contentRef: RefObject<HTMLDivElement | null>;
  contentHeight: number | null;
  getVisibleEventCount: (totalEvents: number) => number;
}

/**
 * Hook for calculating event visibility based on container height
 * Uses ResizeObserver for efficient updates
 */
export function useEventVisibility({
  eventHeight,
  eventGap,
}: EventVisibilityOptions): EventVisibilityResult {
  const contentRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  // Use layout effect for synchronous measurement before paint
  useLayoutEffect(() => {
    if (!contentRef.current) {
      return;
    }

    // Function to update the content height
    const updateHeight = () => {
      if (contentRef.current) {
        setContentHeight(contentRef.current.clientHeight);
      }
    };

    // Initial measurement (synchronous)
    updateHeight();

    // Create observer only once and reuse it
    if (!observerRef.current) {
      observerRef.current = new ResizeObserver(() => {
        updateHeight();
      });
    }

    // Start observing the content container
    observerRef.current.observe(contentRef.current);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  // Function to calculate visible events for a cell
  const getVisibleEventCount = useMemo(() => {
    return (totalEvents: number): number => {
      if (!contentHeight) {
        return totalEvents;
      }

      // Calculate how many events can fit in the container
      const maxEvents = Math.floor(contentHeight / (eventHeight + eventGap));

      // If all events fit, show them all
      if (totalEvents <= maxEvents) {
        return totalEvents;
      }
      // Otherwise, reserve space for "more" button by showing one less
      return maxEvents > 0 ? maxEvents - 1 : 0;
    };
  }, [contentHeight, eventHeight, eventGap]);

  return {
    contentRef,
    contentHeight,
    getVisibleEventCount,
  };
}
