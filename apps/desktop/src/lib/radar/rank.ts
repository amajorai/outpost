/**
 * Pure radar helpers (U28): ranking, slugging, and research-input formatting.
 *
 * This file is the pure core of the radar, mirroring `lib/autoresearch/loop.ts`:
 * it imports nothing from `@tauri-apps/*`, no repos, and no ACP client, so it
 * loads under plain `bun` and is covered by `radar.check.ts`. The ACP + DB
 * wiring lives in `lib/radar/fetch.ts` and `lib/radar/signal.ts`.
 */

import type { TrendSignal } from "@/lib/social-schema";

/** The fields of a creator post the ranker needs (a structural subset). */
export interface RankableCreatorPost {
  externalId: string;
  text: string;
  permalink?: string;
  engagement: { likes?: number; comments?: number; views?: number };
  publishedAt?: number;
}

/** How many of a creator's posts the radar keeps as "winners". */
export const MAX_CREATOR_WINNERS = 3;

/** How many signals the research-input block feeds the autoresearch loop. */
export const MAX_RESEARCH_SIGNALS = 8;

/**
 * Score a creator post for "high-performing" ranking: likes + comments weighted
 * above raw views (engagement is a stronger signal than impressions). Pure and
 * deterministic so the ranking is stable across refreshes.
 */
export function creatorPostScore(post: RankableCreatorPost): number {
  const likes = post.engagement.likes ?? 0;
  const comments = post.engagement.comments ?? 0;
  const views = post.engagement.views ?? 0;
  const COMMENT_WEIGHT = 3;
  const VIEW_WEIGHT = 0.01;
  return likes + comments * COMMENT_WEIGHT + views * VIEW_WEIGHT;
}

/**
 * Rank a creator's posts by {@link creatorPostScore}, highest first, and keep
 * the top {@link MAX_CREATOR_WINNERS}. Posts with no usable text are dropped so a
 * blank post never becomes a "winner".
 */
export function rankCreatorWinners<T extends RankableCreatorPost>(
  posts: T[]
): T[] {
  return posts
    .filter((post) => post.text.trim().length > 0)
    .map((post) => ({ post, score: creatorPostScore(post) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CREATOR_WINNERS)
    .map((entry) => entry.post);
}

const NON_SLUG_RE = /[^a-z0-9]+/g;
const SLUG_TRIM_RE = /^-+|-+$/g;
const MAX_SLUG_LENGTH = 60;

/** Slug a title into a stable external id for an AI-generated trend signal. */
export function slugId(prefix: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(NON_SLUG_RE, "-")
    .replace(SLUG_TRIM_RE, "")
    .slice(0, MAX_SLUG_LENGTH);
  return `${prefix}:${slug || "untitled"}`;
}

/**
 * Format the cached radar signals into a guidance block for the autoresearch
 * loop (U28 -> U27). Highest-score signals first, bounded to
 * {@link MAX_RESEARCH_SIGNALS}. Returns "" when there is nothing to surface, so
 * absence contributes nothing to the prompt — matching the
 * `voiceGuidance`/`winnersGuidance` "absence is the old default" contract.
 */
export function formatRadarResearchInput(signals: TrendSignal[]): string {
  const usable = signals
    .filter((signal) => signal.title.trim().length > 0)
    .slice(0, MAX_RESEARCH_SIGNALS);
  if (usable.length === 0) {
    return "";
  }
  const lines = [
    "Competitor & trend radar — what is working in the niche right now:",
  ];
  for (const signal of usable) {
    const kind =
      signal.kind === "creator-winner" ? "competitor winner" : "rising trend";
    const detail = (signal.summary ?? signal.title).trim().replace(/\s+/g, " ");
    lines.push(`- (${kind}) ${detail}`);
  }
  return lines.join("\n");
}
