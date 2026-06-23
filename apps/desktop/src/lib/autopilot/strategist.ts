/**
 * Strategist agent for the crew orchestrator / Autopilot (U30).
 *
 * The Strategist coordinates the rest of the crew into a weekly content plan:
 * - Researcher: the radar's cached competitor/trend signals (U28).
 * - Copywriter: the learned voice profile (U16) + past organic winners (U21).
 * - Analyst: the loop's own experiment winners (U25). Concrete posting *times*
 *   are assigned deterministically by the orchestrator from the U26 timing
 *   recommender, not by the agent — the agent supplies only a timing *hint*.
 *
 * Given those signals, it asks the configured text-gen agent for a JSON array of
 * proposed posts (a hook, a body, a platform, a rationale, a timing hint). The
 * agent returns free text, so we prompt for strict JSON and parse defensively —
 * any throw, parse failure, or missing field yields an empty plan, and the
 * orchestrator reports it rather than crashing.
 *
 * Mirrors `lib/autoresearch/propose.ts` in style: reads agent config via the
 * settings store (this is a `lib/` service, not a component), uses the shared
 * fence-stripping + defensive parse, and surfaces a typed failure rather than
 * throwing. Kept separate from the pure orchestrator core so the core stays free
 * of ACP imports and loads under bun.
 */

import { acpPrompt } from "@/lib/acp-client";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { logger } from "@/lib/logger";
import { getRadarResearchInput } from "@/lib/radar/signal";
import { listActivityItems } from "@/lib/repos/activity-items";
import { decodeDraftBody } from "@/lib/repos/drafts";
import {
  type ExperimentWinner,
  listExperimentWinners,
} from "@/lib/repos/experiments";
import {
  getVoiceProfile,
  type VoiceProfileData,
} from "@/lib/repos/voice-profile";
import type { ActivityItem } from "@/lib/social-schema";
import { useAppSettingsStore } from "@/stores/use-app-settings-store";

/** Strip a leading/trailing markdown code fence the agent may wrap JSON in. */
const FENCE_RE = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

/** The most past winners/items we feed the agent, to bound the prompt size. */
const MAX_SIGNALS = 5;

/** Upper bound on plan size, so a runaway agent can't queue an endless plan. */
export const MAX_PLAN_ITEMS = 7;

/** A single proposed post the strategist produced (pre-timing-assignment). */
export interface StrategistPost {
  hook: string;
  body: string;
  /** Platform key the post targets, e.g. "x". */
  targetPlatform: string;
  /** A human-readable timing suggestion, e.g. "weekday mornings". */
  timing: string;
  /** Why this post belongs in the plan, grounded in the crew's signals. */
  rationale: string;
}

/** Why a plan run produced nothing, for the caller to surface. */
export type StrategistFailure = "no-agent" | "agent-error" | "unparsable";

/** The outcome of a strategist run: a plan, or a reason it is empty. */
export interface StrategistResult {
  posts: StrategistPost[];
  failure: StrategistFailure | null;
}

/** The voice-profile guidance block, or "" when no usable profile is present. */
function voiceGuidance(voice: VoiceProfileData | null): string {
  if (!voice) {
    return "";
  }
  const summary = voice.summary.trim();
  const traits = voice.traits.filter((trait) => trait.trim().length > 0);
  if (summary.length === 0 && traits.length === 0) {
    return "";
  }
  const lines = ["", "Match this author's established writing voice:"];
  if (summary.length > 0) {
    lines.push(summary);
  }
  if (traits.length > 0) {
    lines.push(`Traits: ${traits.join("; ")}.`);
  }
  return lines.join("\n");
}

/** The Researcher block: the radar's cached findings, or "". */
function researcherGuidance(radarInput: string): string {
  if (radarInput.trim().length === 0) {
    return "";
  }
  return `\n${radarInput}`;
}

/** The Copywriter block: past organic winners, highest first, or "". */
function winnersGuidance(items: ActivityItem[]): string {
  const ranked = items
    .filter((item) => (item.text ?? "").trim().length > 0)
    .map((item) => ({
      text: (item.text ?? "").trim().replace(/\s+/g, " "),
      engagement: item.likes + item.comments + item.shares,
    }))
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, MAX_SIGNALS);
  if (ranked.length === 0) {
    return "";
  }
  const lines = ["", "Your highest-engagement past posts (for reference):"];
  for (const entry of ranked) {
    lines.push(`- (engagement=${entry.engagement}) ${entry.text}`);
  }
  return lines.join("\n");
}

/** The Analyst block: winning posts from prior experiments, or "". */
function experimentWinnersGuidance(winners: ExperimentWinner[]): string {
  const usable = winners
    .map((winner) => ({
      text: decodeDraftBody(winner.draftBody).text.trim().replace(/\s+/g, " "),
      metricValue: winner.metricValue,
      goalMetric: winner.goalMetric,
    }))
    .filter((winner) => winner.text.length > 0)
    .slice(0, MAX_SIGNALS);
  if (usable.length === 0) {
    return "";
  }
  const lines = ["", "Winning posts from prior experiments (highest first):"];
  for (const winner of usable) {
    lines.push(`- (${winner.goalMetric}=${winner.metricValue}) ${winner.text}`);
  }
  return lines.join("\n");
}

function buildPrompt(
  voice: VoiceProfileData | null,
  radarInput: string,
  winners: ActivityItem[],
  experimentWinners: ExperimentWinner[]
): string {
  return [
    "You are the Strategist coordinating a content crew to plan a week of posts.",
    "Synthesize the signals below into a focused weekly plan: a handful of",
    "concrete, ready-to-publish posts (3-5 is ideal, never more than",
    `${MAX_PLAN_ITEMS}). Each post should ride a real signal — a trending angle,`,
    "a proven winner, or a gap worth filling — and stay in the author's voice.",
    "Do NOT pick exact dates/times; give a timing hint only (the scheduler",
    "places posts in the author's best-performing slots).",
    voiceGuidance(voice),
    researcherGuidance(radarInput),
    winnersGuidance(winners),
    experimentWinnersGuidance(experimentWinners),
    "",
    "Respond with ONLY a JSON object, no prose and no code fences, of the form:",
    '{ "posts": [ { "hook": "<the opening line/hook>", "body": "<the full',
    'candidate post body, ready to publish>", "targetPlatform": "<platform key,',
    'e.g. x>", "timing": "<a timing hint, e.g. weekday mornings>", "rationale":',
    '"<why this post belongs in the plan, grounded in the signals above>" } ] }.',
  ].join("\n");
}

/** Coerce one unknown plan entry into a {@link StrategistPost}, or null. */
function parsePost(value: unknown): StrategistPost | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const str = (key: string): string =>
    typeof record[key] === "string" ? (record[key] as string).trim() : "";
  const body = str("body");
  // A post is only useful if it carries a body to publish; everything else has a
  // sensible fallback so a partial entry still yields a runnable post.
  if (body.length === 0) {
    return null;
  }
  const hook = str("hook");
  return {
    hook: hook.length > 0 ? hook : body.split("\n")[0],
    body,
    targetPlatform: str("targetPlatform") || "x",
    timing: str("timing") || "anytime",
    rationale: str("rationale"),
  };
}

/** Parse the agent's text into a plan, tolerating noise; [] on failure. */
function parseAgentResponse(raw: string): StrategistPost[] {
  const trimmed = raw.trim();
  const unfenced = FENCE_RE.exec(trimmed)?.[1] ?? trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    return [];
  }
  // Accept either a top-level array or a { posts: [...] } wrapper.
  let entries: unknown[] = [];
  if (Array.isArray(parsed)) {
    entries = parsed;
  } else if (typeof parsed === "object" && parsed !== null) {
    const maybe = (parsed as Record<string, unknown>).posts;
    if (Array.isArray(maybe)) {
      entries = maybe;
    }
  }

  const posts: StrategistPost[] = [];
  for (const entry of entries) {
    const post = parsePost(entry);
    if (post) {
      posts.push(post);
    }
    if (posts.length >= MAX_PLAN_ITEMS) {
      break;
    }
  }
  return posts;
}

/**
 * Ask the configured text-gen agent to produce a weekly content plan.
 *
 * Never throws: returns `{ posts, failure }`. A non-null `failure` means no plan
 * was produced (the orchestrator then records nothing and reports it).
 */
export async function buildStrategistPlan(
  workspaceId: string = getCurrentWorkspaceId()
): Promise<StrategistResult> {
  const { acpAgents, acpTextGenAgentId } = useAppSettingsStore.getState();
  const agent = acpTextGenAgentId
    ? acpAgents.find((candidate) => candidate.id === acpTextGenAgentId)
    : undefined;
  if (!agent) {
    return { posts: [], failure: "no-agent" };
  }

  // Every signal is read defensively so one read error degrades to a less
  // conditioned (but still valid) plan rather than aborting.
  let voice: VoiceProfileData | null = null;
  try {
    voice = await getVoiceProfile(workspaceId);
  } catch (error) {
    logger.error({ err: error }, "[Autopilot] Failed to read voice profile");
  }

  let radarInput = "";
  try {
    radarInput = await getRadarResearchInput(workspaceId);
  } catch (error) {
    logger.error({ err: error }, "[Autopilot] Failed to read radar signal");
  }

  let winners: ActivityItem[] = [];
  try {
    winners = await listActivityItems(workspaceId);
  } catch (error) {
    logger.error({ err: error }, "[Autopilot] Failed to read activity");
  }

  let experimentWinners: ExperimentWinner[] = [];
  try {
    experimentWinners = await listExperimentWinners(workspaceId);
  } catch (error) {
    logger.error(
      { err: error },
      "[Autopilot] Failed to read experiment winners"
    );
  }

  let raw: string;
  try {
    raw = await acpPrompt(
      agent,
      buildPrompt(voice, radarInput, winners, experimentWinners)
    );
  } catch (error) {
    logger.error({ err: error }, "[Autopilot] Strategist plan failed");
    return { posts: [], failure: "agent-error" };
  }

  const posts = parseAgentResponse(raw);
  if (posts.length === 0) {
    return { posts: [], failure: "unparsable" };
  }
  return { posts, failure: null };
}

/** A human-readable message for a plan failure, for toasts. */
export function strategistFailureMessage(failure: StrategistFailure): string {
  switch (failure) {
    case "no-agent":
      return "Configure a text-generation agent in Settings to run autopilot.";
    case "agent-error":
      return "The AI agent could not build a plan. Try again later.";
    default:
      return "Could not read the AI agent's response. Try again.";
  }
}
