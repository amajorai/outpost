/**
 * Runnable check for the War Room attention score (U29). No test runner is
 * configured in this app, so this is a plain script you can run with:
 *
 *   bun apps/desktop/src/lib/war-room/attention.check.ts
 *
 * It drives `computeAttentionScore` against synthetic activity items at a fixed
 * clock and asserts the honest-data behavior the dashboard depends on:
 *   - an empty feed yields the neutral score and "new" trend (no NaN/Infinity)
 *   - a single window of history can't quote a trend (prior == 0 -> "new")
 *   - more recent engagement than the prior window reads "up", less reads "down"
 *   - the score is clamped to [0, 100] under an extreme upswing
 *   - posts outside both windows don't leak into the score
 *
 * Imports only the pure core (no `@tauri-apps/*`, no repos), so it runs under
 * plain bun, mirroring `engine.check.ts` / `recommender.check.ts`.
 */

import type { ActivityItem } from "@/lib/social-schema";
import {
  ATTENTION_WINDOW_DAYS,
  computeAttentionScore,
  NEUTRAL_ATTENTION_SCORE,
} from "./attention";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const MS_PER_DAY = 86_400_000;
const FIXED_NOW = 1_700_000_000_000;

/** Build a minimal activity item with the engagement + publish date we care about. */
function makeItem(input: {
  publishedAt: number | null;
  likes?: number;
  comments?: number;
  shares?: number;
}): ActivityItem {
  return {
    id: crypto.randomUUID(),
    workspaceId: "ws",
    socialAccountId: "acct",
    platform: "x",
    postRemoteId: crypto.randomUUID(),
    permalink: null,
    text: null,
    likes: input.likes ?? 0,
    comments: input.comments ?? 0,
    shares: input.shares ?? 0,
    views: 0,
    engagementFetchedAt: null,
    publishedAt: input.publishedAt,
  };
}

/** A timestamp `daysAgo` before the fixed clock. */
function daysAgo(days: number): number {
  return FIXED_NOW - days * MS_PER_DAY;
}

function checkEmptyFeed(): void {
  const result = computeAttentionScore([], FIXED_NOW);
  assert(
    result.score === NEUTRAL_ATTENTION_SCORE,
    "empty feed yields the neutral score"
  );
  assert(result.trend === "new", "empty feed reads as a new trend");
  assert(result.changePct === null, "empty feed quotes no change percentage");
  assert(Number.isFinite(result.score), "empty feed score is finite");
}

function checkSingleWindow(): void {
  // Only recent-window history, nothing prior -> can't quote a trend.
  const result = computeAttentionScore(
    [makeItem({ publishedAt: daysAgo(1), likes: 10 })],
    FIXED_NOW
  );
  assert(result.trend === "new", "a single window of history reads as new");
  assert(result.recentEngagement === 10, "recent engagement is summed");
  assert(result.priorEngagement === 0, "no prior engagement");
}

function checkUpswing(): void {
  const priorDay = ATTENTION_WINDOW_DAYS + 1;
  const result = computeAttentionScore(
    [
      makeItem({ publishedAt: daysAgo(1), likes: 30 }),
      makeItem({ publishedAt: daysAgo(priorDay), likes: 10 }),
    ],
    FIXED_NOW
  );
  assert(result.trend === "up", "more recent than prior engagement reads up");
  assert(
    result.score > NEUTRAL_ATTENTION_SCORE,
    "an upswing scores above neutral"
  );
  assert(result.changePct === 200, "3x prior is +200%");
}

function checkDownswing(): void {
  const priorDay = ATTENTION_WINDOW_DAYS + 1;
  const result = computeAttentionScore(
    [
      makeItem({ publishedAt: daysAgo(1), likes: 5 }),
      makeItem({ publishedAt: daysAgo(priorDay), likes: 20 }),
    ],
    FIXED_NOW
  );
  assert(
    result.trend === "down",
    "less recent than prior engagement reads down"
  );
  assert(
    result.score < NEUTRAL_ATTENTION_SCORE,
    "a downswing scores below neutral"
  );
}

function checkClampAndWindowing(): void {
  const priorDay = ATTENTION_WINDOW_DAYS + 1;
  const wayOutside = 3 * ATTENTION_WINDOW_DAYS + 1;
  const result = computeAttentionScore(
    [
      makeItem({ publishedAt: daysAgo(1), likes: 100_000 }),
      makeItem({ publishedAt: daysAgo(priorDay), likes: 1 }),
      // Far outside both windows: must not contribute to either total.
      makeItem({ publishedAt: daysAgo(wayOutside), likes: 999 }),
    ],
    FIXED_NOW
  );
  assert(result.score <= 100, "score is clamped to at most 100");
  assert(result.score >= 0, "score is clamped to at least 0");
  assert(
    result.recentEngagement === 100_000,
    "out-of-window posts don't leak into the recent total"
  );
  assert(
    result.priorEngagement === 1,
    "out-of-window posts don't leak into the prior total"
  );
}

function main(): void {
  checkEmptyFeed();
  checkSingleWindow();
  checkUpswing();
  checkDownswing();
  checkClampAndWindowing();
  process.stdout.write("war-room attention check: OK\n");
}

main();
