/**
 * Cross-platform analytics compute (U23).
 *
 * Pure functions over the activity feed's `ActivityItem[]` — the same
 * latest-snapshot rows the Activity feed renders (one row per published post,
 * keyed on its remote id, carrying its most recently read engagement counts).
 * Nothing here touches the DB or a provider, mirroring `buildActivityUpserts`:
 * the store hands these functions the rows it already loaded, and a check can
 * drive them with synthetic items and assert the aggregates.
 *
 * What the data can and can't support:
 * - There is NO historical series of any post's counts (the feed upserts the
 *   latest snapshot in place) and NO follower count anywhere in the schema. So
 *   "growth over time" can only honestly mean engagement summed by the date a
 *   post was *published*, not a day-by-day tracked curve. We label it as such.
 * - "Best-performing content" ranks posts by a single engagement score so the
 *   ordering is stable regardless of which metric a platform happens to report.
 */

import type { ActivityItem } from "@/lib/social-schema";

/**
 * A post's total engagement: the sum of every interaction metric. Views are
 * deliberately excluded — they're an impression count, not an interaction, and
 * including them would let a high-reach low-interaction post outrank genuinely
 * engaging content. Used for ranking and for the per-platform KPI roll-up.
 */
export function engagementScore(item: ActivityItem): number {
  return item.likes + item.comments + item.shares;
}

/** Aggregate KPIs for a single platform. */
export interface PlatformKpis {
  platform: string;
  /** Number of tracked published posts on this platform. */
  posts: number;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  /** Sum of likes + comments + shares across the platform's posts. */
  engagement: number;
  /** Mean engagement per post, rounded to one decimal. 0 when no posts. */
  avgEngagementPerPost: number;
}

const ROUND_ONE_DECIMAL = 10;

function roundOneDecimal(value: number): number {
  return Math.round(value * ROUND_ONE_DECIMAL) / ROUND_ONE_DECIMAL;
}

/**
 * Per-platform KPI roll-up, one entry per platform present in the items,
 * ordered by total engagement descending (the most active platform first).
 */
export function platformKpis(items: ActivityItem[]): PlatformKpis[] {
  const byPlatform = new Map<string, PlatformKpis>();
  for (const item of items) {
    const existing = byPlatform.get(item.platform) ?? {
      platform: item.platform,
      posts: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      views: 0,
      engagement: 0,
      avgEngagementPerPost: 0,
    };
    existing.posts += 1;
    existing.likes += item.likes;
    existing.comments += item.comments;
    existing.shares += item.shares;
    existing.views += item.views;
    existing.engagement += engagementScore(item);
    byPlatform.set(item.platform, existing);
  }
  const result = [...byPlatform.values()];
  for (const kpi of result) {
    kpi.avgEngagementPerPost =
      kpi.posts === 0 ? 0 : roundOneDecimal(kpi.engagement / kpi.posts);
  }
  result.sort((a, b) => b.engagement - a.engagement);
  return result;
}

/** Totals across every platform, for the headline KPI cards. */
export interface OverallKpis {
  posts: number;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  engagement: number;
}

/** Sum the per-platform KPIs into a single overall roll-up. */
export function overallKpis(items: ActivityItem[]): OverallKpis {
  const totals: OverallKpis = {
    posts: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    views: 0,
    engagement: 0,
  };
  for (const item of items) {
    totals.posts += 1;
    totals.likes += item.likes;
    totals.comments += item.comments;
    totals.shares += item.shares;
    totals.views += item.views;
    totals.engagement += engagementScore(item);
  }
  return totals;
}

/** One day's bucketed engagement, for the growth-over-time chart. */
export interface EngagementBucket {
  /** ISO date (YYYY-MM-DD), the local day a post was published. */
  date: string;
  /** Number of posts published that day. */
  posts: number;
  likes: number;
  comments: number;
  shares: number;
  /** Sum of likes + comments + shares for posts published that day. */
  engagement: number;
}

/** Format a Unix-epoch-millis timestamp as a local ISO date (YYYY-MM-DD). */
function toLocalIsoDate(epochMillis: number): string {
  const date = new Date(epochMillis);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Engagement bucketed by the day each post was published, ascending by date.
 *
 * This is the honest "growth over time": we have no day-by-day history of a
 * single post's counts, only each post's current counts and when it published.
 * Summing current engagement into publish-date buckets shows when the content
 * that's performing was put out. Posts with no `publishedAt` are skipped — they
 * can't be placed on a time axis.
 */
export function engagementByDay(items: ActivityItem[]): EngagementBucket[] {
  const byDate = new Map<string, EngagementBucket>();
  for (const item of items) {
    if (item.publishedAt == null) {
      continue;
    }
    const date = toLocalIsoDate(item.publishedAt);
    const existing = byDate.get(date) ?? {
      date,
      posts: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      engagement: 0,
    };
    existing.posts += 1;
    existing.likes += item.likes;
    existing.comments += item.comments;
    existing.shares += item.shares;
    existing.engagement += engagementScore(item);
    byDate.set(date, existing);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const DEFAULT_TOP_POSTS = 5;

/**
 * The best-performing posts, ranked by engagement score descending. Ties break
 * by most recently published so the ordering is deterministic.
 */
export function topPosts(
  items: ActivityItem[],
  limit: number = DEFAULT_TOP_POSTS
): ActivityItem[] {
  return [...items]
    .sort((a, b) => {
      const byScore = engagementScore(b) - engagementScore(a);
      if (byScore !== 0) {
        return byScore;
      }
      return (b.publishedAt ?? 0) - (a.publishedAt ?? 0);
    })
    .slice(0, limit);
}
