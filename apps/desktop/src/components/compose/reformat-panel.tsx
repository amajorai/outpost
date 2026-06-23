/**
 * AI per-platform reformat panel for the composer (U15).
 *
 * "Reformat for each platform" asks the configured ACP/Claude agent to rewrite
 * the shared draft into a platform-native variant per selected target, using each
 * platform's character budget, segment style, and capability matrix as context.
 * The returned variants render as editable fields here so the user can review,
 * tweak, or revert each one before scheduling. A variant that is reverted (or
 * never generated) falls back to the shared draft text at schedule time.
 *
 * Errors are non-fatal: the reformat service never throws, and any failure is
 * surfaced as a sonner toast while the original draft is kept intact.
 */

import { Button } from "@repo/ui/button";
import { Textarea } from "@repo/ui/textarea";
import { Loader2, RotateCcw, Sparkles } from "lucide-react";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { getPlatformLimits } from "@/lib/compose/platform-limits";
import { reformatFailureMessage } from "@/lib/compose/reformat";
import type { CapabilityMatrix } from "@/lib/providers";
import { useComposerStore } from "@/stores/use-composer-store";
import { useIntegrationStore } from "@/stores/use-integration-store";
import { platformLabel } from "./platform-meta";

export function ReformatPanel({
  capabilityMatrix,
}: {
  capabilityMatrix: CapabilityMatrix | null;
}) {
  const segments = useComposerStore((s) => s.segments);
  const accounts = useComposerStore((s) => s.accounts);
  const selectedAccountIds = useComposerStore((s) => s.selectedAccountIds);
  const platformVariants = useComposerStore((s) => s.platformVariants);
  const isReformatting = useComposerStore((s) => s.isReformatting);
  const reformat = useComposerStore((s) => s.reformat);
  const setPlatformVariant = useComposerStore((s) => s.setPlatformVariant);
  const clearPlatformVariant = useComposerStore((s) => s.clearPlatformVariant);
  const refreshIntegration = useIntegrationStore((s) => s.refresh);

  // Distinct platforms across the selected target accounts.
  const selectedPlatforms = useMemo(() => {
    const selected = accounts.filter((a) => selectedAccountIds.includes(a.id));
    return [...new Set(selected.map((a) => a.platform))];
  }, [accounts, selectedAccountIds]);

  const draftText = segments[0]?.text ?? "";
  const canReformat =
    selectedPlatforms.length > 0 &&
    draftText.trim().length > 0 &&
    !isReformatting;

  const handleReformat = useCallback(async () => {
    // Warm the matrix so the prompt carries up-to-date capabilities.
    refreshIntegration();
    const result = await reformat(capabilityMatrix);
    const generated = Object.keys(result.variants).length;
    if (result.failure) {
      toast(reformatFailureMessage(result.failure));
      return;
    }
    const missing = selectedPlatforms.length - generated;
    toast(
      missing > 0
        ? `Reformatted ${generated} of ${selectedPlatforms.length} platforms; kept the original for the rest.`
        : `Reformatted for ${generated} ${generated === 1 ? "platform" : "platforms"}.`
    );
  }, [reformat, capabilityMatrix, refreshIntegration, selectedPlatforms]);

  if (selectedPlatforms.length === 0) {
    return (
      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
        <span className="flex items-center gap-2 font-medium text-sm">
          <Sparkles className="size-4 text-muted-foreground" />
          AI reformat
        </span>
        <p className="text-muted-foreground text-sm">
          Select a target account to reformat the post for its platform.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium text-sm">
          <Sparkles className="size-4 text-muted-foreground" />
          AI reformat
        </span>
        <Button
          disabled={!canReformat}
          onClick={handleReformat}
          size="sm"
          type="button"
          variant="outline"
        >
          {isReformatting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          Reformat for each platform
        </Button>
      </div>

      <p className="text-muted-foreground text-xs">
        Generate a platform-native variant per target. Review and edit each
        before scheduling; cleared variants fall back to your draft.
      </p>

      <ul className="flex flex-col gap-3">
        {selectedPlatforms.map((platform) => {
          const variant = platformVariants[platform];
          const limit = getPlatformLimits(platform).maxChars;
          const length = (variant ?? draftText).length;
          const over = length > limit;
          return (
            <li className="flex flex-col gap-1.5" key={platform}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">
                  {platformLabel(platform)}
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={
                      over
                        ? "text-destructive text-xs"
                        : "text-muted-foreground text-xs"
                    }
                  >
                    {length.toLocaleString()}/{limit.toLocaleString()}
                  </span>
                  {variant !== undefined && (
                    <Button
                      className="h-auto gap-1 px-2 py-1 text-xs"
                      onClick={() => clearPlatformVariant(platform)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <RotateCcw className="size-3" />
                      Revert
                    </Button>
                  )}
                </div>
              </div>
              {variant === undefined ? (
                <p className="text-muted-foreground text-xs italic">
                  Using your draft as-is. Reformat to generate a variant.
                </p>
              ) : (
                <Textarea
                  aria-label={`${platformLabel(platform)} variant`}
                  onChange={(e) => setPlatformVariant(platform, e.target.value)}
                  rows={4}
                  value={variant}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
