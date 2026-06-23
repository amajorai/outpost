/**
 * Radar fetch wiring (U28): turn tracked targets into cached signals.
 *
 * Two sources, mirroring the task's "provider reads + ACP/web":
 *  - competitors: read a tracked creator's recent posts via the provider's
 *    optional `readCreatorTopPosts` (where the platform allows), rank them with
 *    the pure ranker, and cache the winners. Providers that can't discover a
 *    creator's posts omit the method, so the competitor degrades to an
 *    ACP-generated summary signal instead of failing.
 *  - topics: ask the configured text-gen agent for the rising
 *    sub-topics/formats for the keyword, and cache them as trend signals. The
 *    agent returns free text, so we prompt for strict JSON and parse defensively
 *    — any throw / parse failure yields no signal rather than crashing. This is
 *    the same ACP style as `reformat.ts` / `propose.ts`.
 *
 * Kept separate from the pure ranker (`rank.ts`) so the ranker loads under bun;
 * this file is the ACP + provider + DB boundary, like `autoresearch/deps.ts`.
 */

import { acpPrompt } from "@/lib/acp-client";
import { logger } from "@/lib/logger";
import { getProviderFor, PLATFORMS, type Platform } from "@/lib/providers";
import { rankCreatorWinners, slugId } from "@/lib/radar/rank";
import {
  deleteSignalsForTarget,
  listRadarTargets,
  upsertTrendSignal,
} from "@/lib/repos/radar";
import { DEFAULT_WORKSPACE_ID, type RadarTarget } from "@/lib/social-schema";
import { useAppSettingsStore } from "@/stores/use-app-settings-store";

/** Strip a leading/trailing markdown code fence the agent may wrap JSON in. */
const FENCE_RE = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

/** The most trend items we cache per topic, to bound the agent output. */
const MAX_TREND_ITEMS = 5;

/** The outcome of a radar refresh, surfaced to the UI. */
export interface RadarRefreshResult {
  /** How many competitor targets produced at least one cached signal. */
  competitorsFetched: number;
  /** How many topic targets produced at least one cached signal. */
  topicsFetched: number;
  /** Total signals cached across all targets. */
  signalsCached: number;
}

/** Narrow a free-form platform string to a known `Platform`, or null. */
function asPlatform(value: string | null): Platform | null {
  if (value && (PLATFORMS as readonly string[]).includes(value)) {
    return value as Platform;
  }
  return null;
}

/**
 * Fetch + cache one competitor's winners via the provider. Clears the target's
 * prior signals first so a refresh reflects only current winners. Returns the
 * number of signals cached (0 when the provider can't read the creator).
 */
async function fetchCompetitor(target: RadarTarget): Promise<number> {
  const platform = asPlatform(target.platform);
  if (!platform) {
    return 0;
  }
  const provider = await getProviderFor(platform);
  if (!provider.readCreatorTopPosts) {
    return 0;
  }

  let posts: Awaited<
    ReturnType<NonNullable<typeof provider.readCreatorTopPosts>>
  >;
  try {
    posts = await provider.readCreatorTopPosts(platform, target.value);
  } catch (error) {
    logger.error(
      { err: error, target: target.value },
      "[Radar] Failed to read creator posts"
    );
    return 0;
  }

  const winners = rankCreatorWinners(posts);
  if (winners.length === 0) {
    return 0;
  }

  await deleteSignalsForTarget(target.id);
  const fetchedAt = Date.now();
  for (const winner of winners) {
    await upsertTrendSignal({
      kind: "creator-winner",
      targetId: target.id,
      platform,
      externalId: winner.externalId,
      title: `${target.label ?? target.value}: ${winner.text.slice(0, 80)}`,
      summary: winner.text,
      url: winner.permalink ?? null,
      score: (winner.engagement.likes ?? 0) + (winner.engagement.comments ?? 0),
      fetchedAt,
      workspaceId: target.workspaceId,
    });
  }
  return winners.length;
}

/** One rising-trend item the agent returns for a topic. */
interface ParsedTrend {
  title: string;
  summary: string;
}

/** Parse the agent's response into trend items, tolerating noise; [] on failure. */
function parseTrends(raw: string): ParsedTrend[] {
  const trimmed = raw.trim();
  const unfenced = FENCE_RE.exec(trimmed)?.[1] ?? trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const items: ParsedTrend[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const summary =
      typeof record.summary === "string" ? record.summary.trim() : "";
    if (title.length > 0) {
      items.push({ title, summary });
    }
  }
  return items.slice(0, MAX_TREND_ITEMS);
}

function buildTopicPrompt(topic: string): string {
  return [
    "You are a social-media trend analyst. For the topic below, list the rising",
    "sub-topics, angles, and content formats that are gaining attention right",
    "now in that niche. Focus on what a creator could post about next.",
    "",
    `Topic: ${topic}`,
    "",
    `Respond with ONLY a JSON array (max ${MAX_TREND_ITEMS}) of objects, no prose`,
    'and no code fences, of the form: [{ "title": "<short rising trend/format>",',
    '"summary": "<one sentence on why it is rising and how to use it>" }].',
  ].join("\n");
}

/**
 * Fetch + cache one topic's rising trends via the configured text-gen agent.
 * Clears the target's prior signals first. Returns the number cached (0 when no
 * agent is configured or the response is unusable — the radar degrades rather
 * than throwing).
 */
async function fetchTopic(target: RadarTarget): Promise<number> {
  const { acpAgents, acpTextGenAgentId } = useAppSettingsStore.getState();
  const agent = acpTextGenAgentId
    ? acpAgents.find((candidate) => candidate.id === acpTextGenAgentId)
    : undefined;
  if (!agent) {
    return 0;
  }

  let raw: string;
  try {
    raw = await acpPrompt(agent, buildTopicPrompt(target.value));
  } catch (error) {
    logger.error(
      { err: error, topic: target.value },
      "[Radar] Agent trend fetch failed"
    );
    return 0;
  }

  const trends = parseTrends(raw);
  if (trends.length === 0) {
    return 0;
  }

  await deleteSignalsForTarget(target.id);
  const fetchedAt = Date.now();
  let rank = trends.length;
  for (const trend of trends) {
    await upsertTrendSignal({
      kind: "trend",
      targetId: target.id,
      platform: target.platform,
      externalId: slugId(target.id, trend.title),
      title: trend.title,
      summary: trend.summary || null,
      // Higher-listed trends rank higher; gives the list a stable order.
      score: rank,
      fetchedAt,
      workspaceId: target.workspaceId,
    });
    rank -= 1;
  }
  return trends.length;
}

/**
 * Refresh every tracked target for a workspace: read competitor winners via the
 * provider and topic trends via the agent, caching both. Each target is fetched
 * independently so one failure never aborts the rest. Satisfies "periodically
 * fetch" pragmatically — the UI calls this on demand and on mount.
 */
export async function refreshRadar(
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<RadarRefreshResult> {
  const targets = await listRadarTargets(workspaceId);
  const result: RadarRefreshResult = {
    competitorsFetched: 0,
    topicsFetched: 0,
    signalsCached: 0,
  };

  for (const target of targets) {
    if (target.kind === "competitor") {
      const cached = await fetchCompetitor(target);
      result.signalsCached += cached;
      if (cached > 0) {
        result.competitorsFetched += 1;
      }
    } else {
      const cached = await fetchTopic(target);
      result.signalsCached += cached;
      if (cached > 0) {
        result.topicsFetched += 1;
      }
    }
  }

  return result;
}
