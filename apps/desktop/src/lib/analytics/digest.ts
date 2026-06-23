/**
 * Weekly performance digest (U23).
 *
 * Produces a human-readable summary of the last week's published-post
 * performance and exports it to a file the user picks. Built on the same
 * `ActivityItem[]` snapshot the Activity feed and dashboards use, so it needs no
 * new data surface and no schema migration.
 *
 * Compute (`buildWeeklyDigest`) and rendering (`formatDigestMarkdown`) are pure;
 * only `exportWeeklyDigest` touches Tauri (dialog + fs). The split keeps the
 * summary testable and mirrors the analytics module's pure-relative-to-IO shape.
 *
 * "Deltas" are week-over-week: with no historical metric series, the honest
 * comparison is the engagement of posts *published* this week vs posts
 * published the prior week.
 */

import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  isWithinInterval,
  startOfWeek,
  subMilliseconds,
  subWeeks,
} from "date-fns";
import { platformLabel } from "@/components/compose/platform-meta";
import {
  engagementScore,
  platformKpis,
  topPosts,
} from "@/lib/analytics/analytics";
import { logger } from "@/lib/logger";
import type { ActivityItem } from "@/lib/social-schema";

/** Totals for one week's worth of published posts. */
export interface WeekTotals {
  posts: number;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  engagement: number;
}

/** A top post as it appears in the digest, denormalised for rendering. */
export interface DigestTopPost {
  platform: string;
  text: string | null;
  permalink: string | null;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  engagement: number;
}

/** The computed weekly digest, before it's rendered to a format. */
export interface WeeklyDigest {
  /** ISO timestamp the digest was generated. */
  generatedAt: string;
  /** ISO timestamp of the start of the current week (inclusive). */
  weekStart: string;
  /** This week's totals (posts published within the current week). */
  thisWeek: WeekTotals;
  /** The prior week's totals, for the delta. */
  lastWeek: WeekTotals;
  /** Per-platform engagement for this week's posts, highest first. */
  platforms: { platform: string; posts: number; engagement: number }[];
  /** This week's best-performing posts, highest engagement first. */
  topPosts: DigestTopPost[];
}

const DIGEST_TOP_POSTS = 5;

function emptyTotals(): WeekTotals {
  return {
    posts: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    views: 0,
    engagement: 0,
  };
}

function addToTotals(totals: WeekTotals, item: ActivityItem): void {
  totals.posts += 1;
  totals.likes += item.likes;
  totals.comments += item.comments;
  totals.shares += item.shares;
  totals.views += item.views;
  totals.engagement += engagementScore(item);
}

/**
 * Posts published within `[start, end)`. A post with no `publishedAt` can't be
 * placed in a week and is excluded from both windows.
 */
function postsInWeek(
  items: ActivityItem[],
  start: Date,
  end: Date
): ActivityItem[] {
  // `end` is exclusive: the current week's start is the prior week's end, so
  // pull the boundary back by 1ms to keep the two windows disjoint.
  const inclusiveEnd = subMilliseconds(end, 1);
  return items.filter((item) => {
    if (item.publishedAt == null) {
      return false;
    }
    return isWithinInterval(new Date(item.publishedAt), {
      start,
      end: inclusiveEnd,
    });
  });
}

/**
 * Compute the weekly digest from the activity snapshot. `now` is injectable so
 * a check can pin the week boundaries deterministically. Weeks start on Monday.
 */
export function buildWeeklyDigest(
  items: ActivityItem[],
  now: Date = new Date()
): WeeklyDigest {
  const weekStartsOn = 1; // Monday
  const thisWeekStart = startOfWeek(now, { weekStartsOn });
  const lastWeekStart = subWeeks(thisWeekStart, 1);

  const thisWeekItems = postsInWeek(items, thisWeekStart, now);
  const lastWeekItems = postsInWeek(items, lastWeekStart, thisWeekStart);

  const thisWeek = emptyTotals();
  for (const item of thisWeekItems) {
    addToTotals(thisWeek, item);
  }
  const lastWeek = emptyTotals();
  for (const item of lastWeekItems) {
    addToTotals(lastWeek, item);
  }

  const platforms = platformKpis(thisWeekItems).map((kpi) => ({
    platform: kpi.platform,
    posts: kpi.posts,
    engagement: kpi.engagement,
  }));

  const top = topPosts(thisWeekItems, DIGEST_TOP_POSTS).map((item) => ({
    platform: item.platform,
    text: item.text,
    permalink: item.permalink,
    likes: item.likes,
    comments: item.comments,
    shares: item.shares,
    views: item.views,
    engagement: engagementScore(item),
  }));

  return {
    generatedAt: now.toISOString(),
    weekStart: thisWeekStart.toISOString(),
    thisWeek,
    lastWeek,
    platforms,
    topPosts: top,
  };
}

const NUMBER_FORMAT = new Intl.NumberFormat();
const PERCENT_FORMAT = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});
const TOP_POST_SNIPPET_LENGTH = 120;

function formatNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

/** A signed, human-readable week-over-week delta, e.g. "+42 (+18%)". */
function formatDelta(current: number, previous: number): string {
  const diff = current - previous;
  const sign = diff > 0 ? "+" : "";
  if (previous === 0) {
    const pct = current === 0 ? " (0%)" : " (new)";
    return `${sign}${formatNumber(diff)}${pct}`;
  }
  const pctValue = (diff / previous) * 100;
  const pctSign = pctValue > 0 ? "+" : "";
  return `${sign}${formatNumber(diff)} (${pctSign}${PERCENT_FORMAT.format(pctValue)}%)`;
}

/** Collapse a post body to a single-line snippet for the digest table. */
function snippet(text: string | null): string {
  if (!text) {
    return "(no text)";
  }
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= TOP_POST_SNIPPET_LENGTH) {
    return oneLine;
  }
  return `${oneLine.slice(0, TOP_POST_SNIPPET_LENGTH - 1)}…`;
}

/** Render a digest to Markdown — the default human-readable export format. */
export function formatDigestMarkdown(digest: WeeklyDigest): string {
  const { thisWeek, lastWeek } = digest;
  const weekStartDate = digest.weekStart.slice(0, 10);
  const lines: string[] = [];

  lines.push("# Weekly performance digest");
  lines.push("");
  lines.push(`Week of ${weekStartDate} · generated ${digest.generatedAt}`);
  lines.push("");

  lines.push("## Totals (this week vs last week)");
  lines.push("");
  lines.push("| Metric | This week | Last week | Change |");
  lines.push("| --- | --- | --- | --- |");
  const rows: [string, number, number][] = [
    ["Posts", thisWeek.posts, lastWeek.posts],
    ["Engagement", thisWeek.engagement, lastWeek.engagement],
    ["Likes", thisWeek.likes, lastWeek.likes],
    ["Comments", thisWeek.comments, lastWeek.comments],
    ["Shares", thisWeek.shares, lastWeek.shares],
    ["Views", thisWeek.views, lastWeek.views],
  ];
  for (const [label, current, previous] of rows) {
    lines.push(
      `| ${label} | ${formatNumber(current)} | ${formatNumber(previous)} | ${formatDelta(current, previous)} |`
    );
  }
  lines.push("");

  lines.push("## By platform (this week)");
  lines.push("");
  if (digest.platforms.length === 0) {
    lines.push("_No posts published this week._");
  } else {
    lines.push("| Platform | Posts | Engagement |");
    lines.push("| --- | --- | --- |");
    for (const platform of digest.platforms) {
      lines.push(
        `| ${platformLabel(platform.platform)} | ${formatNumber(platform.posts)} | ${formatNumber(platform.engagement)} |`
      );
    }
  }
  lines.push("");

  lines.push("## Top posts (this week)");
  lines.push("");
  if (digest.topPosts.length === 0) {
    lines.push("_No posts published this week._");
  } else {
    for (const [index, post] of digest.topPosts.entries()) {
      const heading = `${index + 1}. [${platformLabel(post.platform)}] ${snippet(post.text)}`;
      lines.push(heading);
      const metrics = `   ${formatNumber(post.engagement)} engagement · ${formatNumber(post.likes)} likes · ${formatNumber(post.comments)} comments · ${formatNumber(post.shares)} shares · ${formatNumber(post.views)} views`;
      lines.push(metrics);
      if (post.permalink) {
        lines.push(`   ${post.permalink}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

/** Render a digest to pretty-printed JSON, for machine consumption. */
export function formatDigestJson(digest: WeeklyDigest): string {
  return `${JSON.stringify(digest, null, 2)}\n`;
}

function defaultDigestFilename(format: DigestFormat, now: Date): string {
  const date = now.toISOString().slice(0, 10);
  const ext = format === "json" ? "json" : "md";
  return `outpost-weekly-digest-${date}.${ext}`;
}

export type DigestFormat = "markdown" | "json";

export interface ExportWeeklyDigestResult {
  /** Whether a file was written. False when the user cancelled the dialog. */
  written: boolean;
  /** The path written to, when `written` is true. */
  path?: string;
}

/**
 * Prompt for a save location and write the weekly digest to it. Returns
 * `{ written: false }` when the user cancels the dialog. Throws if the write
 * itself fails, so the caller can surface the error.
 */
export async function exportWeeklyDigest(
  items: ActivityItem[],
  format: DigestFormat = "markdown",
  now: Date = new Date()
): Promise<ExportWeeklyDigestResult> {
  const digest = buildWeeklyDigest(items, now);
  const contents =
    format === "json" ? formatDigestJson(digest) : formatDigestMarkdown(digest);
  const filters =
    format === "json"
      ? [{ name: "JSON", extensions: ["json"] }]
      : [{ name: "Markdown", extensions: ["md"] }];

  const path = await save({
    defaultPath: defaultDigestFilename(format, now),
    filters,
  });
  if (path == null) {
    return { written: false };
  }

  try {
    await writeTextFile(path, contents);
  } catch (error) {
    logger.error({ err: error, path }, "[Analytics] Failed to write digest");
    throw error;
  }
  return { written: true, path };
}
