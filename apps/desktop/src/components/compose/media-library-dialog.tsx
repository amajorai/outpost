/**
 * Media library browser + picker for the composer (U13).
 *
 * Lists the workspace's saved media assets and inserts the selected ones into
 * the current segment's attachments. Assets can also be added to the library
 * (from the native file dialog) or removed. Like the composer's attachments,
 * assets are references to local paths, so selecting one never copies bytes.
 *
 * Rendered inside `MediaAttachments`, which scopes `onPick` to its own segment,
 * so library inserts land in the right segment with no extra plumbing.
 */

import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ImagePlus, Library, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  type MediaAttachment,
  mimeTypeForPath,
} from "@/lib/compose/platform-limits";
import { logger } from "@/lib/logger";
import {
  createMediaAsset,
  deleteMediaAsset,
  listMediaAssets,
} from "@/lib/repos/media-assets";
import type { MediaAsset } from "@/lib/social-schema";

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

/** Convert a saved asset to a composer attachment. */
function assetToAttachment(asset: MediaAsset): MediaAttachment {
  return {
    path: asset.path,
    mimeType: asset.mimeType ?? mimeTypeForPath(asset.path),
    name: asset.name,
  };
}

function AssetTile({
  asset,
  onPick,
  onDelete,
}: {
  asset: MediaAsset;
  onPick: () => void;
  onDelete: () => void;
}) {
  const src = convertFileSrc(asset.path);
  return (
    <div className="group relative overflow-hidden rounded-xl border bg-muted">
      <button
        className="block size-full"
        onClick={onPick}
        title={`Add ${asset.name}`}
        type="button"
      >
        {asset.kind === "video" ? (
          <video
            className="aspect-square size-full object-cover"
            muted
            src={src}
          />
        ) : (
          // biome-ignore lint/performance/noImgElement: Tauri webview, no next/image; local asset preview
          // biome-ignore lint/correctness/useImageSize: thumbnail is CSS-sized via object-cover
          <img
            alt={asset.name}
            className="aspect-square size-full object-cover"
            src={src}
          />
        )}
      </button>
      <button
        aria-label={`Remove ${asset.name} from library`}
        className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-background/80 text-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        onClick={onDelete}
        type="button"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}

export function MediaLibraryDialog({
  onPick,
}: {
  onPick: (items: MediaAttachment[]) => void;
}) {
  const [dialogOpen, setOpen] = useState(false);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setAssets(await listMediaAssets());
    } catch (error) {
      logger.error({ err: error }, "[MediaLibrary] Failed to load assets");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dialogOpen) {
      refresh();
    }
  }, [dialogOpen, refresh]);

  const handleAddToLibrary = useCallback(async () => {
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
      for (const path of paths) {
        await createMediaAsset({
          path,
          name: fileName(path),
          mimeType: mimeTypeForPath(path),
        });
      }
      await refresh();
    } catch (error) {
      logger.error({ err: error }, "[MediaLibrary] Failed to add asset");
    }
  }, [refresh]);

  const handlePick = useCallback(
    (asset: MediaAsset) => {
      onPick([assetToAttachment(asset)]);
      setOpen(false);
    },
    [onPick]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteMediaAsset(id);
        await refresh();
      } catch (error) {
        logger.error({ err: error }, "[MediaLibrary] Failed to remove asset");
      }
    },
    [refresh]
  );

  return (
    <Dialog onOpenChange={setOpen} open={dialogOpen}>
      <Button
        className="w-fit"
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Library className="size-4" />
        Library
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Media library</DialogTitle>
          <DialogDescription>
            Pick saved media to add to this post, or add new media to reuse
            later.
          </DialogDescription>
        </DialogHeader>

        <Button
          className="w-fit"
          onClick={handleAddToLibrary}
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus className="size-4" />
          Add media to library
        </Button>

        <div className="max-h-80 overflow-y-auto">
          {isLoading && (
            <p className="text-muted-foreground text-sm">Loading...</p>
          )}
          {!isLoading && assets.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground text-sm">
              <ImagePlus className="size-6" strokeWidth={1.5} />
              <p>No saved media yet. Add some to reuse across posts.</p>
            </div>
          )}
          {assets.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {assets.map((asset) => (
                <AssetTile
                  asset={asset}
                  key={asset.id}
                  onDelete={() => handleDelete(asset.id)}
                  onPick={() => handlePick(asset)}
                />
              ))}
            </div>
          )}
        </div>

        <DialogClose
          render={
            <Button type="button" variant="ghost">
              Close
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
