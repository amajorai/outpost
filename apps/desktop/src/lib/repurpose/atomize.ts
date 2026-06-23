/**
 * ACP/Claude-backed long-form repurposer / atomizer (U17).
 *
 * Takes one long-form input (a YouTube transcript, blog post, or podcast text)
 * and asks the configured text-gen agent to "atomize" it into many short,
 * platform-native posts plus a suggested set of clip ideas. This is the inverse
 * of {@link lib/compose/reformat}: reformat adapts one finished post per
 * platform, while atomize mines a long source for many distinct posts.
 *
 * The agent returns free text, so we prompt for strict JSON and parse it
 * defensively, mirroring the never-throw contract of `reformat.ts`: any throw,
 * parse failure, or unknown platform yields fewer (or zero) posts rather than an
 * exception. The caller decides how to report a `failure` (e.g. a sonner toast).
 *
 * Settings are read via `useAppSettingsStore.getState()` rather than a hook
 * because this is a `lib/` service, not a React component.
 */

import { platformLabel } from "@/components/compose/platform-meta";
import { acpPrompt } from "@/lib/acp-client";
import {
  getPlatformLimits,
  type SegmentStyle,
} from "@/lib/compose/platform-limits";
import { logger } from "@/lib/logger";
import {
  type CapabilityMatrix,
  PLATFORMS,
  type Platform,
} from "@/lib/providers";
import {
  getVoiceProfile,
  type VoiceProfileData,
} from "@/lib/repos/voice-profile";
import { useAppSettingsStore } from "@/stores/use-app-settings-store";

/** Strip a leading/trailing markdown code fence the agent may wrap JSON in. */
const FENCE_RE = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

/** Known platform keys, for validating the agent's claimed platform. */
const KNOWN_PLATFORMS = new Set<string>(PLATFORMS);

/** Why an atomize run produced no usable output, for the caller to surface. */
export type AtomizeFailure =
  | "no-agent"
  | "empty-input"
  | "no-platforms"
  | "agent-error"
  | "unparsable";

/** One generated platform-native post: an ordered list of segments. */
export interface AtomizedPost {
  /** The target platform this post is written for. */
  platform: Platform;
  /**
   * Ordered segments. Length >= 1. A single entry is a standalone post; multiple
   * entries are a thread (X/Threads/Bluesky) or carousel slides. Media is always
   * empty since the agent only produces text.
   */
  segments: { text: string }[];
}

/** The outcome of an atomize run. */
export interface AtomizeResult {
  /** Generated platform-native posts. May be empty. */
  posts: AtomizedPost[];
  /** Suggested clip / highlight ideas mined from the source. May be empty. */
  clipIdeas: string[];
  /** Set when the run produced no usable posts at all. */
  failure: AtomizeFailure | null;
}

/** A short description of how a platform handles multiple segments. */
function segmentStyleHint(style: SegmentStyle): string {
  if (style === "thread") {
    return "supports threads, so break long ideas into a chain of posts";
  }
  if (style === "carousel") {
    return "supports carousels, so a multi-slide post works well";
  }
  return "is a single standalone post (no threads or carousels)";
}

/** Describe one platform's native format so the agent can write for it. */
function platformGuidance(
  platform: string,
  capabilities: CapabilityMatrix | null
): string {
  const limits = getPlatformLimits(platform);
  const styleHint = segmentStyleHint(limits.segmentStyle);
  const caps = capabilities?.[platform as Platform];
  const capHint = caps?.publish === false ? " (publishing not available)" : "";
  return [
    `- ${platformLabel(platform)} (key "${platform}"): keep each segment within`,
    `${limits.maxChars.toLocaleString()} characters; this platform ${styleHint}.`,
    `Match its tone and conventions${capHint}.`,
  ].join(" ");
}

/**
 * Build the voice-profile guidance block, or an empty string when no profile is
 * present. Absence must not change behavior (Data Versioning Contract), so when
 * there's no profile this contributes nothing to the prompt.
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
  text: string,
  platforms: string[],
  capabilities: CapabilityMatrix | null,
  voice: VoiceProfileData | null
): string {
  const guidance = platforms
    .map((platform) => platformGuidance(platform, capabilities))
    .join("\n");
  return [
    "You are a social media editor. Repurpose the long-form source below into",
    "many short, platform-native posts. Mine it for distinct hooks, takeaways,",
    "and quotable moments. Produce SEVERAL posts per platform, not one.",
    "",
    "Target platforms:",
    guidance,
    voiceGuidance(voice),
    "",
    "Respond with ONLY a JSON object, no prose and no code fences, shaped like:",
    '{ "posts": [ { "platform": "x", "segments": ["first post", "reply"] } ],',
    '  "clipIdeas": ["a short description of a clip-worthy moment"] }',
    "",
    'Use the exact platform keys shown above. Each post\'s "segments" is an',
    "ordered array of strings: one entry for a standalone post, or several for a",
    "thread/carousel. Never exceed a platform's character limit per segment.",
    '"clipIdeas" lists short video/audio clip suggestions drawn from the source.',
    "",
    "Long-form source:",
    text,
  ].join("\n");
}

/** Coerce one segment list into a non-empty array of `{ text }`. */
function coerceSegments(value: unknown): { text: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const segments: { text: string }[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      segments.push({ text: entry.trim() });
    }
  }
  return segments;
}

/** Coerce one raw post object into a typed {@link AtomizedPost}, or null. */
function coercePost(raw: unknown): AtomizedPost | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const platform = record.platform;
  if (typeof platform !== "string" || !KNOWN_PLATFORMS.has(platform)) {
    return null;
  }
  const segments = coerceSegments(record.segments);
  if (segments.length === 0) {
    return null;
  }
  return { platform: platform as Platform, segments };
}

/** Coerce the agent's clip-idea list into trimmed, non-empty strings. */
function coerceClipIdeas(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ideas: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      ideas.push(entry.trim());
    }
  }
  return ideas;
}

/** Parse the agent's text into posts + clip ideas, tolerating noise. */
function parseAgentResponse(
  raw: string
): Omit<AtomizeResult, "failure"> | null {
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
  const rawPosts = Array.isArray(record.posts) ? record.posts : [];
  const posts: AtomizedPost[] = [];
  for (const rawPost of rawPosts) {
    const post = coercePost(rawPost);
    if (post) {
      posts.push(post);
    }
  }
  return { posts, clipIdeas: coerceClipIdeas(record.clipIdeas) };
}

/**
 * Ask the configured text-gen agent to atomize `text` into platform-native posts.
 *
 * Never throws: returns `{ posts, clipIdeas, failure }`. A non-null `failure`
 * means no posts were produced; clip ideas may still be present on success.
 */
export async function atomizeLongForm(
  text: string,
  platforms: string[],
  capabilities: CapabilityMatrix | null
): Promise<AtomizeResult> {
  if (text.trim().length === 0) {
    return { posts: [], clipIdeas: [], failure: "empty-input" };
  }
  if (platforms.length === 0) {
    return { posts: [], clipIdeas: [], failure: "no-platforms" };
  }

  const { acpAgents, acpTextGenAgentId } = useAppSettingsStore.getState();
  const agent = acpTextGenAgentId
    ? acpAgents.find((candidate) => candidate.id === acpTextGenAgentId)
    : undefined;
  if (!agent) {
    return { posts: [], clipIdeas: [], failure: "no-agent" };
  }

  // Fetch the learned voice profile defensively: when present it conditions the
  // output; when absent (or on any read error) behavior is unchanged.
  let voice: VoiceProfileData | null = null;
  try {
    voice = await getVoiceProfile();
  } catch (error) {
    logger.error({ err: error }, "[Atomize] Failed to read voice profile");
  }

  try {
    const raw = await acpPrompt(
      agent,
      buildPrompt(text, platforms, capabilities, voice)
    );
    const parsed = parseAgentResponse(raw);
    if (!parsed) {
      return { posts: [], clipIdeas: [], failure: "unparsable" };
    }
    if (parsed.posts.length === 0) {
      return {
        posts: [],
        clipIdeas: parsed.clipIdeas,
        failure: "unparsable",
      };
    }
    return { posts: parsed.posts, clipIdeas: parsed.clipIdeas, failure: null };
  } catch (error) {
    logger.error({ err: error }, "[Atomize] Agent atomize failed");
    return { posts: [], clipIdeas: [], failure: "agent-error" };
  }
}

/** A human-readable message for an atomize failure, for toasts. */
export function atomizeFailureMessage(failure: AtomizeFailure): string {
  switch (failure) {
    case "no-agent":
      return "Configure a text-generation agent in Settings to repurpose content.";
    case "empty-input":
      return "Paste or import some long-form text to repurpose.";
    case "no-platforms":
      return "Select at least one target platform to repurpose for.";
    case "agent-error":
      return "The AI agent could not repurpose this content. Try again.";
    default:
      return "Could not read the AI agent's response. Try again.";
  }
}
