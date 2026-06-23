/**
 * ACP/Claude-backed hashtag suggester (U14).
 *
 * When the user has configured a text-generation agent (Settings -> ACP), we ask
 * it for context-aware suggestions with reach/competition signal. The agent
 * returns free text, so we prompt for strict JSON and parse defensively: any
 * throw, parse failure, or empty/malformed result returns `null` so the service
 * falls back to the local heuristic. This module never throws to its caller.
 *
 * Settings are read via `useAppSettingsStore.getState()` rather than a hook
 * because this is a `lib/` service, not a React component.
 */

import { platformLabel } from "@/components/compose/platform-meta";
import { acpPrompt } from "@/lib/acp-client";
import { logger } from "@/lib/logger";
import { useAppSettingsStore } from "@/stores/use-app-settings-store";
import type { HashtagSuggestion, SuggestionKind } from "./types";

/** Strip a leading/trailing markdown code fence the agent may wrap JSON in. */
const FENCE_RE = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

/** Cap on how many suggestions we keep from an agent response. */
const MAX_FROM_AGENT = 10;

/** Clamp a value to the 0-100 signal range, or undefined when not a number. */
function clampSignal(value: unknown): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Coerce one raw JSON entry into a `HashtagSuggestion`, or null if unusable. */
function coerceSuggestion(entry: unknown): HashtagSuggestion | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const rawValue = record.value;
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return null;
  }
  const value = rawValue.trim();
  const kind: SuggestionKind = value.startsWith("#") ? "hashtag" : "keyword";
  return {
    value,
    kind,
    reach: clampSignal(record.reach),
    competition: clampSignal(record.competition),
  };
}

/** Parse the agent's text into suggestions, tolerating fences and noise. */
function parseAgentResponse(raw: string): HashtagSuggestion[] | null {
  const trimmed = raw.trim();
  const unfenced = FENCE_RE.exec(trimmed)?.[1] ?? trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as Record<string, unknown>)?.suggestions;
  if (!Array.isArray(list)) {
    return null;
  }
  const suggestions: HashtagSuggestion[] = [];
  for (const entry of list) {
    const coerced = coerceSuggestion(entry);
    if (coerced) {
      suggestions.push(coerced);
    }
    if (suggestions.length >= MAX_FROM_AGENT) {
      break;
    }
  }
  return suggestions.length > 0 ? suggestions : null;
}

function buildPrompt(platform: string, text: string): string {
  return [
    `You are a social media research assistant for ${platformLabel(platform)}.`,
    "Given the draft post below, suggest the most effective hashtags and",
    "keywords to maximize reach. Respond with ONLY a JSON array, no prose, no",
    "code fences. Each item is an object:",
    '{ "value": string, "reach": number, "competition": number }',
    "where value includes a leading # for hashtags or is a bare phrase for",
    "keywords, reach is 0-100 (higher = broader audience), and competition is",
    "0-100 (higher = more crowded). Return at most 10 items.",
    "",
    "Draft post:",
    text,
  ].join("\n");
}

/**
 * Ask the configured text-gen agent for suggestions. Returns `null` when no
 * agent is configured, the agent errors, or the response can't be parsed —
 * signalling the service to use the heuristic instead.
 */
export async function agentSuggestions(
  platform: string,
  text: string
): Promise<HashtagSuggestion[] | null> {
  const { acpAgents, acpTextGenAgentId } = useAppSettingsStore.getState();
  if (!acpTextGenAgentId) {
    return null;
  }
  const agent = acpAgents.find(
    (candidate) => candidate.id === acpTextGenAgentId
  );
  if (!agent) {
    return null;
  }

  try {
    const raw = await acpPrompt(agent, buildPrompt(platform, text));
    return parseAgentResponse(raw);
  } catch (error) {
    logger.error({ err: error }, "[Hashtags] Agent suggestion failed");
    return null;
  }
}
