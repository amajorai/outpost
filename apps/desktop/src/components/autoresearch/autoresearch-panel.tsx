/**
 * The Autoresearch section's main panel (U27).
 *
 * A Karpathy-autoresearch-style closed loop for attention. Two surfaces:
 *  - the strategy editor: the user-editable `program.md` analog (goals, voice,
 *    niche, guardrails) plus the single goal metric + observation window that
 *    turn the prose into a concrete experiment. The markdown steers the AI
 *    proposal; the metric + window steer the U25 experiment that scores it.
 *  - the loop: "Run iteration" proposes a change + starts the experiment (the
 *    step boundary, recorded `pending`); "Score" evaluates it and keeps or
 *    discards. The full iteration history is listed — kept AND discarded — and
 *    each proposed hook can be opened in the composer.
 *
 * Loading mirrors `ExperimentsPanel`: refresh on mount, render from the store.
 * The store owns the lifecycle; this view is presentation plus the editor form.
 */

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Textarea } from "@repo/ui/textarea";
import { ArrowUpRight, Loader2, Save, Telescope, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { platformLabel } from "@/components/compose/platform-meta";
import { getSectionMeta } from "@/components/nav/sections";
import type { ExperimentGoalMetric } from "@/lib/social-schema";
import {
  decodeProposal,
  useAutoresearchStore,
} from "@/stores/use-autoresearch-store";
import { useComposerStore } from "@/stores/use-composer-store";
import { useNavigationStore } from "@/stores/use-navigation-store";

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
const NUMBER_FORMAT = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 4,
});

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

function StrategyEditor() {
  const strategy = useAutoresearchStore((s) => s.strategy);
  const isSaving = useAutoresearchStore((s) => s.isSaving);
  const saveStrategy = useAutoresearchStore((s) => s.saveStrategy);

  const [content, setContent] = useState("");
  const [goalMetric, setGoalMetric] =
    useState<ExperimentGoalMetric>("engagement_rate");
  const [windowHours, setWindowHours] = useState(String(DEFAULT_WINDOW_HOURS));

  // Sync local form state once the strategy loads (or changes underneath us).
  useEffect(() => {
    if (strategy) {
      setContent(strategy.content);
      setGoalMetric(strategy.goalMetric);
      setWindowHours(String(strategy.observationWindowHours));
    }
  }, [strategy]);

  const submit = async () => {
    const parsedHours = Number.parseInt(windowHours, 10);
    await saveStrategy({
      content,
      goalMetric,
      observationWindowHours: Number.isFinite(parsedHours)
        ? parsedHours
        : DEFAULT_WINDOW_HOURS,
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1.5">
        <label className="font-medium text-sm" htmlFor="strategy-content">
          Strategy document
        </label>
        <p className="text-muted-foreground text-xs">
          Your program.md: the goals, voice, niche, and guardrails that steer
          every proposal.
        </p>
        <Textarea
          className="min-h-48 font-mono text-sm"
          id="strategy-content"
          onChange={(event) => setContent(event.target.value)}
          placeholder="# Strategy…"
          value={content}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-medium text-sm">Goal metric</span>
        <p className="text-muted-foreground text-xs">
          The single hard metric every iteration is scored against.
        </p>
        <SelectPills
          onSelect={setGoalMetric}
          options={GOAL_METRICS}
          selected={goalMetric}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="font-medium text-sm" htmlFor="strategy-window">
          Observation window (hours)
        </label>
        <Input
          className="max-w-32"
          id="strategy-window"
          min={1}
          onChange={(event) => setWindowHours(event.target.value)}
          type="number"
          value={windowHours}
        />
      </div>

      <div>
        <Button disabled={isSaving} onClick={submit} size="sm" type="button">
          {isSaving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Save strategy
        </Button>
      </div>
    </div>
  );
}

function DecisionBadge({ decision }: { decision: string }) {
  if (decision === "kept") {
    return <Badge variant="default">Kept</Badge>;
  }
  if (decision === "discarded") {
    return <Badge variant="outline">Discarded</Badge>;
  }
  return <Badge variant="secondary">Pending</Badge>;
}

function IterationCard({ iterationId }: { iterationId: string }) {
  const iteration = useAutoresearchStore((s) =>
    s.iterations.find((row) => row.id === iterationId)
  );
  const strategy = useAutoresearchStore((s) => s.strategy);
  const scoringId = useAutoresearchStore((s) => s.scoringId);
  const scoreIteration = useAutoresearchStore((s) => s.scoreIteration);
  const loadText = useComposerStore((s) => s.loadText);
  const setActiveSection = useNavigationStore((s) => s.setActiveSection);

  const proposal = useMemo(
    () => (iteration ? decodeProposal(iteration) : null),
    [iteration]
  );

  if (!iteration) {
    return null;
  }

  const isScoring = scoringId === iteration.id;
  const goalMetric = strategy?.goalMetric ?? "engagement_rate";

  const openInComposer = async () => {
    if (!proposal) {
      return;
    }
    await loadText(proposal.body, proposal.targetPlatform);
    await setActiveSection("compose");
  };

  return (
    <li className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm">
          Iteration {iteration.iterationNumber}
        </span>
        <DecisionBadge decision={iteration.decision} />
        {iteration.metricValue !== null ? (
          <span className="ml-auto flex items-center gap-1 text-muted-foreground text-xs">
            {iteration.decision === "kept" ? (
              <Trophy className="size-3.5 text-primary" />
            ) : null}
            {goalMetricLabel(goalMetric)}:{" "}
            {NUMBER_FORMAT.format(iteration.metricValue)}
          </span>
        ) : null}
      </div>

      {proposal ? (
        <div className="flex flex-col gap-1.5">
          <p className="font-medium text-sm">{proposal.hook}</p>
          <p className="whitespace-pre-wrap text-muted-foreground text-sm">
            {proposal.body}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
            <Badge variant="outline">
              {platformLabel(proposal.targetPlatform)}
            </Badge>
            <span>· {proposal.format}</span>
            <span>· {proposal.timing}</span>
          </div>
          {proposal.rationale ? (
            <p className="text-muted-foreground text-xs italic">
              {proposal.rationale}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">Proposal unavailable.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {iteration.decision === "pending" && iteration.experimentId ? (
          <Button
            disabled={isScoring}
            onClick={() =>
              scoreIteration(iteration.id, iteration.experimentId as string)
            }
            size="sm"
            type="button"
          >
            {isScoring ? <Loader2 className="size-4 animate-spin" /> : null}
            Score &amp; decide
          </Button>
        ) : null}
        {proposal ? (
          <Button
            onClick={openInComposer}
            size="sm"
            type="button"
            variant="outline"
          >
            <ArrowUpRight className="size-4" />
            Open in composer
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function BestSummary() {
  const iterations = useAutoresearchStore((s) => s.iterations);
  const strategy = useAutoresearchStore((s) => s.strategy);

  const best = useMemo(() => {
    let current: (typeof iterations)[number] | null = null;
    for (const iteration of iterations) {
      if (iteration.decision !== "kept" || iteration.metricValue === null) {
        continue;
      }
      if (
        current === null ||
        iteration.metricValue > (current.metricValue ?? 0)
      ) {
        current = iteration;
      }
    }
    return current;
  }, [iterations]);

  if (!best) {
    return null;
  }
  const proposal = decodeProposal(best);
  const goalMetric = strategy?.goalMetric ?? "engagement_rate";

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-primary bg-primary/5 p-4">
      <div className="flex items-center gap-1.5 font-medium text-primary text-sm">
        <Trophy className="size-4" />
        Current best (iteration {best.iterationNumber})
      </div>
      {proposal ? (
        <p className="text-foreground text-sm">{proposal.hook}</p>
      ) : null}
      <p className="text-muted-foreground text-xs">
        {goalMetricLabel(goalMetric)}:{" "}
        {NUMBER_FORMAT.format(best.metricValue ?? 0)}
      </p>
    </div>
  );
}

export function AutoresearchPanel() {
  const { label, description } = getSectionMeta("autoresearch");
  const iterations = useAutoresearchStore((s) => s.iterations);
  const isLoading = useAutoresearchStore((s) => s.isLoading);
  const isRunning = useAutoresearchStore((s) => s.isRunning);
  const error = useAutoresearchStore((s) => s.error);
  const refresh = useAutoresearchStore((s) => s.refresh);
  const runIteration = useAutoresearchStore((s) => s.runIteration);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isEmpty = iterations.length === 0;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6">
      <header className="flex items-start justify-between gap-4 pb-4">
        <div>
          <h1 className="font-semibold text-xl tracking-tight">{label}</h1>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        <Button disabled={isRunning} onClick={runIteration} size="sm">
          {isRunning ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Telescope className="size-4" />
          )}
          Run iteration
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <StrategyEditor />

        <BestSummary />

        <div className="flex flex-col gap-2">
          <h2 className="font-medium text-sm">Iteration history</h2>
          {isEmpty ? (
            <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Telescope className="size-6" strokeWidth={1.5} />
              </div>
              <p className="max-w-sm text-balance text-muted-foreground text-sm">
                {isLoading
                  ? "Loading the loop…"
                  : "No iterations yet. Save a strategy, then run an iteration to propose, test, and score a change."}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {iterations.map((iteration) => (
                <IterationCard iterationId={iteration.id} key={iteration.id} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
