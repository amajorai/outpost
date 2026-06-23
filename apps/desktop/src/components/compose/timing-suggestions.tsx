/**
 * Inline optimal-timing suggestions for the composer (U26).
 *
 * Under the schedule field, shows the best times to post for the selected
 * target platforms — "post at X for +Y%" — computed from the user's activity
 * feed (see `lib/timing/recommender.ts`). Clicking a slot fills the schedule
 * field with that slot's next occurrence, so a recommendation is one click from
 * being acted on.
 *
 * History loads once on mount; the slot ranking is pure and synchronous so
 * there's no fetch when targets change. With little history the recommender
 * returns built-in default windows flagged as such, so the panel always has
 * actionable suggestions without implying learned signal it lacks.
 */

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Clock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  computeTimingSlots,
  formatSlot,
  nextOccurrence,
  type RecommendedSlot,
  type TimingRecommendation,
} from "@/lib/timing/recommender";
import { loadPlatformTiming } from "@/lib/timing/service";
import { platformLabel } from "./platform-meta";

/** A flat suggestion the panel renders: a platform's top slot. */
interface PlatformSuggestion {
  platform: string;
  recommendation: TimingRecommendation;
  topSlot: RecommendedSlot;
}

export function TimingSuggestions({
  platforms,
  onApply,
}: {
  /** Distinct platforms of the selected target accounts. */
  platforms: string[];
  /** Called with the next-occurrence epoch millis when a slot is applied. */
  onApply: (epochMillis: number) => void;
}) {
  const [byPlatform, setByPlatform] = useState<
    Map<string, TimingRecommendation>
  >(() => new Map());

  // Load once on mount. On any read error we keep the empty map and each
  // platform falls back to built-in default slots.
  useEffect(() => {
    let active = true;
    loadPlatformTiming()
      .then((learned) => {
        if (active) {
          setByPlatform(learned);
        }
      })
      .catch(() => {
        // Keep the empty map: every platform degrades to default slots.
      });
    return () => {
      active = false;
    };
  }, []);

  // One suggestion per selected platform, using its top-ranked slot. A platform
  // missing from the map gets computed defaults so it still shows a suggestion.
  const suggestions = useMemo<PlatformSuggestion[]>(() => {
    const result: PlatformSuggestion[] = [];
    for (const platform of platforms) {
      const recommendation =
        byPlatform.get(platform) ?? computeTimingSlots(platform, []);
      const topSlot = recommendation.slots[0];
      if (topSlot) {
        result.push({ platform, recommendation, topSlot });
      }
    }
    return result;
  }, [platforms, byPlatform]);

  if (platforms.length === 0 || suggestions.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <span className="flex items-center gap-2 font-medium text-sm">
        <Clock className="size-4 text-muted-foreground" />
        Best time to post
      </span>
      <ul className="flex flex-col gap-3">
        {suggestions.map((suggestion) => (
          <SuggestionRow
            key={suggestion.platform}
            onApply={onApply}
            suggestion={suggestion}
          />
        ))}
      </ul>
    </section>
  );
}

function SuggestionRow({
  suggestion,
  onApply,
}: {
  suggestion: PlatformSuggestion;
  onApply: (epochMillis: number) => void;
}) {
  const { platform, recommendation, topSlot } = suggestion;
  const lift = topSlot.liftPct;
  const showLift =
    recommendation.basis === "history" && lift !== null && lift > 0;

  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-sm">{platformLabel(platform)}</span>
        <span className="text-muted-foreground text-xs">
          {recommendation.basis === "history"
            ? "Tuned to your past performance."
            : "Suggested window (not enough history yet)."}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {showLift && (
          <Badge className="font-normal" variant="secondary">
            +{lift}%
          </Badge>
        )}
        <Button
          onClick={() => onApply(nextOccurrence(topSlot).getTime())}
          size="sm"
          type="button"
          variant="outline"
        >
          {formatSlot(topSlot)}
        </Button>
      </div>
    </li>
  );
}
