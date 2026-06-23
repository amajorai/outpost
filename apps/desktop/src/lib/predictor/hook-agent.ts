/**
 * Optional ACP/Claude-backed hook assessment for the predictor (U24).
 *
 * The live score is the synchronous heuristic in `score.ts`. This module is the
 * augmentation: when the user has a text-gen agent configured, we ask it to
 * rate the draft's hook strength as a single 0..1 number. The result is cached
 * by text so a live recompute can read it back without re-spawning the agent —
 * the agent never sits on the keystroke path.
 *
 * Like the hashtags agent, this never throws to its caller: any missing agent,
 * error, or unparsable response yields `null`, and the scorer simply uses its
 * own heuristic hook fraction.
 *
 * Settings are read via `useAppSettingsStore.getState()` rather than a hook
 * because this is a `lib/` service, not a React component.
 */

import { acpPrompt } from "@/lib/acp-client";
import { logger } from "@/lib/logger";
import { useAppSettingsStore } from "@/stores/use-app-settings-store";

/** In-memory cache of agent hook assessments, keyed by a hash of the text. */
const cache = new Map<string, number>();

/** Top-level literal: first number-like token in the agent reply. */
const NUMBER_RE = /-?\d+(?:\.\d+)?/;

const HASH_MODULUS = 2_147_483_647;
const HASH_PRIME = 131;

/** Small non-cryptographic rolling hash for the cache key (see hashtags/cache). */
function hashText(text: string): string {
  let hash = 0;
  for (const char of text) {
    hash = (hash * HASH_PRIME + char.charCodeAt(0)) % HASH_MODULUS;
  }
  return hash.toString(36);
}

/** Read a cached hook fraction for this exact text, or undefined on a miss. */
export function getCachedHookFraction(text: string): number | undefined {
  return cache.get(hashText(text.trim()));
}

/** Drop all cached hook assessments (e.g. when the agent config changes). */
export function clearHookCache(): void {
  cache.clear();
}

function buildPrompt(text: string): string {
  return [
    "You are a social media editor judging how strong a post's opening hook is.",
    "A strong hook stops the scroll: it sparks curiosity, makes a bold claim,",
    "asks a sharp question, or promises concrete value in the first line.",
    "",
    "Rate the hook strength of the draft below. Respond with ONLY a single",
    "number between 0 and 1 (e.g. 0.8), no prose, no code fences. 0 = no hook,",
    "1 = an exceptional scroll-stopping opening.",
    "",
    "Draft post:",
    text,
  ].join("\n");
}

/** Parse the agent's reply into a 0..1 fraction, or null when unusable. */
function parseFraction(raw: string): number | null {
  const match = NUMBER_RE.exec(raw.trim());
  if (!match) {
    return null;
  }
  const value = Number.parseFloat(match[0]);
  if (Number.isNaN(value)) {
    return null;
  }
  return Math.max(0, Math.min(1, value));
}

/**
 * Ask the configured text-gen agent to assess the draft's hook strength.
 *
 * Returns the 0..1 fraction (also cached for the live scorer), or `null` when
 * no agent is configured, the agent errors, or the reply can't be parsed. Safe
 * to call off the keystroke path (debounced or on an explicit refine action).
 */
export async function assessHookStrength(text: string): Promise<number | null> {
  if (text.trim().length === 0) {
    return null;
  }
  const cached = getCachedHookFraction(text);
  if (cached !== undefined) {
    return cached;
  }

  const { acpAgents, acpTextGenAgentId } = useAppSettingsStore.getState();
  const agent = acpTextGenAgentId
    ? acpAgents.find((candidate) => candidate.id === acpTextGenAgentId)
    : undefined;
  if (!agent) {
    return null;
  }

  try {
    const raw = await acpPrompt(agent, buildPrompt(text));
    const fraction = parseFraction(raw);
    if (fraction === null) {
      return null;
    }
    cache.set(hashText(text.trim()), fraction);
    return fraction;
  } catch (error) {
    logger.error({ err: error }, "[Predictor] Hook assessment failed");
    return null;
  }
}
