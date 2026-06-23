/**
 * Crew orchestrator / Autopilot core (U30).
 *
 * The Strategist coordinates the crew (Researcher = radar, Copywriter = voice,
 * Analyst = timing + experiments) into a weekly content plan, then — at the
 * user's autonomy level — queues the proposed posts. This file is the pure core:
 * the approval-gate decision and the plan-building orchestration over an
 * injectable `deps` bag, with NO imports from `@tauri-apps/*`, no repos, and no
 * ACP client, so it loads under plain bun and the check can drive it with
 * in-memory fakes (mirroring `lib/autoresearch/loop.ts` and
 * `lib/experiments/engine.ts`).
 *
 * SAFETY: the "may this action queue now?" decision lives HERE, keyed on the
 * autonomy level + the action's status, so the gate is enforced at the point of
 * action rather than hidden behind a UI button. `suggest` never queues;
 * `approve-each` queues only an explicitly-approved action; `full-auto` queues a
 * freshly-proposed action without an approval step.
 */

import type {
  AutopilotActionStatus,
  AutopilotAutonomy,
} from "@/lib/social-schema";

/**
 * A single proposed post the strategist produced, before it is persisted. The
 * agent supplies the body + hook + rationale + a timing *hint*; the orchestrator
 * assigns the concrete `scheduledFor` from the timing recommender (the Analyst),
 * so time placement is deterministic and testable rather than left to the LLM.
 */
export interface PlannedPost {
  /** The opening line/hook the post leads with. */
  hook: string;
  /** The full candidate post body, ready to publish as-is. */
  body: string;
  /** Platform key the post targets, e.g. "x". */
  targetPlatform: string;
  /** Why the strategist proposed this, grounded in the crew's signals. */
  rationale: string;
  /** Concrete time the Analyst assigned, or null when no slot could be derived. */
  scheduledFor: number | null;
}

/**
 * Decide whether an action may be queued right now, given the workspace's
 * autonomy level and the action's current status. The single source of truth for
 * the approval gate — every queue path (store and deps) must consult this rather
 * than deciding for itself, so the gate can never be bypassed by the UI.
 *
 * - `suggest`: never queue. The plan is shown, nothing is acted on.
 * - `approve-each`: queue ONLY an action the user explicitly approved
 *   (`status === "approved"`). A still-`proposed` action is refused.
 * - `full-auto`: queue a freshly-`proposed` action without an approval step.
 *
 * An already-`queued` or `rejected` action is never re-queued, regardless of
 * level.
 */
export function canQueueAction(
  autonomy: AutopilotAutonomy,
  status: AutopilotActionStatus
): boolean {
  if (status === "queued" || status === "rejected") {
    return false;
  }
  switch (autonomy) {
    case "suggest":
      return false;
    case "approve-each":
      return status === "approved";
    case "full-auto":
      return status === "proposed" || status === "approved";
    default:
      // Unknown level coerces to the safe default: require explicit approval.
      return status === "approved";
  }
}

/**
 * Whether the orchestrator should auto-queue every action of a freshly-built
 * plan without prompting. Only `full-auto` does. Keeps the "run the plan"
 * branch obvious and the safety property easy to assert.
 */
export function shouldAutoQueuePlan(autonomy: AutopilotAutonomy): boolean {
  return autonomy === "full-auto";
}

/**
 * Everything the orchestrator needs from the outside world, injectable so the
 * check can swap in-memory fakes for the real ACP + DB + scheduler wiring.
 * Production callers use `defaultAutopilotDeps()` from `deps.ts`.
 */
export interface AutopilotDeps {
  /**
   * Ask the Strategist agent to coordinate the crew's signals into a weekly
   * plan of proposed posts, each already assigned a concrete `scheduledFor` by
   * the Analyst's timing recommender. Returns [] when no plan could be produced
   * (e.g. no agent configured), so the orchestrator reports it rather than
   * throwing.
   */
  buildPlan: () => Promise<PlannedPost[]>;
  /** Persist a built plan as `proposed` actions; returns their ids. */
  recordPlan: (posts: PlannedPost[]) => Promise<string[]>;
  /**
   * Queue one action: turn it into a real `scheduled_posts` row and mark the
   * action `queued` with the scheduled-post id linked. The caller guarantees the
   * gate already permitted this (via {@link canQueueAction}); the deps still
   * re-check as defense in depth.
   */
  queueAction: (actionId: string) => Promise<void>;
}

/** Why a plan run produced nothing, for the caller to surface. */
export type BuildPlanFailure = "no-plan";

/** The outcome of building (and possibly auto-queuing) a plan. */
export interface RunPlanResult {
  /** Set when no plan could be built; the rest is then empty. */
  failure: BuildPlanFailure | null;
  /** The persisted action ids of the plan, when one was built. */
  actionIds: string[];
  /** Action ids that were auto-queued (`full-auto` only); empty otherwise. */
  queuedIds: string[];
}

/**
 * Build a weekly plan and persist it as `proposed` actions. In `full-auto` —
 * and ONLY in `full-auto` — every action is then queued without prompting; in
 * `suggest`/`approve-each` the plan is recorded and the caller drives queuing
 * through the per-action gate. Never throws on an empty plan: it returns a typed
 * failure.
 */
export async function runPlan(
  autonomy: AutopilotAutonomy,
  deps: AutopilotDeps
): Promise<RunPlanResult> {
  const posts = await deps.buildPlan();
  if (posts.length === 0) {
    return { failure: "no-plan", actionIds: [], queuedIds: [] };
  }

  const actionIds = await deps.recordPlan(posts);

  if (!shouldAutoQueuePlan(autonomy)) {
    return { failure: null, actionIds, queuedIds: [] };
  }

  // full-auto: queue every freshly-proposed action. The gate is re-checked per
  // action inside `queueAction`'s deps as defense in depth.
  const queuedIds: string[] = [];
  for (const actionId of actionIds) {
    await deps.queueAction(actionId);
    queuedIds.push(actionId);
  }
  return { failure: null, actionIds, queuedIds };
}
