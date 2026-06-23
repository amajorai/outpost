/**
 * ACP/Claude-backed per-platform reformatter (U15).
 *
 * Turns one composed draft into platform-native variants: given the draft text
 * and a set of target platforms, we ask the configured text-gen agent to rewrite
 * the post once per platform using that platform's context — character budget,
 * segment style (thread/carousel/single), and the live capability matrix.
 *
 * The agent returns free text, so we prompt for strict JSON keyed by platform and
 * parse defensively. Any throw, parse failure, or missing platform yields no
 * variant for that platform, so the caller keeps the original draft. This module
 * surfaces a typed result rather than throwing, and callers decide how to report
 * the difference (e.g. a sonner toast) — mirroring `lib/hashtags/agent.ts`.
 *
 * Settings are read via `useAppSettingsStore.getState()` rather than a hook
 * because this is a `lib/` service, not a React component.
 */

import { platformLabel } from "@/components/compose/platform-meta";
import { acpPrompt } from "@/lib/acp-client";
import { getPlatformLimits } from "@/lib/compose/platform-limits";
import { logger } from "@/lib/logger";
import type { CapabilityMatrix, Platform } from "@/lib/providers";
import { useAppSettingsStore } from "@/stores/use-app-settings-store";

/** Strip a leading/trailing markdown code fence the agent may wrap JSON in. */
const FENCE_RE = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

/** Why a reformat run produced no variants, for the caller to surface. */
export type ReformatFailure =
  | "no-agent"
  | "empty-draft"
  | "no-platforms"
  | "agent-error"
  | "unparsable";

/** The outcome of a reformat run: per-platform variant text, or a reason. */
export interface ReformatResult {
  /** Map of platform key -> rewritten variant text. May be partial. */
  variants: Record<string, string>;
  /** Set when the run produced no usable variants. */
  failure: ReformatFailure | null;
}

/** A short description of how a platform handles multiple segments. */
function segmentStyleHint(style: string): string {
  if (style === "thread") {
    return "supports threads (chained replies)";
  }
  if (style === "carousel") {
    return "supports carousels (multiple slides)";
  }
  return "is a single post (no threads or carousels)";
}

/** Describe one platform's native format so the agent can rewrite for it. */
function platformGuidance(
  platform: string,
  capabilities: CapabilityMatrix | null
): string {
  const limits = getPlatformLimits(platform);
  const styleHint = segmentStyleHint(limits.segmentStyle);
  const caps = capabilities?.[platform as Platform];
  const capHint = caps?.publish === false ? " (publishing not available)" : "";
  return [
    `- ${platformLabel(platform)} (key "${platform}"): keep the body within`,
    `${limits.maxChars.toLocaleString()} characters; this platform ${styleHint}.`,
    `Match its tone and conventions${capHint}.`,
  ].join(" ");
}

function buildPrompt(
  text: string,
  platforms: string[],
  capabilities: CapabilityMatrix | null
): string {
  const guidance = platforms
    .map((platform) => platformGuidance(platform, capabilities))
    .join("\n");
  return [
    "You are a social media editor. Rewrite the draft post below into a",
    "platform-native variant for each target platform, preserving the core",
    "message but adapting length, tone, formatting, and conventions.",
    "",
    "Target platforms:",
    guidance,
    "",
    "Respond with ONLY a JSON object, no prose and no code fences, mapping each",
    'platform key to its rewritten body string, e.g. { "x": "...", "linkedin":',
    '"..." }. Use the exact platform keys shown above. Do not exceed any',
    "platform's character limit.",
    "",
    "Draft post:",
    text,
  ].join("\n");
}

/** Parse the agent's text into a platform->variant map, tolerating noise. */
function parseAgentResponse(
  raw: string,
  platforms: string[]
): Record<string, string> | null {
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
  const variants: Record<string, string> = {};
  for (const platform of platforms) {
    const value = record[platform];
    if (typeof value === "string" && value.trim().length > 0) {
      variants[platform] = value.trim();
    }
  }
  return Object.keys(variants).length > 0 ? variants : null;
}

/**
 * Ask the configured text-gen agent to rewrite `text` for each platform.
 *
 * Never throws: returns `{ variants, failure }` so the caller can populate the
 * variants it got and keep the original draft for any platform left out. A
 * non-null `failure` means no variants were produced at all.
 */
export async function reformatForPlatforms(
  text: string,
  platforms: string[],
  capabilities: CapabilityMatrix | null
): Promise<ReformatResult> {
  if (text.trim().length === 0) {
    return { variants: {}, failure: "empty-draft" };
  }
  if (platforms.length === 0) {
    return { variants: {}, failure: "no-platforms" };
  }

  const { acpAgents, acpTextGenAgentId } = useAppSettingsStore.getState();
  const agent = acpTextGenAgentId
    ? acpAgents.find((candidate) => candidate.id === acpTextGenAgentId)
    : undefined;
  if (!agent) {
    return { variants: {}, failure: "no-agent" };
  }

  try {
    const raw = await acpPrompt(
      agent,
      buildPrompt(text, platforms, capabilities)
    );
    const variants = parseAgentResponse(raw, platforms);
    if (!variants) {
      return { variants: {}, failure: "unparsable" };
    }
    return { variants, failure: null };
  } catch (error) {
    logger.error({ err: error }, "[Reformat] Agent reformat failed");
    return { variants: {}, failure: "agent-error" };
  }
}

/** A human-readable message for a reformat failure, for toasts. */
export function reformatFailureMessage(failure: ReformatFailure): string {
  switch (failure) {
    case "no-agent":
      return "Configure a text-generation agent in Settings to reformat posts.";
    case "empty-draft":
      return "Write a draft before reformatting.";
    case "no-platforms":
      return "Select at least one target account to reformat for.";
    case "agent-error":
      return "The AI agent could not reformat the post. Keeping the original.";
    default:
      return "Could not read the AI agent's response. Keeping the original.";
  }
}
