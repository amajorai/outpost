/**
 * ACP/Claude-backed proposal step for the autoresearch loop (U27).
 *
 * Given the workspace's strategy doc (the `program.md` analog), its learned
 * voice profile, and its past winners (top activity items by the goal metric),
 * ask the configured text-gen agent to propose ONE content change to test next:
 * a hook, a body, a format, and a timing, with a rationale grounded in the
 * strategy. The agent returns free text, so we prompt for strict JSON and parse
 * defensively — any throw, parse failure, or missing field yields no proposal,
 * and the loop reports it rather than crashing.
 *
 * Mirrors `lib/compose/reformat.ts` / `lib/voice/derive.ts` verbatim in style:
 * reads agent config via the settings store (this is a `lib/` service, not a
 * component), uses the shared fence-stripping + defensive parse, and surfaces a
 * typed failure rather than throwing. Kept separate from the pure loop core
 * (`loop.ts`) so the engine stays free of ACP imports and loads under bun.
 */

import { acpPrompt } from "@/lib/acp-client";
import type { AutoresearchProposalData } from "@/lib/autoresearch/loop";
import { logger } from "@/lib/logger";
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
import {
  type ActivityItem,
  type AutoresearchStrategy,
  DEFAULT_WORKSPACE_ID,
  type ExperimentGoalMetric,
} from "@/lib/social-schema";
import { useAppSettingsStore } from "@/stores/use-app-settings-store";

/** Strip a leading/trailing markdown code fence the agent may wrap JSON in. */
const FENCE_RE = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

/** The most past winners we feed the agent, to bound the prompt size. */
const MAX_WINNERS = 5;

/** Why a proposal run produced nothing, for the caller to surface. */
export type ProposeFailure = "no-agent" | "agent-error" | "unparsable";

/** The outcome of a proposal run: a proposal, or a reason. */
export interface ProposeResult {
  proposal: AutoresearchProposalData | null;
  failure: ProposeFailure | null;
}

/** Score an activity item by the goal metric, for ranking past winners. */
function activityMetricValue(
  metric: ExperimentGoalMetric,
  item: ActivityItem
): number {
  switch (metric) {
    case "likes":
      return item.likes;
    case "comments":
      return item.comments;
    case "views":
      return item.views;
    default: {
      if (item.views <= 0) {
        return 0;
      }
      return (item.likes + item.comments + item.shares) / item.views;
    }
  }
}

/**
 * Build the past-winners guidance block: the top activity items by the goal
 * metric, with their text. Empty string when there is no measurable history, so
 * absence contributes nothing to the prompt (Data Versioning Contract).
 */
function winnersGuidance(
  items: ActivityItem[],
  metric: ExperimentGoalMetric
): string {
  const ranked = items
    .filter((item) => (item.text ?? "").trim().length > 0)
    .map((item) => ({ item, score: activityMetricValue(metric, item) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_WINNERS);
  if (ranked.length === 0) {
    return "";
  }
  const lines = ["", "Past top posts (highest first) for reference:"];
  for (const { item, score } of ranked) {
    const text = (item.text ?? "").trim().replace(/\s+/g, " ");
    lines.push(`- (${metric}=${score}) ${text}`);
  }
  return lines.join("\n");
}

/**
 * Build the experiment-winners guidance block: the loop's own past winners
 * (winning variants from prior experiments), so it learns from what it already
 * tested rather than only from organic activity. Empty string when there is no
 * experiment history, so absence contributes nothing to the prompt.
 */
function experimentWinnersGuidance(winners: ExperimentWinner[]): string {
  const usable = winners
    .map((winner) => ({
      text: decodeDraftBody(winner.draftBody).text.trim().replace(/\s+/g, " "),
      metricValue: winner.metricValue,
      goalMetric: winner.goalMetric,
    }))
    .filter((winner) => winner.text.length > 0)
    .slice(0, MAX_WINNERS);
  if (usable.length === 0) {
    return "";
  }
  const lines = ["", "Winning posts from prior experiments (highest first):"];
  for (const winner of usable) {
    lines.push(`- (${winner.goalMetric}=${winner.metricValue}) ${winner.text}`);
  }
  return lines.join("\n");
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

function buildPrompt(
  strategy: AutoresearchStrategy,
  voice: VoiceProfileData | null,
  winners: ActivityItem[],
  experimentWinners: ExperimentWinner[]
): string {
  return [
    "You are a growth strategist running a closed experimentation loop. Propose",
    "exactly ONE concrete content change to test next: a new hook, format, or",
    "timing. The change must be consistent with the strategy document below, the",
    "author's voice, and what has worked before. Optimize for the single goal",
    `metric: ${strategy.goalMetric}.`,
    "",
    "Strategy document:",
    strategy.content,
    voiceGuidance(voice),
    winnersGuidance(winners, strategy.goalMetric),
    experimentWinnersGuidance(experimentWinners),
    "",
    "Respond with ONLY a JSON object, no prose and no code fences, of the form:",
    '{ "hook": "<the opening line/hook>", "body": "<the full candidate post',
    'body>", "format": "<single|thread|carousel>", "timing": "<when to post,',
    'e.g. weekday mornings>", "rationale": "<why this should beat the current',
    'best, grounded in the strategy>", "targetPlatform": "<platform key, e.g.',
    'x>" }. The body must be ready to publish as-is.',
  ].join("\n");
}

/** Parse the agent's text into a proposal, tolerating noise; null on failure. */
function parseAgentResponse(raw: string): AutoresearchProposalData | null {
  const trimmed = raw.trim();
  const unfenced = FENCE_RE.exec(trimmed)?.[1] ?? trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const str = (key: string): string =>
    typeof record[key] === "string" ? (record[key] as string).trim() : "";
  const hook = str("hook");
  const body = str("body");
  // A proposal is only useful if it carries a body to publish; everything else
  // has a sensible fallback so a partial response still yields a runnable change.
  if (body.length === 0) {
    return null;
  }
  return {
    hook: hook.length > 0 ? hook : body.split("\n")[0],
    body,
    format: str("format") || "single",
    timing: str("timing") || "anytime",
    rationale: str("rationale"),
    targetPlatform: str("targetPlatform") || "x",
  };
}

/**
 * Ask the configured text-gen agent to propose the next content change.
 *
 * Never throws: returns `{ proposal, failure }`. A non-null `failure` means no
 * proposal was produced (the loop then records nothing and reports it).
 */
export async function proposeChange(
  strategy: AutoresearchStrategy,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<ProposeResult> {
  const { acpAgents, acpTextGenAgentId } = useAppSettingsStore.getState();
  const agent = acpTextGenAgentId
    ? acpAgents.find((candidate) => candidate.id === acpTextGenAgentId)
    : undefined;
  if (!agent) {
    return { proposal: null, failure: "no-agent" };
  }

  // Voice + winners condition the proposal; both are read defensively so a read
  // error degrades to an unconditioned (but still valid) proposal.
  let voice: VoiceProfileData | null = null;
  try {
    voice = await getVoiceProfile(workspaceId);
  } catch (error) {
    logger.error({ err: error }, "[Autoresearch] Failed to read voice profile");
  }

  let winners: ActivityItem[] = [];
  try {
    winners = await listActivityItems(workspaceId);
  } catch (error) {
    logger.error({ err: error }, "[Autoresearch] Failed to read activity");
  }

  // The loop's own past winners close the feedback loop: it learns from the
  // experiments it already ran, not just from organic activity.
  let experimentWinners: ExperimentWinner[] = [];
  try {
    experimentWinners = await listExperimentWinners(workspaceId);
  } catch (error) {
    logger.error(
      { err: error },
      "[Autoresearch] Failed to read experiment winners"
    );
  }

  let raw: string;
  try {
    raw = await acpPrompt(
      agent,
      buildPrompt(strategy, voice, winners, experimentWinners)
    );
  } catch (error) {
    logger.error({ err: error }, "[Autoresearch] Agent proposal failed");
    return { proposal: null, failure: "agent-error" };
  }

  const proposal = parseAgentResponse(raw);
  if (!proposal) {
    return { proposal: null, failure: "unparsable" };
  }
  return { proposal, failure: null };
}

/** A human-readable message for a proposal failure, for toasts. */
export function proposeFailureMessage(failure: ProposeFailure): string {
  switch (failure) {
    case "no-agent":
      return "Configure a text-generation agent in Settings to run the loop.";
    case "agent-error":
      return "The AI agent could not propose a change. Try again later.";
    default:
      return "Could not read the AI agent's response. Try again.";
  }
}
