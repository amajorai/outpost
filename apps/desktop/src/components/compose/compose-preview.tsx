/**
 * Live per-platform preview for the composer (U8).
 *
 * For each platform among the selected accounts, renders a card showing the post
 * text and media as it would appear, the platform's character/format limits, the
 * live character count, and any validation error from the capability/limit rules.
 */

import { Badge } from "@repo/ui/badge";
import { convertFileSrc } from "@tauri-apps/api/core";
import { AlertCircle } from "lucide-react";
import { platformLabel } from "@/components/compose/platform-meta";
import {
  getPlatformLimits,
  type MediaAttachment,
  validateForPlatform,
} from "@/lib/compose/platform-limits";

function PreviewMedia({ media }: { media: MediaAttachment[] }) {
  if (media.length === 0) {
    return null;
  }
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {media.map((item) => {
        const src = convertFileSrc(item.path);
        return item.mimeType.startsWith("video/") ? (
          <video
            className="aspect-video w-full rounded-lg object-cover"
            key={item.path}
            muted
            src={src}
          />
        ) : (
          // biome-ignore lint/performance/noImgElement: Tauri webview, no next/image; local asset preview
          // biome-ignore lint/correctness/useImageSize: preview is CSS-sized via aspect-video/object-cover
          <img
            alt={item.name}
            className="aspect-video w-full rounded-lg object-cover"
            key={item.path}
            src={src}
          />
        );
      })}
    </div>
  );
}

function PlatformPreviewCard({
  platform,
  accountLabels,
  text,
  media,
}: {
  platform: string;
  accountLabels: string[];
  text: string;
  media: MediaAttachment[];
}) {
  const limits = getPlatformLimits(platform);
  const error = validateForPlatform(platform, text, media);
  const overLimit = text.length > limits.maxChars;

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
          {text.length.toLocaleString()} / {limits.maxChars.toLocaleString()}
        </span>
      </div>

      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
        {text.trim().length > 0 ? (
          text
        ) : (
          <span className="text-muted-foreground italic">Nothing yet</span>
        )}
      </p>

      <PreviewMedia media={media} />

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary">
          {media.length} / {limits.maxMedia} media
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
  text,
  media,
}: {
  groups: PreviewGroup[];
  text: string;
  media: MediaAttachment[];
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
          media={media}
          platform={group.platform}
          text={text}
        />
      ))}
    </div>
  );
}
