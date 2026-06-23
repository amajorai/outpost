/**
 * Live per-platform preview for the composer (U8, extended for threads/carousels
 * in U12).
 *
 * For each platform among the selected accounts, renders a card showing the post
 * as it would appear. The layout is derived from the platform's `segmentStyle`:
 * - `thread` (X/Bluesky/Threads): a vertical stack of connected posts.
 * - `carousel` (IG/LinkedIn): a horizontal strip of slides.
 * - `none`: only the first segment, since extra segments degrade away there.
 *
 * Each card also shows the platform's character/format limits, the live character
 * count of the primary segment, and any validation error from the limit rules.
 */

import { Badge } from "@repo/ui/badge";
import { convertFileSrc } from "@tauri-apps/api/core";
import { AlertCircle } from "lucide-react";
import { platformLabel } from "@/components/compose/platform-meta";
import {
  type ComposeSegment,
  getPlatformLimits,
  type MediaAttachment,
  type SegmentStyle,
  validateSegmentsForPlatform,
} from "@/lib/compose/platform-limits";
import type { BrandWatermark } from "@/lib/social-schema";

/** Tailwind classes anchoring the watermark overlay to its configured corner. */
const WATERMARK_POSITION_CLASS: Record<BrandWatermark["position"], string> = {
  "top-left": "top-2 left-2",
  "top-right": "top-2 right-2",
  "bottom-left": "bottom-2 left-2",
  "bottom-right": "bottom-2 right-2",
  center: "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
};

function WatermarkOverlay({ watermark }: { watermark: BrandWatermark }) {
  return (
    // biome-ignore lint/performance/noImgElement: Tauri webview, no next/image; local asset preview
    // biome-ignore lint/correctness/useImageSize: overlay is CSS-sized
    <img
      alt=""
      className={`pointer-events-none absolute z-10 h-1/4 max-h-12 w-auto object-contain ${WATERMARK_POSITION_CLASS[watermark.position]}`}
      src={convertFileSrc(watermark.path)}
      style={{ opacity: watermark.opacity }}
    />
  );
}

function PreviewMedia({
  media,
  watermark,
}: {
  media: MediaAttachment[];
  watermark: BrandWatermark | null;
}) {
  if (media.length === 0) {
    return null;
  }
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {media.map((item) => {
        const src = convertFileSrc(item.path);
        return (
          <div className="relative overflow-hidden rounded-lg" key={item.path}>
            {item.mimeType.startsWith("video/") ? (
              <video
                className="aspect-video w-full object-cover"
                muted
                src={src}
              />
            ) : (
              // biome-ignore lint/performance/noImgElement: Tauri webview, no next/image; local asset preview
              // biome-ignore lint/correctness/useImageSize: preview is CSS-sized via aspect-video/object-cover
              <img
                alt={item.name}
                className="aspect-video w-full object-cover"
                src={src}
              />
            )}
            {watermark && <WatermarkOverlay watermark={watermark} />}
          </div>
        );
      })}
    </div>
  );
}

function SegmentBody({
  segment,
  watermark,
}: {
  segment: ComposeSegment;
  watermark: BrandWatermark | null;
}) {
  return (
    <>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
        {segment.text.trim().length > 0 ? (
          segment.text
        ) : (
          <span className="text-muted-foreground italic">Nothing yet</span>
        )}
      </p>
      <PreviewMedia media={segment.media} watermark={watermark} />
    </>
  );
}

/** A vertical, connected stack of posts — the X/Bluesky/Threads thread layout. */
function ThreadLayout({
  segments,
  watermark,
}: {
  segments: ComposeSegment[];
  watermark: BrandWatermark | null;
}) {
  return (
    <ol className="flex flex-col gap-2">
      {segments.map((segment, index) => (
        <li
          className="border-muted border-l-2 pl-3"
          // biome-ignore lint/suspicious/noArrayIndexKey: ordered segment list keyed by position
          key={index}
        >
          <div className="flex flex-col gap-2">
            {segments.length > 1 && (
              <span className="text-muted-foreground text-xs">
                {index + 1}/{segments.length}
              </span>
            )}
            <SegmentBody segment={segment} watermark={watermark} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A horizontal strip of slides — the Instagram/LinkedIn carousel layout. */
function CarouselLayout({
  segments,
  watermark,
}: {
  segments: ComposeSegment[];
  watermark: BrandWatermark | null;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {segments.map((segment, index) => (
        <div
          className="flex w-48 shrink-0 flex-col gap-2 rounded-xl border bg-muted/40 p-3"
          // biome-ignore lint/suspicious/noArrayIndexKey: ordered segment list keyed by position
          key={index}
        >
          {segments.length > 1 && (
            <span className="text-muted-foreground text-xs">
              Slide {index + 1}
            </span>
          )}
          <SegmentBody segment={segment} watermark={watermark} />
        </div>
      ))}
    </div>
  );
}

function SegmentLayout({
  style,
  segments,
  watermark,
}: {
  style: SegmentStyle;
  segments: ComposeSegment[];
  watermark: BrandWatermark | null;
}) {
  if (style === "thread") {
    return <ThreadLayout segments={segments} watermark={watermark} />;
  }
  if (style === "carousel") {
    return <CarouselLayout segments={segments} watermark={watermark} />;
  }
  // `none`: only the first segment publishes, so that's all we preview.
  return <SegmentBody segment={segments[0]} watermark={watermark} />;
}

function PlatformPreviewCard({
  platform,
  accountLabels,
  segments,
  watermark,
}: {
  platform: string;
  accountLabels: string[];
  segments: ComposeSegment[];
  watermark: BrandWatermark | null;
}) {
  const limits = getPlatformLimits(platform);
  const error = validateSegmentsForPlatform(platform, segments);
  const primary = segments[0] ?? { text: "", media: [] };
  const overLimit = primary.text.length > limits.maxChars;
  const segmentNoun = limits.segmentStyle === "carousel" ? "slides" : "posts";
  const showsMulti = limits.segmentStyle !== "none" && segments.length > 1;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{platformLabel(platform)}</span>
          <span className="text-muted-foreground text-xs">
            {accountLabels.join(", ")}
          </span>
        </div>
        <span
          className={
            overLimit
              ? "font-medium text-destructive text-xs tabular-nums"
              : "text-muted-foreground text-xs tabular-nums"
          }
        >
          {primary.text.length.toLocaleString()} /{" "}
          {limits.maxChars.toLocaleString()}
        </span>
      </div>

      <SegmentLayout
        segments={segments}
        style={limits.segmentStyle}
        watermark={watermark}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {showsMulti && (
          <Badge variant="secondary">
            {segments.length} {segmentNoun}
          </Badge>
        )}
        {limits.segmentStyle === "none" && segments.length > 1 && (
          <Badge variant="secondary">First segment only</Badge>
        )}
        <Badge variant="secondary">
          {primary.media.length} / {limits.maxMedia} media
        </Badge>
        <Badge variant="secondary">
          {limits.allowedMimePrefixes
            .map((prefix) => prefix.replace("/", ""))
            .join(", ")}
        </Badge>
      </div>

      {error && (
        <p
          className="flex items-center gap-1.5 text-destructive text-xs"
          role="alert"
        >
          <AlertCircle className="size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

export interface PreviewGroup {
  platform: string;
  accountLabels: string[];
}

export function ComposePreview({
  groups,
  segments,
  watermark = null,
  watermarkPlatforms,
}: {
  groups: PreviewGroup[];
  segments: ComposeSegment[];
  /** The brand watermark to overlay, or null when none is configured. */
  watermark?: BrandWatermark | null;
  /**
   * Platforms the user has opted to apply the watermark to (U13). A platform
   * not in this set previews without the overlay even when a watermark exists.
   */
  watermarkPlatforms?: ReadonlySet<string>;
}) {
  if (groups.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed p-8 text-center text-muted-foreground text-sm">
        Select an account to preview your post.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <PlatformPreviewCard
          accountLabels={group.accountLabels}
          key={group.platform}
          platform={group.platform}
          segments={segments}
          watermark={
            watermark && watermarkPlatforms?.has(group.platform)
              ? watermark
              : null
          }
        />
      ))}
    </div>
  );
}
