/**
 * Static per-platform composition limits (U8).
 *
 * The provider capability matrix (`PlatformCapabilities`) is booleans only —
 * it answers "can this platform publish/read DMs", not "how long can a post be".
 * Character counts and media format rules are platform facts that don't depend on
 * the active provider, so they live here as a static map rather than on the
 * provider contract. The composer reads this to render limits and to validate a
 * post before allowing schedule.
 *
 * Numbers are deliberately conservative public limits; they're for client-side
 * guard-railing, not a contractual guarantee. Missing a platform falls back to a
 * permissive default so an unknown platform never hard-blocks composing.
 */

import type { Platform } from "@/lib/providers";

/**
 * How a platform interprets a multi-segment post (U12):
 * - `thread`: each segment is a reply chained to the previous (X-style).
 * - `carousel`: segments are slides in one post (IG/LinkedIn-style).
 * - `none`: no native multi-segment; extra segments degrade to the first.
 */
export type SegmentStyle = "thread" | "carousel" | "none";

/** The composition constraints for a single platform. */
export interface PlatformLimits {
  /** Maximum number of characters allowed in the post body. */
  maxChars: number;
  /** MIME type prefixes the platform accepts, e.g. "image/", "video/". */
  allowedMimePrefixes: readonly string[];
  /** Maximum number of media attachments per post (or per segment). */
  maxMedia: number;
  /** How this platform renders/publishes multiple segments. */
  segmentStyle: SegmentStyle;
  /**
   * Maximum number of segments the platform accepts. For `none` this is 1
   * (extra segments degrade to the first). For threads/carousels it's the
   * native cap.
   */
  maxSegments: number;
}

/** A permissive fallback for any platform not explicitly listed. */
export const DEFAULT_PLATFORM_LIMITS: PlatformLimits = {
  maxChars: 5000,
  allowedMimePrefixes: ["image/", "video/"],
  maxMedia: 10,
  segmentStyle: "none",
  maxSegments: 1,
};

const IMAGE_AND_VIDEO = ["image/", "video/"] as const;
const IMAGE_ONLY = ["image/"] as const;
const VIDEO_ONLY = ["video/"] as const;

/** Per-platform limits. Keep keys in sync with the `Platform` union. */
export const PLATFORM_LIMITS: Record<Platform, PlatformLimits> = {
  x: {
    maxChars: 280,
    allowedMimePrefixes: IMAGE_AND_VIDEO,
    maxMedia: 4,
    segmentStyle: "thread",
    maxSegments: 25,
  },
  instagram: {
    maxChars: 2200,
    allowedMimePrefixes: IMAGE_AND_VIDEO,
    maxMedia: 10,
    segmentStyle: "carousel",
    maxSegments: 10,
  },
  tiktok: {
    maxChars: 2200,
    allowedMimePrefixes: VIDEO_ONLY,
    maxMedia: 1,
    segmentStyle: "none",
    maxSegments: 1,
  },
  youtube: {
    maxChars: 5000,
    allowedMimePrefixes: VIDEO_ONLY,
    maxMedia: 1,
    segmentStyle: "none",
    maxSegments: 1,
  },
  linkedin: {
    maxChars: 3000,
    allowedMimePrefixes: IMAGE_AND_VIDEO,
    maxMedia: 9,
    segmentStyle: "carousel",
    maxSegments: 20,
  },
  reddit: {
    maxChars: 40_000,
    allowedMimePrefixes: IMAGE_AND_VIDEO,
    maxMedia: 1,
    segmentStyle: "none",
    maxSegments: 1,
  },
  facebook: {
    maxChars: 63_206,
    allowedMimePrefixes: IMAGE_AND_VIDEO,
    maxMedia: 10,
    segmentStyle: "none",
    maxSegments: 1,
  },
  bluesky: {
    maxChars: 300,
    allowedMimePrefixes: IMAGE_ONLY,
    maxMedia: 4,
    segmentStyle: "thread",
    maxSegments: 25,
  },
  threads: {
    maxChars: 500,
    allowedMimePrefixes: IMAGE_AND_VIDEO,
    maxMedia: 10,
    segmentStyle: "thread",
    maxSegments: 25,
  },
};

/** Resolve the limits for a platform, falling back to a permissive default. */
export function getPlatformLimits(platform: string): PlatformLimits {
  return PLATFORM_LIMITS[platform as Platform] ?? DEFAULT_PLATFORM_LIMITS;
}

/** A single attached media item, as the composer holds it. */
export interface MediaAttachment {
  /** Local file path (the absolute path returned by the file dialog). */
  path: string;
  /** Best-effort MIME type derived from the file extension. */
  mimeType: string;
  /** Display file name. */
  name: string;
}

/** A human-readable reason a target is invalid, or null when it's valid. */
export type ValidationError = string | null;

/**
 * Validate a post body + media against one platform's limits. Returns the first
 * blocking reason, or null when the target is publishable. The composer disables
 * the schedule action and shows the reason while this is non-null.
 */
export function validateForPlatform(
  platform: string,
  text: string,
  media: readonly MediaAttachment[]
): ValidationError {
  const limits = getPlatformLimits(platform);

  const trimmedLength = text.trim().length;
  if (trimmedLength === 0 && media.length === 0) {
    return "Post is empty";
  }

  if (text.length > limits.maxChars) {
    return `Over the ${limits.maxChars.toLocaleString()} character limit by ${(
      text.length - limits.maxChars
    ).toLocaleString()}`;
  }

  if (media.length > limits.maxMedia) {
    return `Allows at most ${limits.maxMedia} ${
      limits.maxMedia === 1 ? "attachment" : "attachments"
    }`;
  }

  for (const item of media) {
    const allowed = limits.allowedMimePrefixes.some((prefix) =>
      item.mimeType.startsWith(prefix)
    );
    if (!allowed) {
      return `Does not accept "${item.name}" (${item.mimeType || "unknown type"})`;
    }
  }

  return null;
}

/** One ordered segment of a multi-segment post, as the composer holds it. */
export interface ComposeSegment {
  text: string;
  media: MediaAttachment[];
}

/**
 * Validate an ordered list of segments against one platform (U12). Single-segment
 * posts reduce to {@link validateForPlatform} on the first segment, so there is
 * no behavior change for the common case.
 *
 * For platforms that don't support multiple segments (`segmentStyle: "none"`)
 * only the first segment would publish, so we only validate that one — the extra
 * segments are explicitly a degrade, not an error. For thread/carousel platforms
 * every segment is validated individually and the segment count is capped.
 */
export function validateSegmentsForPlatform(
  platform: string,
  segments: readonly ComposeSegment[]
): ValidationError {
  const limits = getPlatformLimits(platform);

  if (segments.length === 0) {
    return "Post is empty";
  }

  // Platforms with no multi-segment support only ever publish the first segment.
  if (limits.segmentStyle === "none") {
    return validateForPlatform(platform, segments[0].text, segments[0].media);
  }

  if (segments.length > limits.maxSegments) {
    const noun = limits.segmentStyle === "thread" ? "posts" : "slides";
    return `Allows at most ${limits.maxSegments} ${noun}`;
  }

  for (let i = 0; i < segments.length; i++) {
    const reason = validateForPlatform(
      platform,
      segments[i].text,
      segments[i].media
    );
    if (reason) {
      const noun = limits.segmentStyle === "thread" ? "Post" : "Slide";
      return `${noun} ${i + 1}: ${reason}`;
    }
  }

  return null;
}

/** Map a file extension to a best-effort MIME type for validation/preview. */
const EXTENSION_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  m4v: "video/x-m4v",
};

/** Derive a MIME type from a file path's extension. */
export function mimeTypeForPath(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) {
    return "";
  }
  const ext = path.slice(dot + 1).toLowerCase();
  return EXTENSION_MIME[ext] ?? "";
}
