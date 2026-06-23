/**
 * Experiments engine (U25) — the attention layer's core.
 *
 * An experiment runs N content/timing variants for a single goal metric. Each
 * variant publishes through the existing scheduled_posts/post_targets publish
 * pipeline; after the observation window the engine collects each variant's
 * engagement and computes + persists a winner.
 *
 * Design (mirrors the publish pipeline, U10): the orchestration is a pure
 * function over an injectable `deps` bag, and the winner selection is a pure
 * function over per-variant metrics. Production wiring lives in
 * `lib/experiments/deps.ts` (the only file that imports the DB repos + provider
 * registry); the bun-runnable check (`engine.check.ts`) injects in-memory deps +
 * a `FakePlatformProvider`. This file intentionally imports nothing from
 * `@tauri-apps/*` (and no repos, which transitively pull in `getDb`) so it loads
 * under plain bun.
 */

import type {
  ExperimentGoalMetric,
  ExperimentVariant,
} from "@/lib/social-schema";

/**
 * The raw engagement counts the engine needs to score a variant. A subset of
 * `EngagementCounts` / `ActivityItem` — only the fields a goal metric reads.
 */
export interface VariantEngagement {
  likes: number;
  comments: number;
  /** Shares contribute to `engagement_rate` but aren't a goal metric of their own. */
  shares: number;
  views: number;
}

/**
 * Compute a variant's goal-metric value from its engagement counts.
 *
 * `likes`/`comments`/`views` read the same-named field directly.
 * `engagement_rate` is the derived ratio `(likes + comments + shares) / views`,
 * guarded to `0` when `views` is `0` so a post with no views (the fake can
 * produce `views = 0`) never divides by zero.
 */
export function metricValue(
  goalMetric: ExperimentGoalMetric,
  engagement: VariantEngagement
): number {
  switch (goalMetric) {
    case "likes":
      return engagement.likes;
    case "comments":
      return engagement.comments;
    case "views":
      return engagement.views;
    case "engagement_rate": {
      if (engagement.views <= 0) {
        return 0;
      }
      return (
        (engagement.likes + engagement.comments + engagement.shares) /
        engagement.views
      );
    }
    default:
      return 0;
  }
}

/** A variant paired with its measured goal-metric value. */
export interface ScoredVariant {
  variantId: string;
  metricValue: number;
}

/**
 * Pick the winning variant: the highest `metricValue`. Ties break toward the
 * earliest variant in the input order, so the result is deterministic and
 * reproducible (every `engagement_rate` can legitimately be `0`, in which case
 * the first variant wins). Returns null for an empty input.
 */
export function computeWinner(scored: ScoredVariant[]): ScoredVariant | null {
  let winner: ScoredVariant | null = null;
  for (const candidate of scored) {
    if (winner === null || candidate.metricValue > winner.metricValue) {
      winner = candidate;
    }
  }
  return winner;
}

/**
 * Everything the engine needs from the outside world, injectable so the
 * integration check can swap in-memory fakes for the real DB-backed wiring.
 * Production callers use `defaultExperimentDeps()` from `deps.ts`.
 */
export interface ExperimentDeps {
  /**
   * Publish a single variant via the existing publish pipeline (creates a
   * scheduled post + target, publishes it, returns the scheduled post id so the
   * engine can record it on the variant). `scheduledFor` defaults to "now".
   */
  publishVariant: (variant: ExperimentVariant) => Promise<string>;
  /** Persist the scheduled-post id created for a variant. */
  setVariantScheduledPost: (
    variantId: string,
    scheduledPostId: string
  ) => Promise<void>;
  /** Advance the experiment's lifecycle status. */
  setExperimentStatus: (
    experimentId: string,
    status: "draft" | "running" | "complete"
  ) => Promise<void>;
  /**
   * Read a variant's current engagement after the observation window. Returns
   * null when the variant has nothing measurable yet (e.g. never published), so
   * it scores 0 rather than aborting the whole experiment.
   */
  readVariantEngagement: (
    variant: ExperimentVariant
  ) => Promise<VariantEngagement | null>;
  /** Persist one result row per variant, flagging the winner. */
  recordResults: (input: {
    experimentId: string;
    results: {
      variantId: string;
      metricValue: number;
      isWinner: boolean;
    }[];
    measuredAt: number;
  }) => Promise<void>;
  /** Clock, injectable so the check is deterministic. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Start an experiment: publish every variant through the pipeline and flip the
 * experiment to `running`. Records the scheduled-post id back onto each variant.
 * Returns the variants with their `scheduledPostId` populated.
 */
export async function startExperiment(
  experimentId: string,
  variants: ExperimentVariant[],
  deps: ExperimentDeps
): Promise<ExperimentVariant[]> {
  const published: ExperimentVariant[] = [];
  for (const variant of variants) {
    const scheduledPostId = await deps.publishVariant(variant);
    await deps.setVariantScheduledPost(variant.id, scheduledPostId);
    published.push({ ...variant, scheduledPostId });
  }
  await deps.setExperimentStatus(experimentId, "running");
  return published;
}

/** The outcome of evaluating an experiment. */
export interface EvaluationOutcome {
  experimentId: string;
  scored: ScoredVariant[];
  winnerVariantId: string | null;
}

/**
 * Evaluate a running experiment: read each variant's engagement, score it for
 * the goal metric, compute the winner, persist one result row per variant, and
 * flip the experiment to `complete`. Never throws on a single variant's missing
 * engagement — it scores 0 and the rest proceed.
 */
export async function evaluateExperiment(
  experimentId: string,
  goalMetric: ExperimentGoalMetric,
  variants: ExperimentVariant[],
  deps: ExperimentDeps
): Promise<EvaluationOutcome> {
  const measuredAt = (deps.now ?? Date.now)();
  const scored: ScoredVariant[] = [];
  for (const variant of variants) {
    const engagement = await deps.readVariantEngagement(variant);
    const value = engagement ? metricValue(goalMetric, engagement) : 0;
    scored.push({ variantId: variant.id, metricValue: value });
  }

  const winner = computeWinner(scored);

  await deps.recordResults({
    experimentId,
    measuredAt,
    results: scored.map((entry) => ({
      variantId: entry.variantId,
      metricValue: entry.metricValue,
      isWinner: winner !== null && entry.variantId === winner.variantId,
    })),
  });

  await deps.setExperimentStatus(experimentId, "complete");

  return {
    experimentId,
    scored,
    winnerVariantId: winner?.variantId ?? null,
  };
}
