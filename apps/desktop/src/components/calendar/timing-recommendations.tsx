/**
 * Recommended posting slots strip for the Calendar (U26).
 *
 * Renders above the calendar grid: per platform, the best times to post with
 * their estimated lift, computed from the activity feed (see
 * `lib/timing/recommender.ts`). Clicking a slot prefills the composer's
 * schedule field with that slot's next occurrence and switches to Compose —
 * reusing the exact path the calendar's empty-slot click already uses, rather
 * than mutating the vendored calendar grid.
 *
 * History loads once on mount; with little history each platform shows built-in
 * default windows flagged as such, so the strip is always actionable.
 */

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { platformLabel } from "@/components/compose/platform-meta";
import {
  formatSlot,
  nextOccurrence,
  type RecommendedSlot,
  type TimingRecommendation,
} from "@/lib/timing/recommender";
import { loadPlatformTiming } from "@/lib/timing/service";

export function TimingRecommendations({
  onPickSlot,
}: {
  /** Called with the slot's next-occurrence epoch millis when one is clicked. */
  onPickSlot: (epochMillis: number) => void;
}) {
  const [byPlatform, setByPlatform] = useState<
    Map<string, TimingRecommendation>
  >(() => new Map());

  useEffect(() => {
    let active = true;
    loadPlatformTiming()
      .then((learned) => {
        if (active) {
          setByPlatform(learned);
        }
      })
      .catch(() => {
        // Keep the empty map: nothing to recommend until there's history.
      });
    return () => {
      active = false;
    };
  }, []);

  // Only platforms with tracked history appear here (the map is keyed by
  // platforms present in the feed). With no history the strip is hidden — the
  // composer is where a brand-new user gets default windows.
  const entries = [...byPlatform.entries()].filter(
    ([, rec]) => rec.slots.length > 0 && rec.basis === "history"
  );

  if (entries.length === 0) {
    return null;
  }

  return (
    <section className="mb-3 flex flex-col gap-2 rounded-xl border bg-card px-4 py-3">
      <span className="flex items-center gap-2 font-medium text-sm">
        <Clock className="size-4 text-muted-foreground" />
        Recommended posting times
      </span>
      <ul className="flex flex-col gap-2">
        {entries.map(([platform, rec]) => (
          <PlatformRow
            key={platform}
            onPickSlot={onPickSlot}
            platform={platform}
            recommendation={rec}
          />
        ))}
      </ul>
    </section>
  );
}

function PlatformRow({
  platform,
  recommendation,
  onPickSlot,
}: {
  platform: string;
  recommendation: TimingRecommendation;
  onPickSlot: (epochMillis: number) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="min-w-24 font-medium text-sm">
        {platformLabel(platform)}
      </span>
      <ul className="flex flex-wrap gap-2">
        {recommendation.slots.map((slot) => (
          <li key={`${slot.dayKind}-${slot.dayOfWeek}-${slot.hour}`}>
            <SlotButton onPickSlot={onPickSlot} slot={slot} />
          </li>
        ))}
      </ul>
    </li>
  );
}

function SlotButton({
  slot,
  onPickSlot,
}: {
  slot: RecommendedSlot;
  onPickSlot: (epochMillis: number) => void;
}) {
  const showLift = slot.liftPct !== null && slot.liftPct > 0;
  return (
    <Button
      className="gap-1.5"
      onClick={() => onPickSlot(nextOccurrence(slot).getTime())}
      size="sm"
      type="button"
      variant="outline"
    >
      {formatSlot(slot)}
      {showLift && (
        <Badge className="font-normal" variant="secondary">
          +{slot.liftPct}%
        </Badge>
      )}
    </Button>
  );
}
