/**
 * Optimal-timing recommender (U26).
 *
 * The inverse of U24's predictor `timingFactor`: where the predictor *judges* a
 * chosen posting time against the user's best hours, this *proposes* the best
 * times to post. Pure functions over the same `ActivityItem[]` the Activity
 * feed and analytics already use (one latest-snapshot row per published post),
 * so a check can drive them with synthetic items and assert the ranking.
 *
 * What the data honestly supports (mirroring the caveats in `analytics.ts` and
 * `predictor/history.ts`):
 * - We rank slots by mean `engagementScore` (likes + comments + shares; views
 *   excluded as an impression count, not an interaction) of the posts that fell
 *   in them, using each post's local `publishedAt` day-of-week and hour.
 * - There is no per-post time series and no follower count, so a "best slot" is
 *   "when the content that performed was published", not a learned curve.
 * - day-of-week x hour is 168 buckets; a handful of posts leaves almost all
 *   empty and the rest at n=1, where a single lucky post would dominate. So we
 *   require a minimum sample per bucket before trusting its lift, fall back to
 *   coarser hour-of-day buckets when the fine grid is too sparse, and fall all
 *   the way back to built-in platform defaults (flagged `basis: "defaults"`)
 *   when there's barely any history — never implying learned signal we lack.
 */

import { engagementScore } from "@/lib/analytics/analytics";
import type { ActivityItem } from "@/lib/social-schema";

/**
 * Below this many posts on a platform, history is too sparse to learn any slot
 * from; we return built-in defaults flagged `basis: "defaults"`.
 */
export const MIN_PLATFORM_SAMPLE = 4;

/**
 * A day-of-week x hour bucket needs at least this many posts before its average
 * (and therefore its lift) is trustworthy enough to surface as a fine-grained
 * slot. Below it we coarsen to hour-of-day across all days.
 */
export const MIN_FINE_BUCKET_SAMPLE = 2;

/** How many recommended slots a surface shows at most. */
export const MAX_SLOTS = 3;

/** Number of hours in a day, for the hour-of-day fallback grid. */
const HOURS_PER_DAY = 24;

/** Number of days in a week. */
const DAYS_PER_WEEK = 7;

/**
 * How a slot's day was derived: a specific `day` of the week, or `any` day at a
 * given hour (the coarser hour-of-day fallback, or a built-in default).
 */
export type SlotDayKind = "day" | "any";

/** A recommended posting slot for one platform. */
export interface RecommendedSlot {
  /**
   * Local day-of-week (0 = Sunday .. 6 = Saturday) when `dayKind` is `"day"`.
   * Ignored when `dayKind` is `"any"` (the slot applies to every day).
   */
  dayOfWeek: number;
  /** `"day"` for a specific weekday, `"any"` for an hour-of-day slot. */
  dayKind: SlotDayKind;
  /** Local hour-of-day (0-23) the slot recommends. */
  hour: number;
  /** Mean engagement score of the posts that fell in this slot. */
  avgEngagement: number;
  /** Number of posts that informed this slot. */
  sampleSize: number;
  /**
   * Estimated lift vs the platform baseline, as a percentage (e.g. 25 means
   * +25%). Null when there isn't enough sample to quote a trustworthy number
   * (e.g. built-in defaults, where we have no measured lift).
   */
  liftPct: number | null;
}

/** Whether the slots came from learned history or built-in defaults. */
export type TimingBasis = "history" | "defaults";

/** The timing recommendation for a single platform/account grouping. */
export interface TimingRecommendation {
  /** The key the slots were grouped on (a platform key, or account id). */
  key: string;
  /** Ranked best slots, strongest first, at most {@link MAX_SLOTS}. */
  slots: RecommendedSlot[];
  /** Mean engagement per post across the whole grouping (the lift baseline). */
  baseline: number;
  /** Number of posts that informed the recommendation. */
  sampleSize: number;
  /** Whether slots are learned from history or are built-in defaults. */
  basis: TimingBasis;
}

/**
 * Built-in default slots used when a platform has too little history. These are
 * sensible general "good time to post" windows (weekday late-morning and early
 * evening) so a brand-new user still sees actionable suggestions, clearly
 * flagged as defaults rather than learned signal.
 *
 * Tuesday/Wednesday/Thursday late morning and early evening are the broadly
 * cited engagement windows across major networks; we keep them platform-neutral
 * rather than over-fitting per network.
 */
const DEFAULT_SLOTS: readonly RecommendedSlot[] = [
  {
    dayOfWeek: 2,
    dayKind: "day",
    hour: 11,
    avgEngagement: 0,
    sampleSize: 0,
    liftPct: null,
  },
  {
    dayOfWeek: 3,
    dayKind: "day",
    hour: 18,
    avgEngagement: 0,
    sampleSize: 0,
    liftPct: null,
  },
  {
    dayOfWeek: 4,
    dayKind: "day",
    hour: 13,
    avgEngagement: 0,
    sampleSize: 0,
    liftPct: null,
  },
];

/** The built-in default recommendation for a grouping with sparse history. */
function defaultRecommendation(
  key: string,
  sampleSize: number
): TimingRecommendation {
  return {
    key,
    slots: DEFAULT_SLOTS.slice(0, MAX_SLOTS).map((slot) => ({ ...slot })),
    baseline: 0,
    sampleSize,
    basis: "defaults",
  };
}

/** A mutable accumulator for one (dayOfWeek, hour) or (hour) bucket. */
interface BucketAcc {
  total: number;
  count: number;
}

/** The percentage scale for a 0..1 ratio. */
const PERCENT = 100;

/** Round a value to one decimal place. */
const ROUND_ONE_DECIMAL = 10;
function roundOneDecimal(value: number): number {
  return Math.round(value * ROUND_ONE_DECIMAL) / ROUND_ONE_DECIMAL;
}

/**
 * The lift of a slot average over the baseline, as a rounded percentage. Null
 * when the baseline is zero (every post had no engagement — no honest ratio).
 */
function liftPercent(avg: number, baseline: number): number | null {
  if (baseline <= 0) {
    return null;
  }
  return Math.round(((avg - baseline) / baseline) * PERCENT);
}

/**
 * Posts on a grouping that carry a usable `publishedAt`. Posts without one
 * can't be placed on a time axis, mirroring `engagementByDay`.
 */
function datedPosts(items: ActivityItem[]): ActivityItem[] {
  return items.filter((item) => item.publishedAt != null);
}

/** The platform baseline: mean engagement per dated post (0 when none). */
function baselineEngagement(dated: ActivityItem[]): number {
  if (dated.length === 0) {
    return 0;
  }
  const sum = dated.reduce((acc, item) => acc + engagementScore(item), 0);
  return roundOneDecimal(sum / dated.length);
}

/**
 * Build the fine day-of-week x hour slots that clear {@link
 * MIN_FINE_BUCKET_SAMPLE}, ranked by mean engagement descending. Returns an
 * empty list when no bucket is dense enough (the caller then coarsens).
 */
function fineSlots(dated: ActivityItem[], baseline: number): RecommendedSlot[] {
  const buckets = new Map<string, BucketAcc>();
  for (const item of dated) {
    const when = new Date(item.publishedAt as number);
    const key = `${when.getDay()}:${when.getHours()}`;
    const acc = buckets.get(key) ?? { total: 0, count: 0 };
    acc.total += engagementScore(item);
    acc.count += 1;
    buckets.set(key, acc);
  }

  const slots: RecommendedSlot[] = [];
  for (const [key, acc] of buckets) {
    if (acc.count < MIN_FINE_BUCKET_SAMPLE) {
      continue;
    }
    const [day, hour] = key.split(":").map(Number);
    const avg = roundOneDecimal(acc.total / acc.count);
    slots.push({
      dayOfWeek: day,
      dayKind: "day",
      hour,
      avgEngagement: avg,
      sampleSize: acc.count,
      liftPct: liftPercent(avg, baseline),
    });
  }
  slots.sort((a, b) => b.avgEngagement - a.avgEngagement);
  return slots;
}

/**
 * Build the coarser hour-of-day slots (any day), ranked by mean engagement
 * descending. The fallback when the fine grid is too sparse — it pools every
 * day's posts at each hour, so it needs far less data to be stable.
 */
function hourSlots(dated: ActivityItem[], baseline: number): RecommendedSlot[] {
  const buckets: BucketAcc[] = Array.from({ length: HOURS_PER_DAY }, () => ({
    total: 0,
    count: 0,
  }));
  for (const item of dated) {
    const hour = new Date(item.publishedAt as number).getHours();
    buckets[hour].total += engagementScore(item);
    buckets[hour].count += 1;
  }

  const slots: RecommendedSlot[] = [];
  for (let hour = 0; hour < HOURS_PER_DAY; hour += 1) {
    const acc = buckets[hour];
    if (acc.count === 0) {
      continue;
    }
    const avg = roundOneDecimal(acc.total / acc.count);
    slots.push({
      dayOfWeek: 0,
      dayKind: "any",
      hour,
      avgEngagement: avg,
      sampleSize: acc.count,
      // A single post's lift is noise; rank it as a useful hour but withhold the
      // lift number until the bucket is dense enough to quote it honestly. The
      // surfaces guard the badge on a non-null lift, so it simply won't render.
      liftPct:
        acc.count >= MIN_FINE_BUCKET_SAMPLE ? liftPercent(avg, baseline) : null,
    });
  }
  slots.sort((a, b) => b.avgEngagement - a.avgEngagement);
  return slots;
}

/**
 * Compute the ranked best posting slots for one grouping of posts (one
 * platform, or one account). Grouping-agnostic by design: the caller decides
 * what `items` represents and passes a `key` to label the result.
 *
 * Degrades in three tiers as data thins:
 *   1. Enough history and dense buckets -> fine day-of-week x hour slots.
 *   2. Enough history but sparse buckets -> coarser hour-of-day slots.
 *   3. Too little history -> built-in default slots (`basis: "defaults"`).
 */
export function computeTimingSlots(
  key: string,
  items: ActivityItem[]
): TimingRecommendation {
  const dated = datedPosts(items);
  if (dated.length < MIN_PLATFORM_SAMPLE) {
    return defaultRecommendation(key, dated.length);
  }

  const baseline = baselineEngagement(dated);
  const fine = fineSlots(dated, baseline);
  const slots = fine.length > 0 ? fine : hourSlots(dated, baseline);

  if (slots.length === 0) {
    return defaultRecommendation(key, dated.length);
  }

  return {
    key,
    slots: slots.slice(0, MAX_SLOTS),
    baseline,
    sampleSize: dated.length,
    basis: "history",
  };
}

/**
 * Compute a timing recommendation per platform present in `items`, keyed by
 * platform. Platforms with no posts simply don't appear; the surface treats a
 * missing key as "use defaults". This is the primary grouping the composer and
 * calendar consume (it aggregates the most data per key).
 */
export function recommendationsByPlatform(
  items: ActivityItem[]
): Map<string, TimingRecommendation> {
  const byPlatform = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const list = byPlatform.get(item.platform) ?? [];
    list.push(item);
    byPlatform.set(item.platform, list);
  }

  const result = new Map<string, TimingRecommendation>();
  for (const [platform, posts] of byPlatform) {
    result.set(platform, computeTimingSlots(platform, posts));
  }
  return result;
}

/**
 * Compute a timing recommendation per account present in `items`, keyed by
 * `socialAccountId`. Offered for callers that want account-level granularity;
 * note per-account history is sparser than per-platform, so more accounts will
 * fall back to defaults.
 */
export function recommendationsByAccount(
  items: ActivityItem[]
): Map<string, TimingRecommendation> {
  const byAccount = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const list = byAccount.get(item.socialAccountId) ?? [];
    list.push(item);
    byAccount.set(item.socialAccountId, list);
  }

  const result = new Map<string, TimingRecommendation>();
  for (const [accountId, posts] of byAccount) {
    result.set(accountId, computeTimingSlots(accountId, posts));
  }
  return result;
}

/**
 * Project a recommended slot to its next occurrence at or after `from`, as a
 * local `Date`. This turns a (dayOfWeek, hour) slot into an applyable schedule
 * time for the composer's "post at X" action.
 *
 * For a `"day"` slot we advance to the next matching weekday at the slot's
 * hour; if that lands in the past today we roll forward a week. For an `"any"`
 * slot we use the next occurrence of the hour today or tomorrow. Minutes/seconds
 * are zeroed so the suggested time is a clean top-of-hour.
 */
export function nextOccurrence(
  slot: RecommendedSlot,
  from: Date = new Date()
): Date {
  const candidate = new Date(from);
  candidate.setHours(slot.hour, 0, 0, 0);

  if (slot.dayKind === "any") {
    if (candidate.getTime() <= from.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }

  // Advance day-by-day to the next matching weekday, rolling past "today at an
  // hour already gone" so the suggestion is always in the future.
  let dayDelta =
    (slot.dayOfWeek - candidate.getDay() + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  if (dayDelta === 0 && candidate.getTime() <= from.getTime()) {
    dayDelta = DAYS_PER_WEEK;
  }
  candidate.setDate(candidate.getDate() + dayDelta);
  // Re-set the hour after the date shift so a DST boundary can't drift it.
  candidate.setHours(slot.hour, 0, 0, 0);
  return candidate;
}

/** Weekday labels for slot display, indexed by `Date.getDay()`. */
export const WEEKDAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

/** A short human label for a slot, e.g. "Tue 11:00" or "Any day 18:00". */
export function formatSlot(slot: RecommendedSlot): string {
  const hourLabel = `${String(slot.hour).padStart(2, "0")}:00`;
  if (slot.dayKind === "any") {
    return `Any day ${hourLabel}`;
  }
  return `${WEEKDAY_LABELS[slot.dayOfWeek]} ${hourLabel}`;
}
