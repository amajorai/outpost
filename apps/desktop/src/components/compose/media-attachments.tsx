/**
 * Media attachment row for the composer (U8).
 *
 * Opens the native file dialog to attach raw image/video files, then shows
 * removable thumbnails. Previews use Tauri's `convertFileSrc` so a local path
 * renders through the asset protocol without copying the file.
 */

import { Button } from "@repo/ui/button";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ImagePlus, X } from "lucide-react";
import { useCallback } from "react";
import {
  type MediaAttachment,
  mimeTypeForPath,
} from "@/lib/compose/platform-limits";
import { logger } from "@/lib/logger";
import { MediaLibraryDialog } from "./media-library-dialog";

const MEDIA_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "heic",
  "mp4",
  "mov",
  "webm",
  "m4v",
];

const PATH_SEPARATOR = /[/\\]/;

function fileName(path: string): string {
  const parts = path.split(PATH_SEPARATOR);
  return parts.at(-1) ?? path;
}

function MediaThumb({
  item,
  onRemove,
}: {
  item: MediaAttachment;
  onRemove: () => void;
}) {
  const src = convertFileSrc(item.path);
  const isVideo = item.mimeType.startsWith("video/");
  return (
    <div className="group relative size-20 overflow-hidden rounded-xl border bg-muted">
      {isVideo ? (
        <video className="size-full object-cover" muted src={src} />
      ) : (
        // biome-ignore lint/performance/noImgElement: Tauri webview, no next/image; local asset preview
        // biome-ignore lint/correctness/useImageSize: thumbnail is CSS-sized via object-cover
        <img alt={item.name} className="size-full object-cover" src={src} />
      )}
      <button
        aria-label={`Remove ${item.name}`}
        className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-background/80 text-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        onClick={onRemove}
        type="button"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

export function MediaAttachments({
  media,
  onAdd,
  onRemove,
}: {
  media: MediaAttachment[];
  onAdd: (items: MediaAttachment[]) => void;
  onRemove: (path: string) => void;
}) {
  const handlePick = useCallback(async () => {
    try {
      const selection = await open({
        multiple: true,
        directory: false,
        filters: [{ name: "Media", extensions: MEDIA_EXTENSIONS }],
      });
      if (!selection) {
        return;
      }
      const paths = Array.isArray(selection) ? selection : [selection];
      const items: MediaAttachment[] = paths.map((path) => ({
        path,
        mimeType: mimeTypeForPath(path),
        name: fileName(path),
      }));
      onAdd(items);
    } catch (error) {
      logger.error({ err: error }, "[Composer] Failed to pick media");
    }
  }, [onAdd]);

  return (
    <div className="flex flex-col gap-3">
      {media.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {media.map((item) => (
            <MediaThumb
              item={item}
              key={item.path}
              onRemove={() => onRemove(item.path)}
            />
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          className="w-fit"
          onClick={handlePick}
          size="sm"
          type="button"
          variant="outline"
        >
          <ImagePlus className="size-4" />
          Attach media
        </Button>
        <MediaLibraryDialog onPick={onAdd} />
      </div>
    </div>
  );
}
