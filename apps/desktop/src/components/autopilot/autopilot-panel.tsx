/**
 * The Autopilot section's main panel (U30).
 *
 * The crew orchestrator's home: the Strategist coordinates the crew (Researcher
 * = radar, Copywriter = voice, Analyst = timing + experiments) into a weekly
 * content plan, and — at the user's autonomy level — the proposed posts are
 * queued.
 *
 * Surfaces:
 *  - the current autonomy level (read-only here; changed in Settings, where the
 *    full-auto opt-in confirmation lives) plus a "Plan my week" action.
 *  - the proposed plan + pending approvals: each action shows its post, target,
 *    assigned time, and rationale, with Approve / Reject in `suggest` /
 *    `approve-each`. `full-auto` actions arrive already `queued`.
 *  - the full action log (auditable): every action's status, newest first.
 *
 * Loading mirrors `AutoresearchPanel`: refresh on mount, render from the store.
 */

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  Loader2,
  Rocket,
  X,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { platformLabel } from "@/components/compose/platform-meta";
import { getSectionMeta } from "@/components/nav/sections";
import { decodeDraftBody } from "@/lib/repos/drafts";
import type {
  AutopilotAction,
  AutopilotActionStatus,
  AutopilotAutonomy,
} from "@/lib/social-schema";
import { useAppSettingsStore } from "@/stores/use-app-settings-store";
import { useAutopilotStore } from "@/stores/use-autopilot-store";
import { useComposerStore } from "@/stores/use-composer-store";
import { useNavigationStore } from "@/stores/use-navigation-store";

const AUTONOMY_LABEL: Record<AutopilotAutonomy, string> = {
  suggest: "Suggest only",
  "approve-each": "Approve each",
  "full-auto": "Full auto",
};

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatScheduledFor(scheduledFor: number | null): string {
  if (scheduledFor === null) {
    return "Unscheduled";
  }
  return DATE_FORMAT.format(new Date(scheduledFor));
}

/** One-line description of what the current autonomy level does. */
function autonomyHint(autonomy: AutopilotAutonomy): string {
  if (autonomy === "full-auto") {
    return "Proposed posts are queued and scheduled automatically.";
  }
  if (autonomy === "approve-each") {
    return "Each proposed post needs your approval before it is queued.";
  }
  return "Plans are shown only — nothing is queued.";
}

function StatusBadge({ status }: { status: AutopilotActionStatus }) {
  if (status === "queued") {
    return <Badge variant="default">Queued</Badge>;
  }
  if (status === "rejected") {
    return <Badge variant="outline">Rejected</Badge>;
  }
  if (status === "approved") {
    return <Badge variant="secondary">Approved</Badge>;
  }
  return <Badge variant="secondary">Proposed</Badge>;
}

function ActionCard({ action }: { action: AutopilotAction }) {
  const busyActionId = useAutopilotStore((s) => s.busyActionId);
  const approveAction = useAutopilotStore((s) => s.approveAction);
  const rejectAction = useAutopilotStore((s) => s.rejectAction);
  const autonomy = useAppSettingsStore((s) => s.autopilotAutonomy);
  const loadText = useComposerStore((s) => s.loadText);
  const setActiveSection = useNavigationStore((s) => s.setActiveSection);

  const body = useMemo(() => decodeDraftBody(action.body).text, [action.body]);
  const isBusy = busyActionId === action.id;
  // Only a still-proposed action can be acted on, and only when the level allows
  // a per-action decision (suggest shows the plan but offers nothing to queue).
  const canDecide = action.status === "proposed" && autonomy !== "suggest";

  const openInComposer = async () => {
    await loadText(body, action.targetPlatform);
    await setActiveSection("compose");
  };

  return (
    <li className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <CalendarClock className="size-4 text-muted-foreground" />
        <span className="text-muted-foreground text-xs">
          {formatScheduledFor(action.scheduledFor)}
        </span>
        <span className="ml-auto">
          <StatusBadge status={action.status} />
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="font-medium text-sm">{action.hook}</p>
        <p className="whitespace-pre-wrap text-muted-foreground text-sm">
          {body}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
          <Badge variant="outline">
            {platformLabel(action.targetPlatform)}
          </Badge>
        </div>
        {action.rationale ? (
          <p className="text-muted-foreground text-xs italic">
            {action.rationale}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {canDecide ? (
          <>
            <Button
              disabled={isBusy}
              onClick={() => approveAction(action.id)}
              size="sm"
              type="button"
            >
              {isBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Approve &amp; queue
            </Button>
            <Button
              disabled={isBusy}
              onClick={() => rejectAction(action.id)}
              size="sm"
              type="button"
              variant="outline"
            >
              <X className="size-4" />
              Reject
            </Button>
          </>
        ) : null}
        <Button
          onClick={openInComposer}
          size="sm"
          type="button"
          variant="outline"
        >
          <ArrowUpRight className="size-4" />
          Open in composer
        </Button>
      </div>
    </li>
  );
}

export function AutopilotPanel() {
  const { label, description } = getSectionMeta("autopilot");
  const actions = useAutopilotStore((s) => s.actions);
  const isLoading = useAutopilotStore((s) => s.isLoading);
  const isRunning = useAutopilotStore((s) => s.isRunning);
  const error = useAutopilotStore((s) => s.error);
  const refresh = useAutopilotStore((s) => s.refresh);
  const runPlan = useAutopilotStore((s) => s.runPlan);

  const autonomy = useAppSettingsStore((s) => s.autopilotAutonomy);
  const setActiveSection = useNavigationStore((s) => s.setActiveSection);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isEmpty = actions.length === 0;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6">
      <header className="flex items-start justify-between gap-4 pb-4">
        <div>
          <h1 className="font-semibold text-xl tracking-tight">{label}</h1>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        <Button disabled={isRunning} onClick={runPlan} size="sm">
          {isRunning ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Rocket className="size-4" />
          )}
          Plan my week
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm">
          <span className="text-muted-foreground">Autonomy</span>
          <Badge variant={autonomy === "full-auto" ? "default" : "secondary"}>
            {AUTONOMY_LABEL[autonomy]}
          </Badge>
          <span className="text-muted-foreground text-xs">
            {autonomyHint(autonomy)}
          </span>
          <Button
            className="ml-auto"
            onClick={() => setActiveSection("settings")}
            size="sm"
            type="button"
            variant="ghost"
          >
            Change in Settings
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="font-medium text-sm">Plan &amp; action log</h2>
          {isEmpty ? (
            <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Rocket className="size-6" strokeWidth={1.5} />
              </div>
              <p className="max-w-sm text-balance text-muted-foreground text-sm">
                {isLoading
                  ? "Loading autopilot…"
                  : "No plan yet. Hit “Plan my week” and the Strategist will coordinate the crew into a week of proposed posts."}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {actions.map((action) => (
                <ActionCard action={action} key={action.id} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
