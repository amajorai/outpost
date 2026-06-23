/**
 * Shapes for the performance predictor (U24).
 *
 * Given a draft (text + media) and a target platform, the predictor returns a
 * 0-100 score plus a short, human-readable rationale of the factors that moved
 * it. The score is computed per platform because the dominant inputs (character
 * budget, hashtag conventions, the platform's historically best posting hours)
 * are platform facts — the same draft can be a great X post and a thin LinkedIn
 * one.
 *
 * Everything here is derived from data that already exists (`activity_items`
 * via `lib/analytics`, `platform-limits`). Nothing is persisted: a prediction is
 * a cheap, always-recomputable view, so persisting it would pull it under the
 * Data Versioning Contract for no benefit — the same reasoning `hashtags/cache`
 * documents.
 */

/** A single factor that contributed to a score, for the rationale breakdown. */
export interface ScoreFactor {
  /** Stable key so the UI can list factors deterministically. */
  key: "hook" | "length" | "hashtags" | "timing" | "media";
  /** Short human label, e.g. "Hook strength". */
  label: string;
  /** This factor's points contribution to the 0-100 total. */
  points: number;
  /** The maximum points this factor can contribute. */
  maxPoints: number;
  /** One-line explanation of why this factor scored as it did. */
  detail: string;
}

/** Whether the rationale leaned on learned history or heuristics alone. */
export type PredictionBasis = "history" | "heuristics";

/** A predicted-performance result for one platform. */
export interface PerformancePrediction {
  platform: string;
  /** Predicted performance, 0-100. Higher is a stronger likely performer. */
  score: number;
  /** The factors that summed to {@link score}, strongest first. */
  factors: ScoreFactor[];
  /**
   * A one-line summary rationale for the score, suitable to show inline under
   * the composer (e.g. "Strong hook and good length fit; posting time is off
   * your best window.").
   */
  rationale: string;
  /**
   * Whether the timing/length bands came from the user's own history or from
   * generic heuristics because history was too sparse to learn from. The UI
   * labels this so a heuristics-only score never implies learned signal.
   */
  basis: PredictionBasis;
}

/**
 * What the predictor learned from the user's history for one platform. Derived
 * once from `activity_items` and reused across recomputes so the live, on-edit
 * score path stays synchronous and allocation-light.
 */
export interface PlatformHistory {
  platform: string;
  /** Number of tracked posts that informed these patterns. */
  sampleSize: number;
  /**
   * Local hours-of-day (0-23) of the best-performing posts, most engaging
   * first. Empty when no post had a usable `publishedAt`.
   */
  bestHours: number[];
  /**
   * The average character length of the top-performing posts, used as a soft
   * target length band (not a hard target — deviation falls off gently). Null
   * when history is too sparse to trust.
   */
  bestLength: number | null;
  /** Whether the best-performing posts tended to use hashtags. */
  hashtagsHelp: boolean;
}
