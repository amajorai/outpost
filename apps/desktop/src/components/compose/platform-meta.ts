/**
 * Shared display metadata for platforms used across the composer (U8).
 *
 * Keeps human-readable labels in one place so the preview, target picker, and
 * limit chips don't each re-derive them.
 */

import type { Platform } from "@/lib/providers";

/** Display names for every platform in the `Platform` union. */
export const PLATFORM_LABELS: Record<Platform, string> = {
  x: "X",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  facebook: "Facebook",
  bluesky: "Bluesky",
  threads: "Threads",
};

/** Resolve a label for any platform string, falling back to the raw key. */
export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform as Platform] ?? platform;
}
