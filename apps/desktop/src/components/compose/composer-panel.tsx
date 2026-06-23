/**
 * The Compose section's main panel (U8).
 *
 * Typefully-clean: a single centered column. Compose text and attach media on the
 * left, a live per-platform preview on the right. Pick target accounts, then save
 * a draft, schedule for a time, or post now. The schedule/post-now actions are
 * gated on the post validating against every selected platform's limits.
 */

import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { CalendarClock, Loader2, Save, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSectionMeta } from "@/components/nav/sections";
import { validateSegmentsForPlatform } from "@/lib/compose/platform-limits";
import { useBrandKitStore } from "@/stores/use-brand-kit-store";
import { useComposerStore } from "@/stores/use-composer-store";
import { useIntegrationStore } from "@/stores/use-integration-store";
import { ComposePreview, type PreviewGroup } from "./compose-preview";
import { DraftsDialog } from "./drafts-dialog";
import { HashtagSuggestions } from "./hashtag-suggestions";
import { PerformancePredictor } from "./performance-predictor";
import { platformLabel } from "./platform-meta";
import { ReformatPanel } from "./reformat-panel";
import { SegmentEditor } from "./segment-editor";
import { TargetPicker } from "./target-picker";
import { TemplatesDialog } from "./templates-dialog";
import { TimingSuggestions } from "./timing-suggestions";
import { WatermarkControls } from "./watermark-controls";

/** Matches one or more whitespace chars; top-level per lint/performance. */
const WHITESPACE_RE = /\s+/;

/** Format a date as a `datetime-local` value (YYYY-MM-DDTHH:mm) in local time. */
function toScheduleValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A default schedule time: rounded to the next quarter hour, local time. */
function defaultScheduleValue(): string {
  const now = new Date(Date.now() + 15 * 60 * 1000);
  now.setSeconds(0, 0);
  return toScheduleValue(now);
}

export function ComposerPanel() {
  const { label, description } = getSectionMeta("compose");

  const segments = useComposerStore((s) => s.segments);
  const accounts = useComposerStore((s) => s.accounts);
  const selectedAccountIds = useComposerStore((s) => s.selectedAccountIds);
  const isSubmitting = useComposerStore((s) => s.isSubmitting);
  const error = useComposerStore((s) => s.error);
  const loadAccounts = useComposerStore((s) => s.loadAccounts);
  const setText = useComposerStore((s) => s.setText);
  const addMedia = useComposerStore((s) => s.addMedia);
  const removeMedia = useComposerStore((s) => s.removeMedia);
  const addSegment = useComposerStore((s) => s.addSegment);
  const removeSegment = useComposerStore((s) => s.removeSegment);
  const moveSegment = useComposerStore((s) => s.moveSegment);
  const toggleAccount = useComposerStore((s) => s.toggleAccount);
  const save = useComposerStore((s) => s.save);
  const schedule = useComposerStore((s) => s.schedule);
  const postNow = useComposerStore((s) => s.postNow);
  const reset = useComposerStore((s) => s.reset);
  const consumeScheduledAt = useComposerStore((s) => s.consumeScheduledAt);
  const watermarkPlatforms = useComposerStore((s) => s.watermarkPlatforms);
  const toggleWatermarkPlatform = useComposerStore(
    (s) => s.toggleWatermarkPlatform
  );

  const capabilityMatrix = useIntegrationStore((s) => s.capabilityMatrix);
  const refreshIntegration = useIntegrationStore((s) => s.refresh);

  const brandKit = useBrandKitStore((s) => s.kit);
  const loadBrandKit = useBrandKitStore((s) => s.load);

  const [scheduleValue, setScheduleValue] = useState(defaultScheduleValue);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    loadAccounts();
    refreshIntegration();
    loadBrandKit();
    // If the calendar handed us a slot time (U11), seed the schedule field.
    const pending = consumeScheduledAt();
    if (pending !== null) {
      setScheduleValue(toScheduleValue(new Date(pending)));
    }
  }, [loadAccounts, refreshIntegration, loadBrandKit, consumeScheduledAt]);

  const selectedAccounts = useMemo(
    () => accounts.filter((a) => selectedAccountIds.includes(a.id)),
    [accounts, selectedAccountIds]
  );

  // Group selected accounts by platform for the preview.
  const previewGroups = useMemo<PreviewGroup[]>(() => {
    const byPlatform = new Map<string, string[]>();
    for (const account of selectedAccounts) {
      const labels = byPlatform.get(account.platform) ?? [];
      labels.push(account.accountLabel);
      byPlatform.set(account.platform, labels);
    }
    return [...byPlatform.entries()].map(([platform, accountLabels]) => ({
      platform,
      accountLabels,
    }));
  }, [selectedAccounts]);

  // Distinct platforms across the selected accounts, for hashtag research (U14).
  const selectedPlatforms = useMemo(
    () => [...new Set(selectedAccounts.map((a) => a.platform))],
    [selectedAccounts]
  );

  // The set of platforms the brand watermark applies to for this post (U13).
  const watermarkPlatformSet = useMemo(
    () => new Set(watermarkPlatforms),
    [watermarkPlatforms]
  );

  // The chosen schedule time as epoch millis, for the performance predictor's
  // posting-time fit (U24). Null when the field is empty/unparseable so timing
  // contributes a neutral default rather than a penalty.
  const scheduledForMillis = useMemo<number | null>(() => {
    const at = new Date(scheduleValue).getTime();
    return Number.isNaN(at) ? null : at;
  }, [scheduleValue]);

  // Insert a researched hashtag/keyword into the primary segment. Dedupes so a
  // repeated click is a no-op, and adds a separating space when needed. We only
  // target segments[0] (the primary post) to keep insertion unambiguous.
  const handleInsertSuggestion = useCallback(
    (value: string) => {
      const current = segments[0]?.text ?? "";
      const tokens = current.split(WHITESPACE_RE);
      if (tokens.includes(value)) {
        return;
      }
      const needsSpace = current.length > 0 && !current.endsWith(" ");
      setText(`${current}${needsSpace ? " " : ""}${value}`, 0);
    },
    [segments, setText]
  );

  // Validate against every selected platform. The first failing platform's
  // reason gates scheduling, with the platform name for clarity.
  const validationError = useMemo<string | null>(() => {
    if (selectedAccounts.length === 0) {
      return "Select at least one account";
    }
    const seen = new Set<string>();
    for (const account of selectedAccounts) {
      if (seen.has(account.platform)) {
        continue;
      }
      seen.add(account.platform);
      const reason = validateSegmentsForPlatform(account.platform, segments);
      if (reason) {
        return `${platformLabel(account.platform)}: ${reason}`;
      }
    }
    return null;
  }, [selectedAccounts, segments]);

  const canSubmit = validationError === null && !isSubmitting;

  const handleSave = useCallback(async () => {
    setSavedNotice(null);
    try {
      await save();
      setSavedNotice("Draft saved");
    } catch {
      // error is surfaced by the store
    }
  }, [save]);

  const handleSchedule = useCallback(async () => {
    setSavedNotice(null);
    const at = new Date(scheduleValue).getTime();
    if (Number.isNaN(at)) {
      return;
    }
    try {
      await schedule(at);
      setSavedNotice("Scheduled");
      reset();
      setScheduleValue(defaultScheduleValue());
    } catch {
      // error is surfaced by the store
    }
  }, [schedule, scheduleValue, reset]);

  const handlePostNow = useCallback(async () => {
    setSavedNotice(null);
    try {
      await postNow();
      setSavedNotice("Posting now");
      reset();
      setScheduleValue(defaultScheduleValue());
    } catch {
      // error is surfaced by the store
    }
  }, [postNow, reset]);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-semibold text-2xl tracking-tight">{label}</h1>
            <p className="text-muted-foreground text-sm">{description}</p>
          </div>
          <div className="flex items-center gap-1">
            <TemplatesDialog />
            <DraftsDialog />
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* Editor column */}
          <div className="flex flex-col gap-5">
            <SegmentEditor
              onAddMedia={addMedia}
              onAddSegment={addSegment}
              onMoveSegment={moveSegment}
              onRemoveMedia={removeMedia}
              onRemoveSegment={removeSegment}
              onSetText={setText}
              segments={segments}
            />

            <div className="flex flex-col gap-2">
              <span className="font-medium text-sm">Post to</span>
              <TargetPicker
                accounts={accounts}
                capabilityMatrix={capabilityMatrix}
                onToggle={toggleAccount}
                selectedAccountIds={selectedAccountIds}
              />
            </div>

            <HashtagSuggestions
              onInsert={handleInsertSuggestion}
              platforms={selectedPlatforms}
              text={segments[0]?.text ?? ""}
            />

            <PerformancePredictor
              media={segments[0]?.media ?? []}
              platforms={selectedPlatforms}
              scheduledFor={scheduledForMillis}
              text={segments[0]?.text ?? ""}
            />

            <WatermarkControls
              appliedPlatforms={watermarkPlatformSet}
              hasWatermark={brandKit.watermark !== null}
              onToggle={toggleWatermarkPlatform}
              platforms={selectedPlatforms}
            />

            <ReformatPanel capabilityMatrix={capabilityMatrix} />
          </div>

          {/* Preview column */}
          <div className="flex flex-col gap-2">
            <span className="font-medium text-sm">Preview</span>
            <ComposePreview
              groups={previewGroups}
              segments={segments}
              watermark={brandKit.watermark}
              watermarkPlatforms={watermarkPlatformSet}
            />
          </div>
        </div>

        {/* Schedule + actions */}
        <div className="flex flex-col gap-3 border-t pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <label
              className="font-medium text-muted-foreground text-sm"
              htmlFor="schedule-at"
            >
              Schedule for
            </label>
            <Input
              className="w-fit"
              id="schedule-at"
              onChange={(e) => setScheduleValue(e.target.value)}
              type="datetime-local"
              value={scheduleValue}
            />
          </div>

          <TimingSuggestions
            onApply={(epochMillis) =>
              setScheduleValue(toScheduleValue(new Date(epochMillis)))
            }
            platforms={selectedPlatforms}
          />

          {validationError && (
            <p className="text-destructive text-sm" role="alert">
              {validationError}
            </p>
          )}
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
          {savedNotice && !error && (
            <p className="text-emerald-600 text-sm dark:text-emerald-400">
              {savedNotice}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={isSubmitting}
              onClick={handleSave}
              type="button"
              variant="outline"
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save draft
            </Button>
            <Button
              disabled={!canSubmit}
              onClick={handleSchedule}
              type="button"
              variant="outline"
            >
              <CalendarClock className="size-4" />
              Schedule
            </Button>
            <Button disabled={!canSubmit} onClick={handlePostNow} type="button">
              <Send className="size-4" />
              Post now
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
