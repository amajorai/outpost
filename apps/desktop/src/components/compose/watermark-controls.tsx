/**
 * Per-platform brand watermark controls for the composer (U13).
 *
 * When the workspace has a brand watermark configured, this lets the user choose
 * which of the selected platforms get the watermark overlaid on this post's
 * media. The choice is ephemeral composer state (not persisted into the draft
 * body) and drives the live preview overlay. Hidden entirely when no watermark
 * is configured or no platforms are selected, so it never adds noise.
 */

import { Badge } from "@repo/ui/badge";
import { Sparkles } from "lucide-react";
import { platformLabel } from "./platform-meta";

export function WatermarkControls({
  hasWatermark,
  platforms,
  appliedPlatforms,
  onToggle,
}: {
  /** Whether the workspace has a brand watermark configured. */
  hasWatermark: boolean;
  /** Distinct platforms among the selected accounts. */
  platforms: string[];
  /** Platforms the watermark currently applies to. */
  appliedPlatforms: ReadonlySet<string>;
  /** Toggle the watermark for a platform. */
  onToggle: (platform: string) => void;
}) {
  if (!hasWatermark || platforms.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-muted-foreground" strokeWidth={1.5} />
        <span className="font-medium text-sm">Brand watermark</span>
      </div>
      <p className="text-muted-foreground text-xs">
        Choose which platforms get your brand watermark on this post.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {platforms.map((platform) => {
          const applied = appliedPlatforms.has(platform);
          return (
            <button
              aria-pressed={applied}
              key={platform}
              onClick={() => onToggle(platform)}
              type="button"
            >
              <Badge variant={applied ? "default" : "outline"}>
                {platformLabel(platform)}
              </Badge>
            </button>
          );
        })}
      </div>
    </div>
  );
}
