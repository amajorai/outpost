/**
 * Learn per-platform performance patterns from the activity feed (U24).
 *
 * Pure functions over the same `ActivityItem[]` the Activity feed and analytics
 * already use (one latest-snapshot row per published post). We distil each
 * platform's history into a small {@link PlatformHistory} the live scorer can
 * read synchronously on every keystroke without re-scanning the whole feed.
 *
 * What the data honestly supports (mirroring the caveats in `analytics.ts`):
 * - We rank posts by `engagementScore` (likes + comments + shares; views
 *   excluded as an impression count, not an interaction).
 * - "Best hours" are the local hours-of-day of the top posts, not a learned
 *   time-series — there is no per-post history.
 * - With too few posts the bands aren't trustworthy, so we expose `sampleSize`
 *   and a null `bestLength`, and the scorer falls back to generic heuristics
 *   rather than implying learned signal.
 */

import { engagementScore } from "@/lib/analytics/analytics";
import type { ActivityItem } from "@/lib/social-schema";
import type { PlatformHistory } from "./types";

/**
 * Below this many posts on a platform, history is too sparse to learn timing /
 * length bands from. The scorer treats such platforms as heuristics-only.
 */
export const MIN_HISTORY_SAMPLE = 3;

/** How many top posts feed the "best hours" set. */
const TOP_FOR_HOURS = 5;

/** How many top posts average into the soft target length band. */
const TOP_FOR_LENGTH = 5;

/** Hashtags are considered helpful when this share of top posts used them. */
const HASHTAG_HELP_THRESHOLD = 0.5;
const TOP_FOR_HASHTAGS = 5;

/** Top-level literal: matches a `#hashtag` token (per lint/performance). */
const HASHTAG_RE = /(^|\s)#[a-z0-9_]+/i;

/** Whether a post's text uses at least one hashtag. */
function usesHashtag(text: string | null): boolean {
  return text !== null && HASHTAG_RE.test(text);
}

/**
 * Derive a {@link PlatformHistory} for every platform present in `items`.
 *
 * Returned as a map keyed by platform so the scorer does a single lookup.
 * Platforms with no items simply don't appear; the scorer handles a missing
 * entry as "no history" and scores on heuristics alone.
 */
export function learnPlatformHistory(
  items: ActivityItem[]
): Map<string, PlatformHistory> {
  const byPlatform = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const list = byPlatform.get(item.platform) ?? [];
    list.push(item);
    byPlatform.set(item.platform, list);
  }

  const result = new Map<string, PlatformHistory>();
  for (const [platform, posts] of byPlatform) {
    const ranked = [...posts].sort(
      (a, b) => engagementScore(b) - engagementScore(a)
    );
    const sampleSize = ranked.length;
    const sparse = sampleSize < MIN_HISTORY_SAMPLE;

    const bestHours: number[] = [];
    for (const post of ranked.slice(0, TOP_FOR_HOURS)) {
      if (post.publishedAt !== null && engagementScore(post) > 0) {
        const hour = new Date(post.publishedAt).getHours();
        if (!bestHours.includes(hour)) {
          bestHours.push(hour);
        }
      }
    }

    const topByEngagement = ranked.slice(0, TOP_FOR_HASHTAGS);
    const withHashtags = topByEngagement.filter((post) =>
      usesHashtag(post.text)
    ).length;
    const hashtagsHelp =
      topByEngagement.length > 0 &&
      withHashtags / topByEngagement.length >= HASHTAG_HELP_THRESHOLD;

    // Average the lengths of the top-engagement posts that have text, so the
    // band is a stable center rather than one noisy post's exact length. Null
    // when history is too sparse to trust, so the scorer uses the platform
    // budget heuristic instead.
    const topWithText = ranked
      .filter((post) => post.text != null && engagementScore(post) > 0)
      .slice(0, TOP_FOR_LENGTH);
    const bestLength =
      sparse || topWithText.length === 0
        ? null
        : Math.round(
            topWithText.reduce(
              (sum, post) => sum + (post.text?.length ?? 0),
              0
            ) / topWithText.length
          );

    result.set(platform, {
      platform,
      sampleSize,
      bestHours,
      bestLength,
      hashtagsHelp,
    });
  }
  return result;
}
