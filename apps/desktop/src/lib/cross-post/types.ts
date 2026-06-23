/**
 * Shared types for the auto-detect cross-post pipeline (U19).
 *
 * When the browser extension (U18) detects the user's own manual post, the
 * hardened local bridge re-emits it as a `detected-post` Tauri event. This unit
 * ingests that event, dedupes it against the user's own scheduled/published
 * output (so a bot echo or a re-detected cross-post is never re-posted), and —
 * after an explicit confirmation — routes the post to the user's configured
 * cross-post target platforms through the existing publish pipeline.
 *
 * The `DetectedPost` shape below is a *local* copy of the extension's payload
 * contract (apps/extension/lib/detection.ts). It is intentionally NOT imported
 * across the app boundary: the desktop validates `version === 1` on the wire so
 * a drifting extension can't feed it a shape it doesn't understand.
 */

import type { Platform } from "@/lib/providers/types";

/**
 * Platforms the U18 extension can currently detect authored posts from. This is
 * the source side of the cross-post matrix — a subset of the full provider
 * `Platform` union (the extension only ships X and LinkedIn detection today).
 * Keep this in sync with the extension's `DetectedPlatform`.
 */
export const DETECTABLE_SOURCE_PLATFORMS: readonly Platform[] = [
  "x",
  "linkedin",
] as const;

/** One media reference as captured by the extension's detector. */
export interface DetectedMediaRef {
  /** Local preview URL (usually a `blob:` URL) or remote src if hosted. */
  previewUrl: string;
  altText?: string;
  kind: "image" | "video" | "unknown";
}

/**
 * The detected-post payload as it arrives over the `detected-post` Tauri event.
 * Mirrors the extension's `DetectedPost` (apps/extension/lib/detection.ts). The
 * single `version` integer guards against silent shape drift.
 */
export interface DetectedPost {
  version: 1;
  platform: Platform;
  text: string;
  media: DetectedMediaRef[];
  permalink: string | null;
  sourceUrl: string;
  /** ISO timestamp of detection. */
  detectedAt: string;
}

/**
 * Validate and narrow an unknown event payload to a {@link DetectedPost}.
 * Returns null when the payload is the wrong version/shape so the listener can
 * drop it rather than throw. We only require the fields the pipeline actually
 * reads (platform + text/permalink); media is normalized to an array.
 */
export function parseDetectedPost(raw: unknown): DetectedPost | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) {
    return null;
  }
  if (typeof record.platform !== "string") {
    return null;
  }
  const text = typeof record.text === "string" ? record.text : "";
  const permalink =
    typeof record.permalink === "string" ? record.permalink : null;
  if (text.length === 0 && permalink === null) {
    return null;
  }
  const media = Array.isArray(record.media)
    ? (record.media as DetectedMediaRef[])
    : [];
  return {
    version: 1,
    platform: record.platform as Platform,
    text,
    media,
    permalink,
    sourceUrl: typeof record.sourceUrl === "string" ? record.sourceUrl : "",
    detectedAt:
      typeof record.detectedAt === "string"
        ? record.detectedAt
        : new Date().toISOString(),
  };
}
