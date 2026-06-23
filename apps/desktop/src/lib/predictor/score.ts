/**
 * The pure performance scorer (U24).
 *
 * Synchronous and side-effect free: draft text + media + target platform +
 * (optional) learned history + (optional) schedule time + (optional) agent hook
 * assessment in, a {@link PerformancePrediction} out. This is the authoritative
 * live score — the composer recomputes it on every edit, so it must never
 * `await` anything. The ACP agent only *augments* the hook sub-score by passing
 * a cached `hookOverride`; it never gates or resets the number.
 *
 * Scoring is additive across five factors that sum to 100:
 *   - Hook strength (30): does the opening earn a stop?
 *   - Length fit (25): is the body well-sized for the platform's budget?
 *   - Hashtag use (15): present, platform-appropriate, not spammy?
 *   - Posting-time fit (20): does the schedule hit the user's best window?
 *   - Media (10): does the post carry an image/video?
 *
 * Every factor degrades to a neutral-positive default when its input is absent,
 * so a missing signal never tanks the score (Data Versioning Contract spirit:
 * absence is the old default, not a penalty).
 */

import type { MediaAttachment } from "@/lib/compose/platform-limits";
import { getPlatformLimits } from "@/lib/compose/platform-limits";
import { MIN_HISTORY_SAMPLE } from "./history";
import type {
  PerformancePrediction,
  PlatformHistory,
  ScoreFactor,
} from "./types";

const HOOK_MAX = 30;
const LENGTH_MAX = 25;
const HASHTAG_MAX = 15;
const TIMING_MAX = 20;
const MEDIA_MAX = 10;

/** Top-level literals (lint/performance: no regex construction per call). */
const HASHTAG_GLOBAL_RE = /(^|\s)#[a-z0-9_]+/gi;
const FIRST_LINE_RE = /^[^\n]*/;
const HOOK_NUMBER_RE = /\d/;
const HOOK_QUESTION_RE = /\?/;
/** Words that signal a strong, curiosity-driving opening. */
const HOOK_TRIGGER_RE =
  /\b(how|why|what|stop|never|always|secret|mistake|nobody|everyone|here's|here is)\b/i;

/** Clamp to the 0-100 integer range. */
function clamp100(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Count `#hashtag` tokens in the text. */
function countHashtags(text: string): number {
  const matches = text.match(HASHTAG_GLOBAL_RE);
  return matches ? matches.length : 0;
}

/** The first non-empty line of the body, trimmed — the post's hook. */
function firstLine(text: string): string {
  return (FIRST_LINE_RE.exec(text.trimStart())?.[0] ?? "").trim();
}

/**
 * Heuristic hook strength as a 0..1 fraction. Rewards a punchy first line that
 * isn't too long and uses at least one curiosity device (a question, a concrete
 * number, or a known hook word). When the agent supplied an assessment we use
 * that instead — it sees nuance the heuristic can't.
 */
const HOOK_IDEAL_MAX_CHARS = 90;
const HOOK_TOO_LONG_CHARS = 200;

function heuristicHookFraction(text: string): number {
  const hook = firstLine(text);
  if (hook.length === 0) {
    return 0;
  }
  let fraction = 0.4;
  if (hook.length <= HOOK_IDEAL_MAX_CHARS) {
    fraction += 0.25;
  } else if (hook.length >= HOOK_TOO_LONG_CHARS) {
    fraction -= 0.2;
  }
  let devices = 0;
  if (HOOK_QUESTION_RE.test(hook)) {
    devices += 1;
  }
  if (HOOK_NUMBER_RE.test(hook)) {
    devices += 1;
  }
  if (HOOK_TRIGGER_RE.test(hook)) {
    devices += 1;
  }
  fraction += Math.min(devices, 2) * 0.15;
  return Math.max(0, Math.min(1, fraction));
}

function hookFactor(text: string, hookOverride: number | null): ScoreFactor {
  const fraction =
    hookOverride === null
      ? heuristicHookFraction(text)
      : Math.max(0, Math.min(1, hookOverride));
  const points = Math.round(fraction * HOOK_MAX);
  let detail: string;
  if (fraction >= 0.75) {
    detail = "Opening earns attention.";
  } else if (fraction >= 0.45) {
    detail = "Decent opening; a sharper first line would help.";
  } else {
    detail = "Weak hook — lead with a question, number, or bold claim.";
  }
  if (hookOverride !== null) {
    detail = `${detail} (AI-assessed)`;
  }
  return {
    key: "hook",
    label: "Hook strength",
    points,
    maxPoints: HOOK_MAX,
    detail,
  };
}

/**
 * Length fit. When history gives a best-performing length we score proximity to
 * it; otherwise we score the body filling a healthy share of the platform's
 * character budget (too short reads thin, over the limit is unpublishable).
 */
const SHORT_LENGTH_FRACTION = 0.05;
const HEALTHY_LENGTH_FRACTION = 0.3;

/**
 * How far the body can deviate from the learned band (as a fraction of the
 * band) and still score full marks. Beyond this the score falls off gently
 * rather than off a cliff — the band is an average of past posts, not a target.
 */
const LENGTH_BAND_TOLERANCE = 0.5;
const LENGTH_FALLOFF = 1.5;
const LENGTH_BAND_MIN_FRACTION = 0.4;

function bandLengthFraction(length: number, band: number): number {
  const deviation = Math.abs(length - band) / band;
  if (deviation <= LENGTH_BAND_TOLERANCE) {
    return 1;
  }
  return Math.max(
    LENGTH_BAND_MIN_FRACTION,
    1 - (deviation - LENGTH_BAND_TOLERANCE) / LENGTH_FALLOFF
  );
}

function lengthFactor(
  text: string,
  platform: string,
  history: PlatformHistory | undefined
): ScoreFactor {
  const limits = getPlatformLimits(platform);
  const length = text.trim().length;
  let fraction: number;
  let detail: string;

  if (length > limits.maxChars) {
    fraction = 0;
    detail = `Over the ${limits.maxChars.toLocaleString()}-char limit.`;
  } else if (history?.bestLength != null && history.bestLength > 0) {
    fraction = bandLengthFraction(length, history.bestLength);
    detail = `Your best posts run ~${history.bestLength} chars; this is ${length}.`;
  } else {
    const budget = length / limits.maxChars;
    if (budget < SHORT_LENGTH_FRACTION) {
      fraction = budget / SHORT_LENGTH_FRACTION;
      detail = "Quite short — add a little more substance.";
    } else if (budget < HEALTHY_LENGTH_FRACTION) {
      fraction = 1;
      detail = "Good length for the platform.";
    } else {
      fraction = Math.max(0.5, 1 - (budget - HEALTHY_LENGTH_FRACTION));
      detail = "On the long side for this platform.";
    }
  }
  return {
    key: "length",
    label: "Length fit",
    points: Math.round(Math.max(0, Math.min(1, fraction)) * LENGTH_MAX),
    maxPoints: LENGTH_MAX,
    detail,
  };
}

/**
 * Hashtag use. A small number of hashtags reads as discoverable; zero on a
 * tag-driven platform is a missed reach lever; a wall of tags reads as spam.
 * When history shows hashtags helped, having at least one scores full marks.
 */
const HASHTAG_HEAVY = new Set(["instagram", "tiktok", "threads", "x"]);
const HASHTAG_SPAM_COUNT = 8;

function hashtagFactor(
  text: string,
  platform: string,
  history: PlatformHistory | undefined
): ScoreFactor {
  const count = countHashtags(text);
  const tagDriven =
    HASHTAG_HEAVY.has(platform) || history?.hashtagsHelp === true;
  let fraction: number;
  let detail: string;

  if (count === 0) {
    fraction = tagDriven ? 0.3 : 0.8;
    detail = tagDriven
      ? "No hashtags — add 1-2 to aid discovery."
      : "No hashtags needed here.";
  } else if (count >= HASHTAG_SPAM_COUNT) {
    fraction = 0.3;
    detail = `${count} hashtags reads as spam — trim to a few.`;
  } else {
    fraction = 1;
    detail = `${count} hashtag${count === 1 ? "" : "s"} — looks healthy.`;
  }
  return {
    key: "hashtags",
    label: "Hashtag use",
    points: Math.round(fraction * HASHTAG_MAX),
    maxPoints: HASHTAG_MAX,
    detail,
  };
}

/**
 * Posting-time fit. Scored only when both a schedule time and learned best
 * hours are present; otherwise it contributes a neutral default so an unknown
 * time never penalizes the post.
 */
const TIMING_NEUTRAL_FRACTION = 0.6;
const TIMING_NEAR_HOURS = 1;

function timingFactor(
  scheduledFor: number | null,
  history: PlatformHistory | undefined
): ScoreFactor {
  const bestHours = history?.bestHours ?? [];
  if (scheduledFor === null || bestHours.length === 0) {
    return {
      key: "timing",
      label: "Posting time",
      points: Math.round(TIMING_NEUTRAL_FRACTION * TIMING_MAX),
      maxPoints: TIMING_MAX,
      detail:
        bestHours.length === 0
          ? "Not enough history to judge timing."
          : "No schedule time set yet.",
    };
  }
  const hour = new Date(scheduledFor).getHours();
  const distance = Math.min(
    ...bestHours.map((best) => {
      const raw = Math.abs(best - hour);
      return Math.min(raw, 24 - raw);
    })
  );
  let fraction: number;
  let detail: string;
  if (distance === 0) {
    fraction = 1;
    detail = "Right in your best-performing window.";
  } else if (distance <= TIMING_NEAR_HOURS) {
    fraction = 0.8;
    detail = "Close to your best-performing window.";
  } else {
    fraction = Math.max(0.3, 1 - distance / 12);
    detail = `Best hours are around ${bestHours[0]}:00; this posts at ${hour}:00.`;
  }
  return {
    key: "timing",
    label: "Posting time",
    points: Math.round(fraction * TIMING_MAX),
    maxPoints: TIMING_MAX,
    detail,
  };
}

/** Media presence. Posts with an image/video tend to out-perform text-only. */
function mediaFactor(media: readonly MediaAttachment[]): ScoreFactor {
  const has = media.length > 0;
  return {
    key: "media",
    label: "Media",
    points: has ? MEDIA_MAX : Math.round(MEDIA_MAX * 0.4),
    maxPoints: MEDIA_MAX,
    detail: has ? "Includes media." : "Text-only — media usually lifts reach.",
  };
}

/** Inputs to a single prediction. */
export interface ScoreInput {
  platform: string;
  text: string;
  media: readonly MediaAttachment[];
  /** Learned history for this platform, or undefined when none. */
  history?: PlatformHistory;
  /** Planned publish time (epoch millis), or null when not scheduled. */
  scheduledFor?: number | null;
  /**
   * An AI-assessed hook strength as a 0..1 fraction, when the agent has run for
   * this exact text (served from cache). Null = use the heuristic. Never fetched
   * on the live path.
   */
  hookOverride?: number | null;
}

/** Build the one-line rationale from the scored factors. */
function buildRationale(
  factors: ScoreFactor[],
  basis: PerformancePrediction["basis"]
): string {
  const sorted = [...factors].sort(
    (a, b) => b.points / b.maxPoints - a.points / a.maxPoints
  );
  const strongest = sorted[0];
  const weakest = sorted.at(-1);
  const parts: string[] = [];
  if (strongest && strongest.points / strongest.maxPoints >= 0.6) {
    parts.push(`${strongest.label.toLowerCase()} is strong`);
  }
  if (weakest && weakest.points / weakest.maxPoints < 0.5) {
    parts.push(`${weakest.label.toLowerCase()} needs work`);
  }
  const lead =
    parts.length > 0
      ? `${parts.join("; ")}.`
      : "A balanced post with no standout strengths or weaknesses.";
  const tail =
    basis === "history"
      ? " Tuned to your past performance."
      : " Based on general heuristics (not enough history yet).";
  return `${lead}${tail}`;
}

/**
 * Score a draft for one platform. Pure and synchronous — safe to call on every
 * keystroke. Returns a 0-100 score, the per-factor breakdown, a one-line
 * rationale, and whether learned history or heuristics drove it.
 */
export function scoreForPlatform(input: ScoreInput): PerformancePrediction {
  const { platform, text, media, history } = input;
  const factors: ScoreFactor[] = [
    hookFactor(text, input.hookOverride ?? null),
    lengthFactor(text, platform, history),
    hashtagFactor(text, platform, history),
    timingFactor(input.scheduledFor ?? null, history),
    mediaFactor(media),
  ];
  const total = factors.reduce((sum, factor) => sum + factor.points, 0);
  const basis =
    history && history.sampleSize >= MIN_HISTORY_SAMPLE
      ? "history"
      : "heuristics";
  return {
    platform,
    score: clamp100(total),
    factors,
    rationale: buildRationale(factors, basis),
    basis,
  };
}
