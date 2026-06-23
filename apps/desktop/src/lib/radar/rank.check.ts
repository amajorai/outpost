/**
 * Runnable integration check for the pure radar core (U28). No test runner is
 * configured in this app, so this is a plain script you run with:
 *
 *   bun apps/desktop/src/lib/radar/rank.check.ts
 *
 * It exercises the pure ranker/slugger/formatter in `rank.ts` (no
 * `@tauri-apps/plugin-sql`, no providers, no ACP) and asserts:
 *   - creator winners are ranked by the engagement-weighted score, highest first
 *   - the winner list is bounded to MAX_CREATOR_WINNERS and drops blank posts
 *   - slugId produces a stable, prefixed, slugged id
 *   - the research-input formatter returns "" for no signals and a bounded,
 *     labeled block otherwise (the "absence contributes nothing" contract)
 *
 * The ACP + provider + DB wiring (`fetch.ts` / `signal.ts`) mirrors the
 * established sibling patterns (propose.ts / autoresearch deps) and is covered by
 * `tsc`. This check exercises the pure core.
 */

import type { TrendSignal } from "@/lib/social-schema";
import {
  formatRadarResearchInput,
  MAX_CREATOR_WINNERS,
  MAX_RESEARCH_SIGNALS,
  type RankableCreatorPost,
  rankCreatorWinners,
  slugId,
} from "./rank";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function post(
  externalId: string,
  text: string,
  likes: number,
  comments: number,
  views: number
): RankableCreatorPost {
  return { externalId, text, engagement: { likes, comments, views } };
}

function checkRanking(): void {
  const posts: RankableCreatorPost[] = [
    post("low", "low engagement", 10, 0, 100),
    post("high", "high engagement", 500, 20, 1000),
    post("mid", "mid engagement", 100, 5, 500),
    post("blank", "   ", 9999, 9999, 9999),
    post("fourth", "fourth", 1, 0, 0),
  ];
  const winners = rankCreatorWinners(posts);
  assert(
    winners.length === MAX_CREATOR_WINNERS,
    `bounded to ${MAX_CREATOR_WINNERS} winners`
  );
  assert(
    winners.every((w) => w.text.trim().length > 0),
    "blank posts are dropped"
  );
  assert(winners[0].externalId === "high", "highest engagement ranks first");
  assert(winners[1].externalId === "mid", "mid ranks second");
}

function checkSlug(): void {
  const id = slugId("t1", "Rising Format: Carousels!!! 2024");
  assert(id.startsWith("t1:"), "slug carries its prefix");
  assert(
    id === "t1:rising-format-carousels-2024",
    `slug normalizes punctuation/case (got ${id})`
  );
  assert(slugId("t1", "###").endsWith(":untitled"), "empty slug falls back");
}

function signal(kind: TrendSignal["kind"], title: string): TrendSignal {
  return {
    id: title,
    workspaceId: "default",
    kind,
    targetId: null,
    platform: null,
    externalId: title,
    title,
    summary: `${title} summary`,
    url: null,
    score: 1,
    raw: null,
    fetchedAt: 0,
  };
}

function checkResearchInput(): void {
  assert(
    formatRadarResearchInput([]) === "",
    "no signals contributes nothing to the prompt"
  );

  const many: TrendSignal[] = [];
  for (let i = 0; i < MAX_RESEARCH_SIGNALS + 4; i++) {
    many.push(signal("trend", `trend ${i}`));
  }
  const block = formatRadarResearchInput(many);
  assert(block.length > 0, "signals produce a guidance block");
  const bulletCount = block
    .split("\n")
    .filter((l) => l.startsWith("- ")).length;
  assert(
    bulletCount === MAX_RESEARCH_SIGNALS,
    `bounded to ${MAX_RESEARCH_SIGNALS} bullets (got ${bulletCount})`
  );

  const labeled = formatRadarResearchInput([
    signal("creator-winner", "a winner"),
    signal("trend", "a trend"),
  ]);
  assert(
    labeled.includes("competitor winner") && labeled.includes("rising trend"),
    "each signal kind is labeled"
  );
}

function main(): void {
  checkRanking();
  checkSlug();
  checkResearchInput();
  process.stdout.write("radar rank.check: all assertions passed\n");
}

main();
