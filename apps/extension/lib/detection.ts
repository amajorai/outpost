// Shared types + helpers for the Outpost browser-extension post detector (Unit U18).
//
// The detector watches the user composing and submitting their OWN post on a
// supported platform, then captures the resulting text, media references, and
// permalink. It is intentionally conservative: detection is anchored to the
// compose/submit flow and confirmed by a post-success affordance (toast / view
// link), so feed items are never mistaken for authored posts.

/**
 * Platforms with shipped detection support in this unit.
 *
 * TODO(U-followon): add detection for the remaining provider platforms that
 * the desktop app already supports - instagram, tiktok, youtube, reddit,
 * facebook, bluesky, threads. Each needs its own content script with
 * site-specific compose/submit/permalink heuristics. Tracked as follow-on
 * units after U18.
 */
export type DetectedPlatform = "x" | "linkedin";

/**
 * A media reference captured from the composer at submit time.
 *
 * Note: at authoring time the only URLs available are local `blob:` previews;
 * the final platform CDN URLs are not known until the post is fully processed
 * server-side. We capture what we can (preview URL, alt text) and flag the gap.
 *
 * TODO(U-followon): resolve final CDN media URLs. This likely requires reading
 * the rendered post via the permalink after publish, or scraping the timeline
 * entry, rather than the composer. Out of scope for U18.
 */
export interface DetectedMedia {
  /** Local preview URL (usually a `blob:` URL) or remote src if already hosted. */
  previewUrl: string;
  /** Alt / accessibility text when the platform exposes it. */
  altText?: string;
  /** Best-effort media kind. */
  kind: "image" | "video" | "unknown";
}

/** Payload delivered from a content script to the background script. */
export interface DetectedPost {
  /** Single integer guards against silent shape drift on the desktop side. */
  version: 1;
  platform: DetectedPlatform;
  /** Plain-text body of the authored post. */
  text: string;
  /** Media references captured from the composer (may be empty). */
  media: DetectedMedia[];
  /** Canonical post URL once confirmed, else null when not yet resolvable. */
  permalink: string | null;
  /** Page the post was authored from. */
  sourceUrl: string;
  /** ISO timestamp of detection. */
  detectedAt: string;
}

/** Message envelope sent over `browser.runtime.sendMessage`. */
export interface DetectedPostMessage {
  type: "outpost:detected-post";
  payload: DetectedPost;
}

export const DETECTED_POST_MESSAGE = "outpost:detected-post" as const;

/** Local desktop bridge ingest endpoint (Axum, see src-tauri/src/http_bridge.rs). */
export const BRIDGE_INGEST_URL = "http://localhost:37842/api/detected-post";

const MIN_POST_LENGTH = 1;
const MAX_POST_LENGTH = 50_000;

/** Collapse insignificant whitespace without destroying intentional newlines. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .trim();
}

/** A captured post is only worth delivering if it has real text or media. */
export function isDeliverable(post: DetectedPost): boolean {
  const hasText =
    post.text.length >= MIN_POST_LENGTH && post.text.length <= MAX_POST_LENGTH;
  return hasText || post.media.length > 0;
}
