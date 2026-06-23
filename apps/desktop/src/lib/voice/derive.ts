/**
 * ACP/Claude-backed voice/style learning (U16).
 *
 * Derives a "voice profile" from the user's past posts: gathers the text of
 * their drafts and published activity, then asks the configured text-gen agent
 * to summarize the writing voice (tone, typical length, emoji use, hook
 * patterns) as strict JSON. The parsed profile is persisted via
 * `lib/repos/voice-profile.ts` and later injected into AI prompts (the reformat
 * flow) when present.
 *
 * Mirrors `lib/compose/reformat.ts`: reads agent config via the settings store
 * (this is a `lib/` service, not a component), prompts for strict JSON, parses
 * defensively, and surfaces a typed failure rather than throwing.
 *
 * Note on sources: `post_history` has no text column, so past-post text comes
 * from `drafts` (decoded body text) and `activity_items.text`. Both are
 * workspace-scoped.
 */

import { acpPrompt } from "@/lib/acp-client";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { decodeDraftBody, listDrafts } from "@/lib/repos/drafts";
import {
  saveVoiceProfile,
  VOICE_PROFILE_SCHEMA_VERSION,
  type VoiceProfileData,
} from "@/lib/repos/voice-profile";
import { useAppSettingsStore } from "@/stores/use-app-settings-store";

/** Strip a leading/trailing markdown code fence the agent may wrap JSON in. */
const FENCE_RE = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

/** The fewest past posts we need before a derivation is worthwhile. */
const MIN_SAMPLES = 3;

/** The most posts we feed the agent, newest first, to bound the prompt size. */
const MAX_SAMPLES = 40;

/** Why a voice-derivation run produced no profile, for the caller to surface. */
export type VoiceDeriveFailure =
  | "no-agent"
  | "not-enough-posts"
  | "agent-error"
  | "unparsable";

/** The outcome of a derivation run: the saved profile, or a reason. */
export interface VoiceDeriveResult {
  /** The derived-and-persisted profile, or null when the run failed. */
  profile: VoiceProfileData | null;
  /** Set when the run produced no profile. */
  failure: VoiceDeriveFailure | null;
}

/** Read the `text` of past activity items for a workspace, newest first. */
async function listActivityText(workspaceId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ text: string | null }[]>(
    "SELECT text FROM activity_items WHERE workspace_id = $1 ORDER BY published_at DESC LIMIT $2",
    [workspaceId, MAX_SAMPLES]
  );
  return rows
    .map((row) => (typeof row.text === "string" ? row.text.trim() : ""))
    .filter((text) => text.length > 0);
}

/** Gather past-post text from drafts + published activity, deduped, newest first. */
async function gatherPastPosts(workspaceId: string): Promise<string[]> {
  const drafts = await listDrafts(workspaceId);
  const draftText = drafts
    .map((draft) => decodeDraftBody(draft.body).text.trim())
    .filter((text) => text.length > 0);
  const activityText = await listActivityText(workspaceId);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of [...activityText, ...draftText]) {
    if (seen.has(text)) {
      continue;
    }
    seen.add(text);
    out.push(text);
    if (out.length >= MAX_SAMPLES) {
      break;
    }
  }
  return out;
}

function buildPrompt(posts: string[]): string {
  const samples = posts
    .map((post, index) => `Post ${index + 1}:\n${post}`)
    .join("\n\n");
  return [
    "You are a writing-style analyst. Below are a social media author's past",
    "posts. Study them and describe the author's writing voice so another writer",
    "could imitate it: tone, typical post length, sentence structure, emoji and",
    "punctuation habits, and how they open posts (hook patterns).",
    "",
    "Respond with ONLY a JSON object, no prose and no code fences, of the form:",
    '{ "summary": "<2-4 sentence description of the voice>", "traits": ["<short',
    'trait>", "..."] }. Keep traits concise (a few words each) and limit to at',
    "most 8 traits.",
    "",
    "Past posts:",
    samples,
  ].join("\n");
}

/** Parse the agent's text into a {summary, traits} pair, tolerating noise. */
function parseAgentResponse(
  raw: string
): { summary: string; traits: string[] } | null {
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
  const summary =
    typeof record.summary === "string" ? record.summary.trim() : "";
  const traits = Array.isArray(record.traits)
    ? record.traits
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .slice(0, 8)
    : [];
  if (summary.length === 0 && traits.length === 0) {
    return null;
  }
  return { summary, traits };
}

/**
 * Derive and persist the workspace's voice profile from its past posts.
 *
 * Never throws: returns `{ profile, failure }` so the caller can surface a
 * toast. A non-null `failure` means nothing was persisted and any existing
 * profile is left untouched.
 */
export async function deriveVoiceProfile(
  workspaceId: string = getCurrentWorkspaceId()
): Promise<VoiceDeriveResult> {
  const { acpAgents, acpTextGenAgentId } = useAppSettingsStore.getState();
  const agent = acpTextGenAgentId
    ? acpAgents.find((candidate) => candidate.id === acpTextGenAgentId)
    : undefined;
  if (!agent) {
    return { profile: null, failure: "no-agent" };
  }

  const posts = await gatherPastPosts(workspaceId);
  if (posts.length < MIN_SAMPLES) {
    return { profile: null, failure: "not-enough-posts" };
  }

  let raw: string;
  try {
    raw = await acpPrompt(agent, buildPrompt(posts));
  } catch (error) {
    logger.error({ err: error }, "[Voice] Agent derivation failed");
    return { profile: null, failure: "agent-error" };
  }

  const parsed = parseAgentResponse(raw);
  if (!parsed) {
    return { profile: null, failure: "unparsable" };
  }

  const data: VoiceProfileData = {
    schemaVersion: VOICE_PROFILE_SCHEMA_VERSION,
    summary: parsed.summary,
    traits: parsed.traits,
    sampleCount: posts.length,
    derivedAt: Date.now(),
  };

  try {
    await saveVoiceProfile(data, workspaceId);
  } catch (error) {
    logger.error({ err: error }, "[Voice] Failed to persist profile");
    return { profile: null, failure: "agent-error" };
  }

  return { profile: data, failure: null };
}

/** A human-readable message for a derivation failure, for toasts. */
export function voiceDeriveFailureMessage(failure: VoiceDeriveFailure): string {
  switch (failure) {
    case "no-agent":
      return "Configure a text-generation agent in Settings to learn your voice.";
    case "not-enough-posts":
      return `Write at least ${MIN_SAMPLES} posts so Outpost can learn your voice.`;
    case "agent-error":
      return "The AI agent could not analyze your posts. Try again later.";
    default:
      return "Could not read the AI agent's response. Try again.";
  }
}
