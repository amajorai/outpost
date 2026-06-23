/**
 * Optimal-timing recommender service (U26).
 *
 * The thin async orchestration the composer and calendar call, mirroring
 * `predictor/service.ts`: read the activity feed once and distil per-platform
 * (or per-account) timing recommendations. The compute itself is pure (see
 * `recommender.ts`), so callers cache the returned map and read it
 * synchronously. Never throws — an empty feed yields per-key defaults the same
 * way the predictor degrades to heuristics.
 */

import { listActivityItems } from "@/lib/repos/activity-items";
import {
  recommendationsByAccount,
  recommendationsByPlatform,
  type TimingRecommendation,
} from "./recommender";

/**
 * Load and distil per-platform timing recommendations from the activity feed.
 * Returns an empty map (not an error) when nothing is tracked yet; callers then
 * fall back to per-platform defaults via {@link computeTimingSlots}.
 */
export async function loadPlatformTiming(): Promise<
  Map<string, TimingRecommendation>
> {
  const items = await listActivityItems();
  return recommendationsByPlatform(items);
}

/**
 * Load and distil per-account timing recommendations from the activity feed.
 * Offered for account-level surfaces; per-account history is sparser, so more
 * accounts fall back to defaults.
 */
export async function loadAccountTiming(): Promise<
  Map<string, TimingRecommendation>
> {
  const items = await listActivityItems();
  return recommendationsByAccount(items);
}
