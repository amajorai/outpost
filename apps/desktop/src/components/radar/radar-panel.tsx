/**
 * The Radar section's main panel (U28).
 *
 * The competitor/trend radar. Two surfaces:
 *  - the target editor: add creators to track (a platform + @handle) and topics
 *    to watch (a keyword/phrase), and remove them. This is the user input.
 *  - the findings: cached signals grouped into competitor winners and rising
 *    trends, with a "Refresh radar" action that re-fetches every target
 *    (provider reads for creators, the AI agent for topics). Each finding can be
 *    opened in the composer as a starting point.
 *
 * Loading mirrors `AutoresearchPanel`: refresh on mount, render from the store.
 * The store owns the lifecycle; this view is presentation plus the editor forms.
 */

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import {
  ArrowUpRight,
  Loader2,
  Radar as RadarIcon,
  RefreshCw,
  Trophy,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { platformLabel } from "@/components/compose/platform-meta";
import { getSectionMeta } from "@/components/nav/sections";
import { PLATFORMS } from "@/lib/providers";
import type { RadarTarget, TrendSignal } from "@/lib/social-schema";
import { useComposerStore } from "@/stores/use-composer-store";
import { useNavigationStore } from "@/stores/use-navigation-store";
import { useRadarStore } from "@/stores/use-radar-store";

const RELATIVE_TIME = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function staleness(lastFetchedAt: number | null): string {
  if (lastFetchedAt === null) {
    return "Never refreshed";
  }
  const elapsed = Date.now() - lastFetchedAt;
  if (elapsed < HOUR_MS) {
    return `Updated ${RELATIVE_TIME.format(-Math.round(elapsed / 60_000), "minute")}`;
  }
  if (elapsed < DAY_MS) {
    return `Updated ${RELATIVE_TIME.format(-Math.round(elapsed / HOUR_MS), "hour")}`;
  }
  return `Updated ${RELATIVE_TIME.format(-Math.round(elapsed / DAY_MS), "day")}`;
}

function AddCompetitorForm() {
  const addTarget = useRadarStore((s) => s.addTarget);
  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState<string>(PLATFORMS[0]);

  const submit = async () => {
    const value = handle.trim();
    if (value.length === 0) {
      return;
    }
    await addTarget({ kind: "competitor", value, platform });
    setHandle("");
  };

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-1">
        <label className="font-medium text-xs" htmlFor="radar-platform">
          Platform
        </label>
        <select
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          id="radar-platform"
          onChange={(event) => setPlatform(event.target.value)}
          value={platform}
        >
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {platformLabel(p)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <label className="font-medium text-xs" htmlFor="radar-handle">
          Creator handle
        </label>
        <Input
          id="radar-handle"
          onChange={(event) => setHandle(event.target.value)}
          placeholder="@creator"
          value={handle}
        />
      </div>
      <Button size="sm" type="submit">
        Track creator
      </Button>
    </form>
  );
}

function AddTopicForm() {
  const addTarget = useRadarStore((s) => s.addTarget);
  const [keyword, setKeyword] = useState("");

  const submit = async () => {
    const value = keyword.trim();
    if (value.length === 0) {
      return;
    }
    await addTarget({ kind: "topic", value });
    setKeyword("");
  };

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <label className="font-medium text-xs" htmlFor="radar-topic">
          Topic / keyword
        </label>
        <Input
          id="radar-topic"
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="e.g. indie hacking"
          value={keyword}
        />
      </div>
      <Button size="sm" type="submit" variant="outline">
        Track topic
      </Button>
    </form>
  );
}

function TargetChip({ target }: { target: RadarTarget }) {
  const removeTarget = useRadarStore((s) => s.removeTarget);
  const prefix =
    target.kind === "competitor" && target.platform
      ? `${platformLabel(target.platform)} · `
      : "";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 py-1 pr-1 pl-3 text-sm">
      <span>
        {prefix}
        {target.label ?? target.value}
      </span>
      <Button
        aria-label={`Remove ${target.value}`}
        className="size-6"
        onClick={() => removeTarget(target.id)}
        size="icon"
        type="button"
        variant="ghost"
      >
        <X className="size-3.5" />
      </Button>
    </span>
  );
}

function SignalCard({ signal }: { signal: TrendSignal }) {
  const loadText = useComposerStore((s) => s.loadText);
  const setActiveSection = useNavigationStore((s) => s.setActiveSection);

  const openInComposer = async () => {
    const seed = signal.summary ?? signal.title;
    await loadText(seed, signal.platform ?? undefined);
    await setActiveSection("compose");
  };

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        {signal.kind === "creator-winner" ? (
          <Trophy className="size-4 text-primary" />
        ) : null}
        <span className="font-medium text-sm">{signal.title}</span>
        {signal.platform ? (
          <Badge className="ml-auto" variant="outline">
            {platformLabel(signal.platform)}
          </Badge>
        ) : null}
      </div>
      {signal.summary ? (
        <p className="whitespace-pre-wrap text-muted-foreground text-sm">
          {signal.summary}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={openInComposer}
          size="sm"
          type="button"
          variant="outline"
        >
          <ArrowUpRight className="size-4" />
          Open in composer
        </Button>
        {signal.url ? (
          <a
            className="text-muted-foreground text-xs underline-offset-2 hover:underline"
            href={signal.url}
            rel="noopener noreferrer"
            target="_blank"
          >
            View source
          </a>
        ) : null}
      </div>
    </li>
  );
}

function SignalGroup({
  title,
  signals,
}: {
  title: string;
  signals: TrendSignal[];
}) {
  if (signals.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-medium text-sm">{title}</h2>
      <ul className="flex flex-col gap-3">
        {signals.map((signal) => (
          <SignalCard key={signal.id} signal={signal} />
        ))}
      </ul>
    </div>
  );
}

export function RadarPanel() {
  const { label, description } = getSectionMeta("radar");
  const targets = useRadarStore((s) => s.targets);
  const signals = useRadarStore((s) => s.signals);
  const isLoading = useRadarStore((s) => s.isLoading);
  const isRefreshing = useRadarStore((s) => s.isRefreshing);
  const lastFetchedAt = useRadarStore((s) => s.lastFetchedAt);
  const error = useRadarStore((s) => s.error);
  const refresh = useRadarStore((s) => s.refresh);
  const runRefresh = useRadarStore((s) => s.runRefresh);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const winners = useMemo(
    () => signals.filter((s) => s.kind === "creator-winner"),
    [signals]
  );
  const trends = useMemo(
    () => signals.filter((s) => s.kind === "trend"),
    [signals]
  );

  const hasTargets = targets.length > 0;
  const hasSignals = signals.length > 0;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6">
      <header className="flex items-start justify-between gap-4 pb-4">
        <div>
          <h1 className="font-semibold text-xl tracking-tight">{label}</h1>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button
            disabled={isRefreshing || !hasTargets}
            onClick={runRefresh}
            size="sm"
          >
            {isRefreshing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh radar
          </Button>
          <span className="text-muted-foreground text-xs">
            {staleness(lastFetchedAt)}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <AddCompetitorForm />
          <AddTopicForm />
          {hasTargets ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {targets.map((target) => (
                <TargetChip key={target.id} target={target} />
              ))}
            </div>
          ) : null}
        </div>

        {hasSignals ? (
          <>
            <SignalGroup signals={winners} title="Competitor winners" />
            <SignalGroup signals={trends} title="Rising trends" />
          </>
        ) : (
          <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <RadarIcon className="size-6" strokeWidth={1.5} />
            </div>
            <p className="max-w-sm text-balance text-muted-foreground text-sm">
              {isLoading
                ? "Loading the radar…"
                : "No signals yet. Track a creator or topic, then refresh to surface their winners and rising formats."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
