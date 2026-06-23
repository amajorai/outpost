/**
 * ACP/Claude-backed inbox reply suggester (U22).
 *
 * For a selected engagement inbox item (comment, reply, mention, or DM) we ask
 * the configured text-gen agent to draft an on-brand reply in the user's voice.
 * Unlike the reformat flow (U15), which rewrites the user's own draft into
 * per-platform variants, this generates a *reply to* someone else's item: the
 * prompt carries the original author, kind, platform, and the item's text so the
 * agent can pick the right register (a DM reply reads differently than a public
 * mention) and stay within the platform's reply character budget.
 *
 * The agent returns free text, so we prompt for strict JSON (`{ "reply": "..." }`)
 * and parse defensively: any throw, parse failure, or empty result yields a typed
 * `failure` rather than an exception. The caller drops the suggestion into the
 * editable reply box, so the user can send it as-is or edit first — this module
 * never sends anything itself.
 *
 * Settings are read via `useAppSettingsStore.getState()` rather than a hook
 * because this is a `lib/` service, not a React component. Mirrors
 * `lib/compose/reformat.ts`.
 */

import { platformLabel } from "@/components/compose/platform-meta";
import { acpPrompt } from "@/lib/acp-client";
import { getPlatformLimits } from "@/lib/compose/platform-limits";
import { logger } from "@/lib/logger";
import {
  getVoiceProfile,
  type VoiceProfileData,
} from "@/lib/repos/voice-profile";
import type { InboxItem, InboxItemKind } from "@/lib/social-schema";
import { useAppSettingsStore } from "@/stores/use-app-settings-store";

/** Strip a leading/trailing markdown code fence the agent may wrap JSON in. */
const FENCE_RE = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

/** Why a suggestion run produced no reply, for the caller to surface. */
export type ReplySuggestFailure = "no-agent" | "agent-error" | "unparsable";

/** The outcome of a suggestion run: a reply string, or a reason it failed. */
export type ReplySuggestResult =
  | { reply: string; failure: null }
  | { reply: null; failure: ReplySuggestFailure };

/** A human-readable phrase for the kind of item being replied to. */
function kindPhrase(kind: InboxItemKind): string {
  switch (kind) {
    case "dm":
      return "direct message";
    case "mention":
      return "mention of you";
    case "reply":
      return "reply to your post";
    default:
      return "comment";
  }
}

/**
 * Build the voice-profile guidance block, or an empty string when no profile is
 * present. Absence must not change behavior (Data Versioning Contract), so when
 * there's no profile this contributes nothing to the prompt. Mirrors
 * `reformat.ts`'s `voiceGuidance`.
 */
function voiceGuidance(voice: VoiceProfileData | null): string {
  if (!voice) {
    return "";
  }
  const summary = voice.summary.trim();
  const traits = voice.traits.filter((trait) => trait.trim().length > 0);
  if (summary.length === 0 && traits.length === 0) {
    return "";
  }
  const lines = ["", "Write in this author's established voice:"];
  if (summary.length > 0) {
    lines.push(summary);
  }
  if (traits.length > 0) {
    lines.push(`Traits: ${traits.join("; ")}.`);
  }
  return lines.join("\n");
}

function buildPrompt(item: InboxItem, voice: VoiceProfileData | null): string {
  const limits = getPlatformLimits(item.platform);
  const isDm = item.kind === "dm";
  const channel = isDm
    ? "a private, one-to-one direct message"
    : "a public reply visible to others";
  return [
    `You are replying on ${platformLabel(item.platform)} on behalf of the`,
    "account owner. Draft a single, on-brand reply to the engagement item below.",
    `The item is ${kindPhrase(item.kind)} from "${item.author}". Your reply is`,
    `${channel}.`,
    "",
    "Guidelines:",
    `- Keep the reply within ${limits.maxChars.toLocaleString()} characters.`,
    "- Be helpful, warm, and authentic; respond directly to what they said.",
    "- Do not add hashtags or @-mentions unless they genuinely fit.",
    "- Match the platform's tone and conventions.",
    voiceGuidance(voice),
    "",
    "Respond with ONLY a JSON object, no prose and no code fences:",
    '{ "reply": "your reply text" }',
    "",
    `Item from ${item.author}:`,
    item.text,
  ].join("\n");
}

/** Parse the agent's text into a reply string, tolerating fences and noise. */
function parseAgentResponse(raw: string): string | null {
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
  const value = (parsed as Record<string, unknown>).reply;
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  return value.trim();
}

/**
 * Ask the configured text-gen agent to draft a reply to `item`, conditioned on
 * the workspace's learned voice profile.
 *
 * Never throws: returns `{ reply, failure }` so the caller can drop a non-null
 * reply into the editable reply box or surface the failure as a toast. A
 * non-null `failure` means no reply was produced.
 */
export async function suggestReply(
  item: InboxItem
): Promise<ReplySuggestResult> {
  const { acpAgents, acpTextGenAgentId } = useAppSettingsStore.getState();
  const agent = acpTextGenAgentId
    ? acpAgents.find((candidate) => candidate.id === acpTextGenAgentId)
    : undefined;
  if (!agent) {
    return { reply: null, failure: "no-agent" };
  }

  // Read the learned voice profile defensively: when present it conditions the
  // reply; when absent (or on any read error) behavior is unchanged. The item
  // carries its workspace, so scope the lookup to it rather than the default.
  let voice: VoiceProfileData | null = null;
  try {
    voice = await getVoiceProfile(item.workspaceId);
  } catch (error) {
    logger.error({ err: error }, "[ReplySuggest] Failed to read voice profile");
  }

  try {
    const raw = await acpPrompt(agent, buildPrompt(item, voice));
    const reply = parseAgentResponse(raw);
    if (!reply) {
      return { reply: null, failure: "unparsable" };
    }
    return { reply, failure: null };
  } catch (error) {
    logger.error({ err: error }, "[ReplySuggest] Agent suggestion failed");
    return { reply: null, failure: "agent-error" };
  }
}

/** A human-readable message for a suggestion failure, for toasts. */
export function replySuggestFailureMessage(
  failure: ReplySuggestFailure
): string {
  switch (failure) {
    case "no-agent":
      return "Configure a text-generation agent in Settings to suggest replies.";
    case "agent-error":
      return "The AI agent could not draft a reply. Try again or write your own.";
    default:
      return "Could not read the AI agent's response. Try again or write your own.";
  }
}
