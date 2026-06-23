/**
 * The Experiments section's main panel (U25).
 *
 * The attention layer's front door: create an A/B/n experiment over content (and
 * timing) variants for one goal metric, publish all variants through the existing
 * publish pipeline, then after the observation window measure each variant's
 * engagement and crown a winner.
 *
 * Loading mirrors `ActivityPanel`: refresh on mount, render from the store. The
 * store owns the create -> start -> evaluate lifecycle; this view is presentation
 * plus a small create form.
 */

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Textarea } from "@repo/ui/textarea";
import { FlaskConical, Loader2, Plus, Trophy, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { platformLabel } from "@/components/compose/platform-meta";
import { getSectionMeta } from "@/components/nav/sections";
import { PLATFORMS, type Platform } from "@/lib/providers/types";
import { emptyDraftBody, encodeDraftBody } from "@/lib/repos/drafts";
import type {
  ExperimentGoalMetric,
  ExperimentResult,
} from "@/lib/social-schema";
import {
  type ExperimentWithDetail,
  useExperimentsStore,
} from "@/stores/use-experiments-store";

const GOAL_METRICS: { value: ExperimentGoalMetric; label: string }[] = [
  { value: "likes", label: "Likes" },
  { value: "comments", label: "Comments" },
  { value: "views", label: "Views" },
  { value: "engagement_rate", label: "Engagement rate" },
];

function goalMetricLabel(metric: ExperimentGoalMetric): string {
  return GOAL_METRICS.find((m) => m.value === metric)?.label ?? metric;
}

const DEFAULT_WINDOW_HOURS = 24;
const MS_PER_HOUR = 3_600_000;
const NUMBER_FORMAT = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 4,
});

/**
 * Best-effort end of the observation window. We have no persisted publish
 * timestamp in the store, so we anchor on `createdAt` (publishing a draft
 * follows creation promptly). The engine itself doesn't block on the window;
 * this gate keeps the UI honest about the field rather than offering an
 * always-live "Measure" the instant an experiment starts running.
 */
function windowEndsAt(createdAt: number, windowHours: number): number {
  return createdAt + windowHours * MS_PER_HOUR;
}

/** A single editable variant row in the create form. */
interface DraftVariant {
  key: string;
  label: string;
  platform: Platform;
  body: string;
}

function makeDraftVariant(index: number): DraftVariant {
  return {
    key: crypto.randomUUID(),
    label: `Variant ${String.fromCharCode(65 + index)}`,
    platform: "x",
    body: "",
  };
}

interface SelectPillsProps<T extends string> {
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
}

function SelectPills<T extends string>({
  options,
  selected,
  onSelect,
}: SelectPillsProps<T>) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <Button
          key={option.value}
          onClick={() => onSelect(option.value)}
          size="sm"
          type="button"
          variant={selected === option.value ? "default" : "outline"}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

const PLATFORM_OPTIONS = PLATFORMS.map((platform) => ({
  value: platform,
  label: platformLabel(platform),
}));

interface CreateFormProps {
  onCancel: () => void;
}

function CreateForm({ onCancel }: CreateFormProps) {
  const create = useExperimentsStore((s) => s.create);

  const [name, setName] = useState("");
  const [goalMetric, setGoalMetric] = useState<ExperimentGoalMetric>("likes");
  const [windowHours, setWindowHours] = useState(String(DEFAULT_WINDOW_HOURS));
  const [variants, setVariants] = useState<DraftVariant[]>([
    makeDraftVariant(0),
    makeDraftVariant(1),
  ]);
  const [isSaving, setIsSaving] = useState(false);

  const canSubmit =
    name.trim().length > 0 &&
    variants.length >= 2 &&
    variants.every((variant) => variant.body.trim().length > 0);

  const updateVariant = (key: string, patch: Partial<DraftVariant>) => {
    setVariants((prev) =>
      prev.map((variant) =>
        variant.key === key ? { ...variant, ...patch } : variant
      )
    );
  };

  const addVariant = () => {
    setVariants((prev) => [...prev, makeDraftVariant(prev.length)]);
  };

  const removeVariant = (key: string) => {
    setVariants((prev) => prev.filter((variant) => variant.key !== key));
  };

  const submit = async () => {
    if (!canSubmit) {
      return;
    }
    setIsSaving(true);
    try {
      const parsedHours = Number.parseInt(windowHours, 10);
      await create({
        name: name.trim(),
        goalMetric,
        observationWindowHours: Number.isFinite(parsedHours)
          ? parsedHours
          : DEFAULT_WINDOW_HOURS,
        variants: variants.map((variant) => {
          // encodeDraftBody normalizes to the current schema version + mirrors
          // segments[0] into the top-level text, so the variant body matches
          // what the composer/publish path expects.
          const body = emptyDraftBody();
          body.text = variant.body.trim();
          body.segments = [{ text: variant.body.trim(), media: [] }];
          return {
            label: variant.label.trim() || "Variant",
            targetPlatform: variant.platform,
            draftBody: encodeDraftBody(body),
          };
        }),
      });
      onCancel();
    } catch {
      // The store logs the failure; keep the form open so the user can retry.
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1.5">
        <label className="font-medium text-sm" htmlFor="experiment-name">
          Experiment name
        </label>
        <Input
          id="experiment-name"
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Hook A vs Hook B"
          value={name}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-medium text-sm">Goal metric</span>
        <SelectPills
          onSelect={setGoalMetric}
          options={GOAL_METRICS}
          selected={goalMetric}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="font-medium text-sm" htmlFor="experiment-window">
          Observation window (hours)
        </label>
        <Input
          className="max-w-32"
          id="experiment-window"
          min={1}
          onChange={(event) => setWindowHours(event.target.value)}
          type="number"
          value={windowHours}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-medium text-sm">Variants</span>
        {variants.map((variant, index) => (
          <div
            className="flex flex-col gap-2 rounded-md border border-border p-3"
            key={variant.key}
          >
            <div className="flex items-center gap-2">
              <Input
                aria-label={`Variant ${index + 1} label`}
                className="max-w-48"
                onChange={(event) =>
                  updateVariant(variant.key, { label: event.target.value })
                }
                value={variant.label}
              />
              {variants.length > 2 ? (
                <Button
                  aria-label={`Remove ${variant.label}`}
                  className="ml-auto"
                  onClick={() => removeVariant(variant.key)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <X className="size-4" />
                </Button>
              ) : null}
            </div>
            <SelectPills
              onSelect={(platform) => updateVariant(variant.key, { platform })}
              options={PLATFORM_OPTIONS}
              selected={variant.platform}
            />
            <Textarea
              aria-label={`Variant ${index + 1} body`}
              onChange={(event) =>
                updateVariant(variant.key, { body: event.target.value })
              }
              placeholder="What should this variant post?"
              rows={3}
              value={variant.body}
            />
          </div>
        ))}
        <Button
          className="self-start"
          onClick={addVariant}
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus className="size-4" />
          Add variant
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button
          disabled={!canSubmit || isSaving}
          onClick={submit}
          type="button"
        >
          {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
          Create experiment
        </Button>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: ExperimentWithDetail["experiment"]["status"];
}) {
  if (status === "complete") {
    return <Badge variant="default">Complete</Badge>;
  }
  if (status === "running") {
    return <Badge variant="secondary">Running</Badge>;
  }
  return <Badge variant="outline">Draft</Badge>;
}

interface VariantRowProps {
  variant: ExperimentWithDetail["variants"][number];
  result: ExperimentResult | undefined;
  goalMetric: ExperimentGoalMetric;
}

function VariantResultRow({ variant, result, goalMetric }: VariantRowProps) {
  const isWinner = result?.isWinner === 1;
  return (
    <li
      className={`flex items-center gap-2 rounded-md border p-2.5 ${
        isWinner ? "border-primary bg-primary/5" : "border-border"
      }`}
    >
      <Badge variant="outline">{platformLabel(variant.targetPlatform)}</Badge>
      <span className="font-medium text-sm">{variant.label}</span>
      {isWinner ? (
        <span className="flex items-center gap-1 text-primary text-xs">
          <Trophy className="size-3.5" /> Winner
        </span>
      ) : null}
      {result ? (
        <span className="ml-auto text-muted-foreground text-xs">
          {goalMetricLabel(goalMetric)}:{" "}
          {NUMBER_FORMAT.format(result.metricValue)}
        </span>
      ) : null}
    </li>
  );
}

function ExperimentCard({ item }: { item: ExperimentWithDetail }) {
  const { experiment, variants, results } = item;
  const start = useExperimentsStore((s) => s.start);
  const evaluate = useExperimentsStore((s) => s.evaluate);
  const busyId = useExperimentsStore((s) => s.busyId);
  const isBusy = busyId === experiment.id;

  const resultByVariant = useMemo(() => {
    const map = new Map<string, ExperimentResult>();
    for (const result of results) {
      map.set(result.variantId, result);
    }
    return map;
  }, [results]);

  const measurableAt = windowEndsAt(
    experiment.createdAt,
    experiment.observationWindowHours
  );
  const hoursLeft = Math.max(
    0,
    Math.ceil((measurableAt - Date.now()) / MS_PER_HOUR)
  );
  const windowOpen = hoursLeft > 0;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-base">{experiment.name}</h2>
        <StatusBadge status={experiment.status} />
        <Badge variant="outline">
          {goalMetricLabel(experiment.goalMetric)}
        </Badge>
        <span className="text-muted-foreground text-xs">
          {experiment.observationWindowHours}h window
        </span>
        <div className="ml-auto flex items-center gap-2">
          {experiment.status === "draft" ? (
            <Button
              disabled={isBusy}
              onClick={() => {
                start(experiment.id).catch(() => {
                  // Errors are logged in the store; swallow at the click
                  // boundary so a missing connected account can't surface an
                  // unhandled rejection.
                });
              }}
              size="sm"
            >
              {isBusy ? <Loader2 className="size-4 animate-spin" /> : null}
              Publish variants
            </Button>
          ) : null}
          {experiment.status === "running" ? (
            <Button
              disabled={isBusy || windowOpen}
              onClick={() => {
                evaluate(experiment.id).catch(() => {
                  // See start() above — store logs, click boundary swallows.
                });
              }}
              size="sm"
              variant="outline"
            >
              {isBusy ? <Loader2 className="size-4 animate-spin" /> : null}
              {windowOpen ? `Measurable in ${hoursLeft}h` : "Measure winner"}
            </Button>
          ) : null}
        </div>
      </div>

      <ul className="flex flex-col gap-1.5">
        {variants.map((variant) => (
          <VariantResultRow
            goalMetric={experiment.goalMetric}
            key={variant.id}
            result={resultByVariant.get(variant.id)}
            variant={variant}
          />
        ))}
      </ul>
    </li>
  );
}

export function ExperimentsPanel() {
  const { label, description } = getSectionMeta("experiments");
  const items = useExperimentsStore((s) => s.items);
  const isLoading = useExperimentsStore((s) => s.isLoading);
  const refresh = useExperimentsStore((s) => s.refresh);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isEmpty = items.length === 0;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6">
      <header className="flex items-start justify-between gap-4 pb-4">
        <div>
          <h1 className="font-semibold text-xl tracking-tight">{label}</h1>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        {isCreating ? null : (
          <Button onClick={() => setIsCreating(true)} size="sm">
            <Plus className="size-4" />
            New experiment
          </Button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {isCreating ? (
          <CreateForm onCancel={() => setIsCreating(false)} />
        ) : null}

        {isEmpty && !isCreating ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <FlaskConical className="size-6" strokeWidth={1.5} />
            </div>
            <p className="max-w-sm text-balance text-muted-foreground text-sm">
              {isLoading
                ? "Loading your experiments…"
                : "No experiments yet. Create one to A/B test your content and timing, then keep what wins."}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <ExperimentCard item={item} key={item.experiment.id} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
