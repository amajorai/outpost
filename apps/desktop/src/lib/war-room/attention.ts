/**
 * War Room attention score + the pure core of role recommendations (U29).
 *
 * The home dashboard's command-center math. Mirrors the pure-core / async-
 * service split the rest of the attention layer uses (`recommender.ts` vs
 * `service.ts`, `engine.ts` vs `deps.ts`, `rank.ts` vs `fetch.ts`): this file
 * imports only domain types + the pure analytics helpers, never `@tauri-apps/*`,
 * no repos, and no ACP client, so it loads under plain `bun` and is covered by
 * `attention.check.ts`. The repo loading + navigation wiring lives in the panel
 * and a thin store.
 *
 * What the data honestly supports (same caveats as `analytics.ts` /
 * `recommender.ts`): there is NO per-post time series and NO follower count,
 * only each post's *current* engagement counts and the day it was published. So
 * the attention score is recent-window engagement measured against the window
 * before it (a momentum read on the content that's performing), not a tracked
 * follower/impression curve. We degrade to a defined, neutral score on thin or
 * absent history rather than implying signal we lack.
 */

import { engagementScore } from "@/lib/analytics/analytics";
import type { ActivityItem } from "@/lib/social-schema";

/** Milliseconds in a day, for windowing the activity feed by publish date. */
const MS_PER_DAY = 86_400_000;

/** The length, in days, of the recent window the attention score reads. */
export const ATTENTION_WINDOW_DAYS = 7;

/** Below this many windowed posts, history is too thin to quote a trend. */
const MIN_TREND_SAMPLE = 2;

/** The neutral score returned when there's no usable history at all. */
export const NEUTRAL_ATTENTION_SCORE = 50;

/** The score is clamped to this inclusive range so the gauge stays bounded. */
const MIN_SCORE = 0;
const MAX_SCORE = 100;

/** A full window of equal engagement maps to the neutral midpoint. */
const SCORE_MIDPOINT = 50;

/**
 * How strongly a window-over-window engagement delta moves the score off the
 * midpoint. A doubling (ratio 1.0 of the prior window) pushes the score by this
 * many points; tuned so a healthy upswing lands in the 70s, not pinned at 100.
 */
const TREND_SENSITIVITY = 40;

/** How the most recent window compares to the one before it. */
export type AttentionTrend = "up" | "down" | "flat" | "new";

/** The computed attention score + the context the dashboard renders around it. */
export interface AttentionScore {
  /** Composite 0-100 momentum score. {@link NEUTRAL_ATTENTION_SCORE} when new. */
  score: number;
  /** Direction of the recent window vs the prior window. */
  trend: AttentionTrend;
  /** Total engagement in the most recent {@link ATTENTION_WINDOW_DAYS} days. */
  recentEngagement: number;
  /** Total engagement in the window immediately before the recent one. */
  priorEngagement: number;
  /** Number of posts published in the recent window. */
  recentPosts: number;
  /**
   * Signed percentage change recent vs prior, rounded to a whole number. Null
   * when there isn't enough prior history to quote a trustworthy figure.
   */
  changePct: number | null;
}

/** Sum the engagement of posts whose publish date falls within `[from, to)`. */
function windowEngagement(
  items: ActivityItem[],
  from: number,
  to: number
): { engagement: number; posts: number } {
  let engagement = 0;
  let posts = 0;
  for (const item of items) {
    if (item.publishedAt == null) {
      continue;
    }
    if (item.publishedAt >= from && item.publishedAt < to) {
      engagement += engagementScore(item);
      posts += 1;
    }
  }
  return { engagement, posts };
}

/** Clamp a raw score into the bounded gauge range and round to a whole number. */
function clampScore(value: number): number {
  return Math.round(Math.min(MAX_SCORE, Math.max(MIN_SCORE, value)));
}

/**
 * Compute the attention score from the activity feed at a given clock time.
 *
 * The clock is a parameter (not `Date.now()`) so the check is deterministic,
 * mirroring the injectable-clock convention in `engine.ts`. Two adjacent
 * windows of {@link ATTENTION_WINDOW_DAYS} are compared: the score is the
 * midpoint shifted by the window-over-window engagement ratio. Guards:
 * - No prior engagement but some recent -> momentum is "new", score is the
 *   midpoint (we can't quote a real trend from a single window).
 * - No posts at all -> {@link NEUTRAL_ATTENTION_SCORE}, trend "new".
 * - Division by a zero prior window is never reached (guarded above), echoing
 *   `metricValue`'s `views <= 0 -> 0`.
 */
export function computeAttentionScore(
  items: ActivityItem[],
  now: number = Date.now()
): AttentionScore {
  const recentFrom = now - ATTENTION_WINDOW_DAYS * MS_PER_DAY;
  const priorFrom = now - 2 * ATTENTION_WINDOW_DAYS * MS_PER_DAY;

  const recent = windowEngagement(items, recentFrom, now);
  const prior = windowEngagement(items, priorFrom, recentFrom);

  const base: Omit<AttentionScore, "score" | "trend" | "changePct"> = {
    recentEngagement: recent.engagement,
    priorEngagement: prior.engagement,
    recentPosts: recent.posts,
  };

  // Nothing published recently: nothing to score.
  if (recent.posts === 0 && prior.posts === 0) {
    return {
      ...base,
      score: NEUTRAL_ATTENTION_SCORE,
      trend: "new",
      changePct: null,
    };
  }

  // Too little prior history to compare against: report a neutral, "new" read.
  if (prior.engagement === 0 || recent.posts + prior.posts < MIN_TREND_SAMPLE) {
    return {
      ...base,
      score: SCORE_MIDPOINT,
      trend: "new",
      changePct: null,
    };
  }

  const ratio = recent.engagement / prior.engagement;
  const score = clampScore(SCORE_MIDPOINT + (ratio - 1) * TREND_SENSITIVITY);
  const changePct = Math.round((ratio - 1) * 100);

  let trend: AttentionTrend = "flat";
  if (changePct > 0) {
    trend = "up";
  } else if (changePct < 0) {
    trend = "down";
  }

  return { ...base, score, trend, changePct };
}
