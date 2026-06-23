/**
 * Multi-segment post editor for the composer (U12).
 *
 * Authors an ordered list of segments — X thread tweets and IG/LinkedIn carousel
 * slides share one structure. Each segment has its own text and media; segments
 * can be added, removed, and reordered with up/down move buttons (keyboard-
 * accessible, no drag-and-drop dependency). A single segment renders exactly like
 * the original single-post editor, so there's no regression for simple posts.
 *
 * The store keeps `segments[0]` mirrored into the top-level `text`/`media`, so the
 * first segment is always the "primary" post that unsupported platforms degrade to.
 */

import { Button } from "@repo/ui/button";
import { Textarea } from "@repo/ui/textarea";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type {
  ComposeSegment,
  MediaAttachment,
} from "@/lib/compose/platform-limits";
import { MediaAttachments } from "./media-attachments";

function SegmentCard({
  segment,
  index,
  total,
  onSetText,
  onAddMedia,
  onRemoveMedia,
  onRemove,
  onMove,
}: {
  segment: ComposeSegment;
  index: number;
  total: number;
  onSetText: (text: string, index: number) => void;
  onAddMedia: (items: MediaAttachment[], index: number) => void;
  onRemoveMedia: (path: string, index: number) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: "up" | "down") => void;
}) {
  const isOnly = total === 1;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-muted-foreground text-xs">
          {isOnly ? "Post" : `Segment ${index + 1} of ${total}`}
        </span>
        {!isOnly && (
          <div className="flex items-center gap-1">
            <Button
              aria-label={`Move segment ${index + 1} up`}
              disabled={index === 0}
              onClick={() => onMove(index, "up")}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              aria-label={`Move segment ${index + 1} down`}
              disabled={index === total - 1}
              onClick={() => onMove(index, "down")}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ArrowDown className="size-4" />
            </Button>
            <Button
              aria-label={`Remove segment ${index + 1}`}
              onClick={() => onRemove(index)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        )}
      </div>

      <Textarea
        aria-label={isOnly ? "Post text" : `Segment ${index + 1} text`}
        className="min-h-32 text-base"
        onChange={(e) => onSetText(e.target.value, index)}
        placeholder={
          index === 0 ? "What do you want to say?" : "Continue the thread..."
        }
        value={segment.text}
      />

      <MediaAttachments
        media={segment.media}
        onAdd={(items) => onAddMedia(items, index)}
        onRemove={(path) => onRemoveMedia(path, index)}
      />
    </div>
  );
}

export function SegmentEditor({
  segments,
  onSetText,
  onAddMedia,
  onRemoveMedia,
  onAddSegment,
  onRemoveSegment,
  onMoveSegment,
}: {
  segments: ComposeSegment[];
  onSetText: (text: string, index: number) => void;
  onAddMedia: (items: MediaAttachment[], index: number) => void;
  onRemoveMedia: (path: string, index: number) => void;
  onAddSegment: () => void;
  onRemoveSegment: (index: number) => void;
  onMoveSegment: (index: number, direction: "up" | "down") => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {segments.map((segment, index) => (
        <SegmentCard
          index={index}
          // Segments have no stable id; index is the order key and the list is
          // small + reorder-only, so index is an acceptable key here.
          // biome-ignore lint/suspicious/noArrayIndexKey: ordered segment list keyed by position
          key={index}
          onAddMedia={onAddMedia}
          onMove={onMoveSegment}
          onRemove={onRemoveSegment}
          onRemoveMedia={onRemoveMedia}
          onSetText={onSetText}
          segment={segment}
          total={segments.length}
        />
      ))}
      <Button
        className="w-fit"
        onClick={onAddSegment}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus className="size-4" />
        Add segment
      </Button>
    </div>
  );
}
