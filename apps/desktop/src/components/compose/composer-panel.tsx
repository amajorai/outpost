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
import { Textarea } from "@repo/ui/textarea";
import { CalendarClock, Loader2, Save, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSectionMeta } from "@/components/nav/sections";
import { validateForPlatform } from "@/lib/compose/platform-limits";
import { useComposerStore } from "@/stores/use-composer-store";
import { useIntegrationStore } from "@/stores/use-integration-store";
import { ComposePreview, type PreviewGroup } from "./compose-preview";
import { DraftsDialog } from "./drafts-dialog";
import { MediaAttachments } from "./media-attachments";
import { platformLabel } from "./platform-meta";
import { TargetPicker } from "./target-picker";

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

  const text = useComposerStore((s) => s.text);
  const media = useComposerStore((s) => s.media);
  const accounts = useComposerStore((s) => s.accounts);
  const selectedAccountIds = useComposerStore((s) => s.selectedAccountIds);
  const isSubmitting = useComposerStore((s) => s.isSubmitting);
  const error = useComposerStore((s) => s.error);
  const loadAccounts = useComposerStore((s) => s.loadAccounts);
  const setText = useComposerStore((s) => s.setText);
  const addMedia = useComposerStore((s) => s.addMedia);
  const removeMedia = useComposerStore((s) => s.removeMedia);
  const toggleAccount = useComposerStore((s) => s.toggleAccount);
  const save = useComposerStore((s) => s.save);
  const schedule = useComposerStore((s) => s.schedule);
  const postNow = useComposerStore((s) => s.postNow);
  const reset = useComposerStore((s) => s.reset);
  const consumeScheduledAt = useComposerStore((s) => s.consumeScheduledAt);

  const capabilityMatrix = useIntegrationStore((s) => s.capabilityMatrix);
  const refreshIntegration = useIntegrationStore((s) => s.refresh);

  const [scheduleValue, setScheduleValue] = useState(defaultScheduleValue);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    loadAccounts();
    refreshIntegration();
    // If the calendar handed us a slot time (U11), seed the schedule field.
    const pending = consumeScheduledAt();
    if (pending !== null) {
      setScheduleValue(toScheduleValue(new Date(pending)));
    }
  }, [loadAccounts, refreshIntegration, consumeScheduledAt]);

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
      const reason = validateForPlatform(account.platform, text, media);
      if (reason) {
        return `${platformLabel(account.platform)}: ${reason}`;
      }
    }
    return null;
  }, [selectedAccounts, text, media]);

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
          <DraftsDialog />
        </header>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* Editor column */}
          <div className="flex flex-col gap-5">
            <Textarea
              aria-label="Post text"
              autoFocus
              className="min-h-40 text-base"
              onChange={(e) => setText(e.target.value)}
              placeholder="What do you want to say?"
              value={text}
            />

            <MediaAttachments
              media={media}
              onAdd={addMedia}
              onRemove={removeMedia}
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
          </div>

          {/* Preview column */}
          <div className="flex flex-col gap-2">
            <span className="font-medium text-sm">Preview</span>
            <ComposePreview groups={previewGroups} media={media} text={text} />
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
