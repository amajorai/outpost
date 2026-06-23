/**
 * Performance predictor service (U24).
 *
 * The orchestration the composer calls. Two responsibilities, kept separate so
 * the live score path stays synchronous:
 *
 *   1. `loadPlatformHistory()` — async, run once (and on refresh): reads the
 *      activity feed and distils per-platform patterns. The composer caches the
 *      returned map in state and hands it to the scorer.
 *   2. `predictForPlatforms()` — pure and synchronous: scores the current draft
 *      against each selected platform using the already-loaded history and an
 *      optional cached agent hook assessment. Safe to call on every edit.
 */

import type { MediaAttachment } from "@/lib/compose/platform-limits";
import { listActivityItems } from "@/lib/repos/activity-items";
import { learnPlatformHistory } from "./history";
import { getCachedHookFraction } from "./hook-agent";
import { scoreForPlatform } from "./score";
import type { PerformancePrediction, PlatformHistory } from "./types";

/**
 * Load and distil the user's per-platform history from the activity feed.
 * Returns an empty map (not an error) when there's nothing tracked yet, so the
 * scorer falls back to heuristics. Never throws.
 */
export async function loadPlatformHistory(): Promise<
  Map<string, PlatformHistory>
> {
  const items = await listActivityItems();
  return learnPlatformHistory(items);
}

/** Everything needed to score the current draft across its targets. */
export interface PredictInput {
  /** The draft's primary text (first segment). */
  text: string;
  /** The draft's primary media. */
  media: readonly MediaAttachment[];
  /** Distinct platforms of the selected target accounts. */
  platforms: string[];
  /** Learned per-platform history, as loaded by {@link loadPlatformHistory}. */
  history: Map<string, PlatformHistory>;
  /** Planned publish time (epoch millis), or null when not set. */
  scheduledFor: number | null;
  /**
   * An AI-assessed hook fraction (0..1) to override the heuristic, when the
   * caller has one. Omit to read the in-memory agent cache for this text; both
   * paths are synchronous and never fetch.
   */
  hookOverride?: number | null;
}

/**
 * Score the draft for each selected platform. Pure and synchronous: it reads
 * the agent hook assessment only from the in-memory cache (never fetches), so a
 * recompute on keystroke does no I/O. One {@link PerformancePrediction} per
 * platform, in the order given.
 */
export function predictForPlatforms(
  input: PredictInput
): PerformancePrediction[] {
  const hookOverride =
    input.hookOverride ?? getCachedHookFraction(input.text) ?? null;
  return input.platforms.map((platform) =>
    scoreForPlatform({
      platform,
      text: input.text,
      media: input.media,
      history: input.history.get(platform),
      scheduledFor: input.scheduledFor,
      hookOverride,
    })
  );
}
