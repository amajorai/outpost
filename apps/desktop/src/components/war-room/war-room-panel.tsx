/**
 * The War Room section's main panel (U29): the home dashboard / command center.
 *
 * The crew's standup: how attention is trending, what's working, the active
 * experiment's status, and each AI role's current recommendation with a
 * one-click "ship it." Loading mirrors `ActivityPanel`: refresh on mount, render
 * from `useWarRoomStore`. Everything here is derived from already-persisted data
 * via pure helpers. The dashboard never fires an AI call on mount; the
 * expensive generation (if any) happens in a card's action handler.
 *
 * Layout follows the acceptance criteria order: attention score (hero) ->
 * what's-working -> active experiment status -> the four role cards.
 */

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@repo/ui/chart";
import {
  ArrowRight,
  FlaskConical,
  Lightbulb,
  Loader2,
  Minus,
  PenLine,
  Radar as RadarIcon,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis } from "recharts";
import { toast } from "sonner";
import { platformLabel } from "@/components/compose/platform-meta";
import { engagementByDay, topPosts } from "@/lib/analytics/analytics";
import { decodeDraftBody } from "@/lib/repos/drafts";
import type { ActivityItem, Experiment } from "@/lib/social-schema";
import {
  formatSlot,
  nextOccurrence,
  type RecommendedSlot,
} from "@/lib/timing/recommender";
import {
  type AttentionScore,
  computeAttentionScore,
} from "@/lib/war-room/attention";
import { useComposerStore } from "@/stores/use-composer-store";
import { useNavigationStore } from "@/stores/use-navigation-store";
import { useWarRoomStore } from "@/stores/use-war-room-store";

const NUMBER_FORMAT = new Intl.NumberFormat();
const MAX_WHATS_WORKING = 3;
/** Characters of a post body shown in a compact preview before truncating. */
const PREVIEW_LENGTH = 120;

function formatCount(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function previewText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= PREVIEW_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, PREVIEW_LENGTH).trimEnd()}…`;
}

function postEngagement(item: ActivityItem): number {
  return item.likes + item.comments + item.shares;
}

const SCORE_CHART_CONFIG = {
  engagement: { label: "Engagement", color: "var(--primary)" },
} satisfies ChartConfig;

/** The hero attention-score card with a window-over-window trend + sparkline. */
function AttentionCard({
  score,
  items,
}: {
  score: AttentionScore;
  items: ActivityItem[];
}) {
  const series = useMemo(() => engagementByDay(items), [items]);

  let TrendIcon = Minus;
  let trendLabel = "Just getting started";
  let trendClass = "text-muted-foreground";
  if (score.trend === "up") {
    TrendIcon = TrendingUp;
    trendLabel = `Up ${score.changePct}% week over week`;
    trendClass = "text-emerald-500";
  } else if (score.trend === "down") {
    TrendIcon = TrendingDown;
    trendLabel = `Down ${Math.abs(score.changePct ?? 0)}% week over week`;
    trendClass = "text-rose-500";
  } else if (score.trend === "flat") {
    trendLabel = "Holding steady week over week";
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>Attention score</CardDescription>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <CardTitle className="font-semibold text-5xl tabular-nums">
              {score.score}
            </CardTitle>
            <span className="text-muted-foreground text-sm">/ 100</span>
          </div>
          <span className={`flex items-center gap-1.5 text-sm ${trendClass}`}>
            <TrendIcon className="size-4" />
            {trendLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          Recent engagement{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatCount(score.recentEngagement)}
          </span>{" "}
          across {score.recentPosts}{" "}
          {score.recentPosts === 1 ? "post" : "posts"} this week, vs{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatCount(score.priorEngagement)}
          </span>{" "}
          the week before.
        </p>
        {series.length > 1 ? (
          <ChartContainer className="h-24 w-full" config={SCORE_CHART_CONFIG}>
            <LineChart
              accessibilityLayer
              data={series}
              margin={{ left: 4, right: 4 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" hide />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                dataKey="engagement"
                dot={false}
                stroke="var(--color-engagement)"
                strokeWidth={2}
                type="monotone"
              />
            </LineChart>
          </ChartContainer>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The "what's working" card: the top-performing recent posts. */
function WhatsWorkingCard({ items }: { items: ActivityItem[] }) {
  const best = useMemo(
    () => topPosts(items, MAX_WHATS_WORKING).filter((item) => item.text),
    [items]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="size-4 text-amber-500" />
          What's working
        </CardTitle>
        <CardDescription>
          Your highest-engagement posts right now.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {best.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No tracked posts yet. Publish something and its performance will
            surface here.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {best.map((item) => (
              <li
                className="flex items-start justify-between gap-3"
                key={item.id}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm">
                    {previewText(item.text ?? "")}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {platformLabel(item.platform)}
                  </span>
                </div>
                <Badge className="shrink-0 tabular-nums" variant="secondary">
                  {formatCount(postEngagement(item))}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const EXPERIMENT_STATUS_LABEL: Record<Experiment["status"], string> = {
  draft: "Draft",
  running: "Running",
  complete: "Complete",
};

/** The active-experiment status card: the newest non-draft experiment. */
function ExperimentStatusCard({
  experiments,
  onGoToExperiments,
}: {
  experiments: Experiment[];
  onGoToExperiments: () => void;
}) {
  const active = useMemo(
    () =>
      experiments.find((e) => e.status === "running") ??
      experiments.find((e) => e.status === "complete") ??
      experiments[0] ??
      null,
    [experiments]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="size-4 text-violet-500" />
          Active experiment
        </CardTitle>
        <CardDescription>
          {active
            ? "Your most recent attention experiment."
            : "Run an A/B/n experiment to learn what wins."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {active ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium text-sm">
                {active.name}
              </span>
              <span className="text-muted-foreground text-xs">
                Optimizing for {active.goalMetric.replace("_", " ")}
              </span>
            </div>
            <Badge
              variant={active.status === "running" ? "default" : "secondary"}
            >
              {EXPERIMENT_STATUS_LABEL[active.status]}
            </Badge>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No experiments yet.</p>
        )}
        <Button
          className="self-start"
          onClick={onGoToExperiments}
          size="sm"
          variant="outline"
        >
          {active ? "Open experiments" : "Start an experiment"}
          <ArrowRight className="size-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

/** A single AI-role recommendation card with a one-click action. */
function RoleCard({
  roleName,
  icon: Icon,
  iconClass,
  recommendation,
  detail,
  actionLabel,
  onAction,
  disabled,
}: {
  roleName: string;
  icon: typeof Lightbulb;
  iconClass: string;
  recommendation: string;
  detail?: string;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
}) {
  const [isBusy, setIsBusy] = useState(false);

  const handleClick = useCallback(async () => {
    setIsBusy(true);
    try {
      await onAction();
    } finally {
      setIsBusy(false);
    }
  }, [onAction]);

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={`size-4 ${iconClass}`} />
          {roleName}
        </CardTitle>
        <CardDescription>{recommendation}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto flex flex-col gap-3">
        {detail ? (
          <p className="line-clamp-3 rounded-lg bg-muted px-3 py-2 text-muted-foreground text-sm">
            {detail}
          </p>
        ) : null}
        <Button
          className="self-start"
          disabled={disabled || isBusy}
          onClick={handleClick}
          size="sm"
        >
          {isBusy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ArrowRight className="size-4" />
          )}
          {actionLabel}
        </Button>
      </CardContent>
    </Card>
  );
}

export function WarRoomPanel() {
  const activityItems = useWarRoomStore((s) => s.activityItems);
  const experiments = useWarRoomStore((s) => s.experiments);
  const winners = useWarRoomStore((s) => s.winners);
  const signals = useWarRoomStore((s) => s.signals);
  const timing = useWarRoomStore((s) => s.timing);
  const isLoading = useWarRoomStore((s) => s.isLoading);
  const hasLoaded = useWarRoomStore((s) => s.hasLoaded);
  const refresh = useWarRoomStore((s) => s.refresh);

  const setActiveSection = useNavigationStore((s) => s.setActiveSection);
  const loadText = useComposerStore((s) => s.loadText);
  const prefillSchedule = useComposerStore((s) => s.prefillSchedule);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const score = useMemo(
    () => computeAttentionScore(activityItems),
    [activityItems]
  );

  // Researcher: surface the top radar signal as the next thing to write about.
  const topSignal = signals[0] ?? null;
  const handleResearcher = useCallback(async () => {
    if (topSignal) {
      const seed = topSignal.summary
        ? `${topSignal.title}\n\n${topSignal.summary}`
        : topSignal.title;
      await loadText(seed);
      await setActiveSection("compose");
      toast("Loaded the trending angle into the composer.");
      return;
    }
    await setActiveSection("radar");
  }, [topSignal, loadText, setActiveSection]);

  // Copywriter: re-run a proven winner, else your current best post.
  const copySeed = useMemo(() => {
    const winner = winners[0];
    if (winner) {
      return decodeDraftBody(winner.draftBody).text;
    }
    const best = topPosts(activityItems, 1).find((item) => item.text);
    return best?.text ?? "";
  }, [winners, activityItems]);
  const handleCopywriter = useCallback(async () => {
    if (!copySeed) {
      await setActiveSection("compose");
      return;
    }
    await loadText(copySeed);
    await setActiveSection("compose");
    toast("Loaded a proven draft into the composer.");
  }, [copySeed, loadText, setActiveSection]);
  const copywriterRecommendation = copywriterCopy(
    Boolean(winners[0]),
    copySeed
  );

  // Analyst: the strongest learned/default timing slot across platforms.
  const bestTiming = useMemo(() => {
    let best: { platform: string; slot: RecommendedSlot } | null = null;
    for (const [platform, recommendation] of timing) {
      const slot = recommendation.slots[0];
      if (!slot) {
        continue;
      }
      if (best === null || slot.avgEngagement > best.slot.avgEngagement) {
        best = { platform, slot };
      }
    }
    return best;
  }, [timing]);
  const handleAnalyst = useCallback(async () => {
    if (bestTiming) {
      prefillSchedule(nextOccurrence(bestTiming.slot).getTime());
    }
    await setActiveSection("compose");
    toast(
      bestTiming
        ? "Pre-filled the composer with your best posting time."
        : "Opened the composer."
    );
  }, [bestTiming, prefillSchedule, setActiveSection]);

  // Strategist: the single next-best-action given the workspace's state.
  const strategist = useMemo(
    () =>
      deriveStrategistAction({
        hasActivity: activityItems.length > 0,
        runningExperiment: experiments.find((e) => e.status === "running"),
        anyExperiment: experiments.length > 0,
      }),
    [activityItems, experiments]
  );
  const handleStrategist = useCallback(async () => {
    await setActiveSection(strategist.section);
  }, [strategist, setActiveSection]);

  const showEmpty = hasLoaded && activityItems.length === 0;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="font-semibold text-2xl tracking-tight">War Room</h1>
            <p className="text-muted-foreground text-sm">
              Your command center for everything in flight.
            </p>
          </div>
          <Button
            disabled={isLoading}
            onClick={() => refresh()}
            size="sm"
            type="button"
            variant="outline"
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh
          </Button>
        </header>

        {showEmpty ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm">
              Nothing tracked yet. Once you publish posts, the War Room fills
              with your attention score, what's working, and crew
              recommendations.
            </CardContent>
          </Card>
        ) : null}

        <AttentionCard items={activityItems} score={score} />

        <div className="grid gap-6 md:grid-cols-2">
          <WhatsWorkingCard items={activityItems} />
          <ExperimentStatusCard
            experiments={experiments}
            onGoToExperiments={() => setActiveSection("experiments")}
          />
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="font-medium text-lg tracking-tight">Crew on call</h2>
          <div className="grid gap-6 md:grid-cols-2">
            <RoleCard
              actionLabel={topSignal ? "Draft this angle" : "Open radar"}
              detail={topSignal?.title}
              icon={RadarIcon}
              iconClass="text-sky-500"
              onAction={handleResearcher}
              recommendation={
                topSignal
                  ? "A trending angle worth riding from your radar."
                  : "Add competitors and topics to your radar to surface angles."
              }
              roleName="Researcher"
            />
            <RoleCard
              actionLabel="Open in composer"
              detail={copySeed ? previewText(copySeed) : undefined}
              icon={PenLine}
              iconClass="text-emerald-500"
              onAction={handleCopywriter}
              recommendation={copywriterRecommendation}
              roleName="Copywriter"
            />
            <RoleCard
              actionLabel="Apply best time"
              detail={
                bestTiming
                  ? `${platformLabel(bestTiming.platform)} · ${formatSlot(
                      bestTiming.slot
                    )}`
                  : undefined
              }
              icon={Lightbulb}
              iconClass="text-amber-500"
              onAction={handleAnalyst}
              recommendation={
                bestTiming
                  ? "Schedule into your highest-engagement window."
                  : "Open the composer to schedule your next post."
              }
              roleName="Analyst"
            />
            <RoleCard
              actionLabel={strategist.actionLabel}
              icon={FlaskConical}
              iconClass="text-violet-500"
              onAction={handleStrategist}
              recommendation={strategist.recommendation}
              roleName="Strategist"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/** The Copywriter card's recommendation line, keyed on what seed we have. */
function copywriterCopy(hasWinner: boolean, seed: string): string {
  if (hasWinner) {
    return "Re-run a proven winner with a fresh spin.";
  }
  if (seed) {
    return "Build on your best-performing post.";
  }
  return "Start a fresh draft.";
}

interface StrategistAction {
  recommendation: string;
  actionLabel: string;
  section: "experiments" | "compose" | "radar";
}

/**
 * Derive the single next-best strategic action from the workspace's state. Pure
 * over a small state summary so the precedence is obvious: a running experiment
 * to check beats starting a new one, which beats simply publishing more.
 */
function deriveStrategistAction(state: {
  hasActivity: boolean;
  runningExperiment: Experiment | undefined;
  anyExperiment: boolean;
}): StrategistAction {
  if (state.runningExperiment) {
    return {
      recommendation:
        "An experiment is running. Check whether it's ready to call.",
      actionLabel: "Review experiment",
      section: "experiments",
    };
  }
  if (!state.hasActivity) {
    return {
      recommendation:
        "Publish your first posts so the crew has signal to learn from.",
      actionLabel: "Compose a post",
      section: "compose",
    };
  }
  if (!state.anyExperiment) {
    return {
      recommendation: "Run an A/B experiment to find what moves your metric.",
      actionLabel: "Start an experiment",
      section: "experiments",
    };
  }
  return {
    recommendation:
      "Keep shipping. Turn your best angle into the next experiment.",
    actionLabel: "Start an experiment",
    section: "experiments",
  };
}
