/**
 * Runnable integration check for the crew orchestrator / Autopilot core (U30).
 * No test runner is configured in this app, so this is a plain script you run:
 *
 *   bun apps/desktop/src/lib/autopilot/orchestrator.check.ts
 *
 * It drives the pure approval gate + plan orchestration against in-memory deps
 * (no `@tauri-apps/plugin-sql`, which can't load under plain bun) and asserts the
 * safety-critical properties the unit is graded on:
 *   - `suggest` never queues anything, at any action status.
 *   - `approve-each` (the DEFAULT) queues ONLY an explicitly-approved action; a
 *     freshly-proposed action is refused — the gate is not cosmetic.
 *   - `full-auto` queues a proposed action without an approval step, and `runPlan`
 *     auto-queues an entire plan under full-auto and ONLY under full-auto.
 *   - an unknown/garbage autonomy value coerces to the safe default behaviour
 *     (require explicit approval) — the absence path can never reach full-auto.
 *   - an empty plan yields a typed failure, not a throw.
 *
 * The real ACP strategist + DB + scheduler wiring in `deps.ts` mirrors the
 * established sibling patterns and is covered by `tsc`. This check exercises the
 * pure core in `orchestrator.ts`.
 */

import {
  type AutopilotDeps,
  canQueueAction,
  type PlannedPost,
  runPlan,
  shouldAutoQueuePlan,
} from "./orchestrator";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function checkGateMatrix(): void {
  // suggest: never queue, regardless of status.
  assert(
    !canQueueAction("suggest", "proposed"),
    "suggest never queues a proposed action"
  );
  assert(
    !canQueueAction("suggest", "approved"),
    "suggest never queues even an approved action"
  );

  // approve-each: ONLY an explicitly-approved action may queue.
  assert(
    !canQueueAction("approve-each", "proposed"),
    "approve-each refuses a still-proposed action (gate is not cosmetic)"
  );
  assert(
    canQueueAction("approve-each", "approved"),
    "approve-each queues an explicitly-approved action"
  );

  // full-auto: a proposed action may queue without an approval step.
  assert(
    canQueueAction("full-auto", "proposed"),
    "full-auto queues a proposed action"
  );

  // Terminal states never re-queue, at any level.
  for (const level of ["suggest", "approve-each", "full-auto"] as const) {
    assert(
      !canQueueAction(level, "queued"),
      `${level} never re-queues an already-queued action`
    );
    assert(
      !canQueueAction(level, "rejected"),
      `${level} never queues a rejected action`
    );
  }

  // Unknown/garbage value coerces to the SAFE default: require approval, never
  // auto-queue. This is the "absence can never reach full-auto" guarantee.
  const garbage = "totally-not-a-level" as unknown as Parameters<
    typeof canQueueAction
  >[0];
  assert(
    !canQueueAction(garbage, "proposed"),
    "unknown autonomy refuses a proposed action (safe default)"
  );
  assert(
    canQueueAction(garbage, "approved"),
    "unknown autonomy still honours an explicit approval"
  );
  assert(
    !shouldAutoQueuePlan(garbage),
    "unknown autonomy never auto-queues a plan"
  );
  assert(
    !shouldAutoQueuePlan("approve-each"),
    "approve-each never auto-queues a plan"
  );
  assert(shouldAutoQueuePlan("full-auto"), "only full-auto auto-queues a plan");
}

function makePlannedPost(hook: string): PlannedPost {
  return {
    hook,
    body: `${hook}\n\nbody`,
    targetPlatform: "x",
    rationale: "test",
    scheduledFor: Date.now(),
  };
}

/** In-memory deps recording what got recorded + queued. */
function makeDeps(plan: PlannedPost[]): {
  deps: AutopilotDeps;
  recorded: PlannedPost[];
  queued: string[];
} {
  const recorded: PlannedPost[] = [];
  const queued: string[] = [];
  const deps: AutopilotDeps = {
    buildPlan: () => Promise.resolve(plan),
    recordPlan: (posts) => {
      recorded.push(...posts);
      return Promise.resolve(posts.map((_, index) => `action-${index + 1}`));
    },
    queueAction: (actionId) => {
      queued.push(actionId);
      return Promise.resolve();
    },
  };
  return { deps, recorded, queued };
}

async function checkRunPlanSuggest(): Promise<void> {
  const { deps, recorded, queued } = makeDeps([makePlannedPost("a")]);
  const result = await runPlan("suggest", deps);
  assert(result.failure === null, "suggest plan built");
  assert(recorded.length === 1, "suggest records the plan");
  assert(queued.length === 0, "suggest queues NOTHING");
  assert(result.queuedIds.length === 0, "suggest reports no queued ids");
}

async function checkRunPlanApproveEach(): Promise<void> {
  const { deps, recorded, queued } = makeDeps([
    makePlannedPost("a"),
    makePlannedPost("b"),
  ]);
  const result = await runPlan("approve-each", deps);
  assert(result.failure === null, "approve-each plan built");
  assert(recorded.length === 2, "approve-each records the plan");
  assert(
    queued.length === 0,
    "approve-each queues NOTHING automatically (needs per-action approval)"
  );
}

async function checkRunPlanFullAuto(): Promise<void> {
  const { deps, recorded, queued } = makeDeps([
    makePlannedPost("a"),
    makePlannedPost("b"),
  ]);
  const result = await runPlan("full-auto", deps);
  assert(result.failure === null, "full-auto plan built");
  assert(recorded.length === 2, "full-auto records the plan");
  assert(queued.length === 2, "full-auto auto-queues every action");
  assert(result.queuedIds.length === 2, "full-auto reports queued ids");
}

async function checkRunPlanEmpty(): Promise<void> {
  const { deps, recorded, queued } = makeDeps([]);
  const result = await runPlan("full-auto", deps);
  assert(result.failure === "no-plan", "empty plan yields a typed failure");
  assert(recorded.length === 0, "nothing recorded for an empty plan");
  assert(queued.length === 0, "nothing queued for an empty plan");
}

async function main(): Promise<void> {
  checkGateMatrix();
  await checkRunPlanSuggest();
  await checkRunPlanApproveEach();
  await checkRunPlanFullAuto();
  await checkRunPlanEmpty();
  process.stdout.write("autopilot orchestrator.check: all assertions passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error}\n`);
  process.exit(1);
});
