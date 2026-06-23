/**
 * Inline performance predictor for the composer (U24).
 *
 * Shows a predicted-performance score (0-100) plus a short rationale for the
 * current draft, one card per selected target platform. The score is the
 * synchronous heuristic in `lib/predictor/score.ts` blended with the user's
 * historical activity, so it recomputes live as the draft text, media, targets,
 * or schedule time change — there is no fetch on the recompute path.
 *
 * An optional "Refine with AI" action asks the configured text-gen agent to
 * assess hook strength; when it resolves it warms an in-memory cache and the
 * live score picks it up on the next recompute. The agent never sits on the
 * keystroke path, mirroring the hashtags research panel.
 */

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Progress } from "@repo/ui/progress";
import { Gauge, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MediaAttachment } from "@/lib/compose/platform-limits";
import {
  assessHookStrength,
  getCachedHookFraction,
} from "@/lib/predictor/hook-agent";
import {
  loadPlatformHistory,
  predictForPlatforms,
} from "@/lib/predictor/service";
import type {
  PerformancePrediction,
  PlatformHistory,
} from "@/lib/predictor/types";
import { useAppSettingsStore } from "@/stores/use-app-settings-store";
import { platformLabel } from "./platform-meta";

/** Tailwind text color for a score band. */
function scoreTone(score: number): string {
  if (score >= 70) {
    return "text-emerald-600 dark:text-emerald-400";
  }
  if (score >= 45) {
    return "text-amber-600 dark:text-amber-400";
  }
  return "text-destructive";
}

export function PerformancePredictor({
  text,
  media,
  platforms,
  scheduledFor,
}: {
  /** The draft's primary (first-segment) text. */
  text: string;
  /** The draft's primary media attachments. */
  media: readonly MediaAttachment[];
  /** Distinct platforms of the selected target accounts. */
  platforms: string[];
  /** Planned publish time (epoch millis), or null when not set. */
  scheduledFor: number | null;
}) {
  const [history, setHistory] = useState<Map<string, PlatformHistory>>(
    () => new Map()
  );
  const [isRefining, setIsRefining] = useState(false);
  /**
   * The AI-assessed hook fraction (0..1) and the exact text it was assessed for.
   * Held in state so a completed refine flows into the live score; ignored once
   * the draft text moves on from `forText`, so a stale assessment never applies.
   */
  const [assessed, setAssessed] = useState<{
    forText: string;
    fraction: number;
  } | null>(null);

  const hasAgent = useAppSettingsStore((s) => s.acpTextGenAgentId !== null);

  // Load history once on mount. It's a cheap, refetchable snapshot; on any read
  // error we keep the empty map and the scorer falls back to heuristics.
  useEffect(() => {
    let active = true;
    loadPlatformHistory()
      .then((learned) => {
        if (active) {
          setHistory(learned);
        }
      })
      .catch(() => {
        // Keep the empty map: predictions degrade to heuristics-only.
      });
    return () => {
      active = false;
    };
  }, []);

  const trimmed = text.trim();

  // Apply the AI assessment only while the draft still matches the text it was
  // run against; fall back to the in-memory cache (e.g. after a remount) for the
  // same text. Both reads are synchronous — never a fetch on this path.
  const hookOverride =
    assessed && assessed.forText === text
      ? assessed.fraction
      : (getCachedHookFraction(text) ?? null);

  const predictions = useMemo<PerformancePrediction[]>(() => {
    if (trimmed.length === 0 || platforms.length === 0) {
      return [];
    }
    return predictForPlatforms({
      text,
      media,
      platforms,
      history,
      scheduledFor,
      hookOverride,
    });
  }, [text, trimmed, media, platforms, history, scheduledFor, hookOverride]);

  const handleRefine = useCallback(async () => {
    if (trimmed.length === 0) {
      return;
    }
    setIsRefining(true);
    try {
      const fraction = await assessHookStrength(text);
      if (fraction !== null) {
        setAssessed({ forText: text, fraction });
      }
    } finally {
      setIsRefining(false);
    }
  }, [text, trimmed]);

  if (platforms.length === 0) {
    return (
      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
        <span className="flex items-center gap-2 font-medium text-sm">
          <Gauge className="size-4 text-muted-foreground" />
          Predicted performance
        </span>
        <p className="text-muted-foreground text-sm">
          Select a target account to score this post for its platform.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium text-sm">
          <Gauge className="size-4 text-muted-foreground" />
          Predicted performance
        </span>
        {hasAgent && trimmed.length > 0 && (
          <Button
            disabled={isRefining}
            onClick={handleRefine}
            size="sm"
            type="button"
            variant="outline"
          >
            {isRefining ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Refine with AI
          </Button>
        )}
      </div>

      {trimmed.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Write a draft to see its predicted performance.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {predictions.map((prediction) => (
            <PredictionCard key={prediction.platform} prediction={prediction} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PredictionCard({ prediction }: { prediction: PerformancePrediction }) {
  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm">
          {platformLabel(prediction.platform)}
        </span>
        <span className="flex items-center gap-2">
          <span
            className={`font-semibold text-lg ${scoreTone(prediction.score)}`}
          >
            {prediction.score}
          </span>
          <span className="text-muted-foreground text-xs">/ 100</span>
        </span>
      </div>

      <Progress value={prediction.score} />

      <p className="text-muted-foreground text-sm">{prediction.rationale}</p>

      <ul className="flex flex-wrap gap-1.5">
        {prediction.factors.map((factor) => (
          <li key={factor.key}>
            <Badge
              className="font-normal"
              title={factor.detail}
              variant="secondary"
            >
              {factor.label}: {factor.points}/{factor.maxPoints}
            </Badge>
          </li>
        ))}
      </ul>

      <span className="text-muted-foreground text-xs">
        {prediction.basis === "history"
          ? "Tuned to your past performance on this platform."
          : "General heuristics (not enough history on this platform yet)."}
      </span>
    </li>
  );
}
