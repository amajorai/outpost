/**
 * Runnable integration check for the experiments engine (U25). No test runner is
 * configured in this app, so this is a plain script you can run with:
 *
 *   bun apps/desktop/src/lib/experiments/engine.check.ts
 *
 * It drives the FULL create -> publish(fake) -> record -> winner path against an
 * in-memory data layer and a real `FakePlatformProvider`, and asserts:
 *   - every variant publishes through the real `publishScheduledPost` pipeline
 *     (the fake records each published post)
 *   - each variant is linked to the scheduled post created for it (running state)
 *   - after the window, each variant's engagement is scored for the goal metric,
 *     a winner is computed + persisted, and the experiment goes `complete`
 *   - the engine's winner matches an INDEPENDENT argmax over the fake's
 *     deterministic engagement (so the assertion survives formula tweaks)
 *   - `engagement_rate` is divide-by-zero-safe and ties break deterministically
 *
 * Like `pipeline.check.ts`, it injects in-memory deps instead of the real
 * `@tauri-apps/plugin-sql` repos (plugin-sql can't load under plain bun). The
 * real SQL / snake_case mapping in `lib/repos/experiments.ts` mirrors the
 * established sibling-repo pattern and is covered by `tsc`.
 *
 * Imports only the engine core + the publish pipeline core + the fake provider,
 * none of which touch `@tauri-apps/*`, so it runs under plain bun.
 */

import { FakePlatformProvider } from "@/lib/providers/fake";
import type { Platform } from "@/lib/providers/types";
import {
  type PublishDeps,
  publishScheduledPost,
  type ResolvedTargetContent,
} from "@/lib/publish/pipeline";
import type {
  ExperimentGoalMetric,
  ExperimentStatus,
  ExperimentVariant,
  PostTarget,
  ScheduledPost,
} from "@/lib/social-schema";
import {
  computeWinner,
  type ExperimentDeps,
  evaluateExperiment,
  metricValue,
  type ScoredVariant,
  startExperiment,
  type VariantEngagement,
} from "./engine";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const FIXED_NOW = 1_700_000_000_000;

/**
 * In-memory mirror of the rows the engine touches, plus the fake provider that
 * actually "publishes" and reports deterministic engagement.
 */
interface Harness {
  provider: FakePlatformProvider;
  /** Variant id -> the scheduled post id the engine recorded. */
  scheduledByVariant: Map<string, string>;
  /** Scheduled post id -> the fake remote id of its published post. */
  remoteByScheduledPost: Map<string, string>;
  status: ExperimentStatus;
  results: {
    variantId: string;
    metricValue: number;
    isWinner: boolean;
  }[];
  measuredAt: number;
}

function makeHarness(): Harness {
  return {
    provider: new FakePlatformProvider({ now: () => FIXED_NOW }),
    scheduledByVariant: new Map(),
    remoteByScheduledPost: new Map(),
    status: "draft",
    results: [],
    measuredAt: 0,
  };
}

function makeVariants(): ExperimentVariant[] {
  return [
    {
      id: "variant-a",
      experimentId: "exp-1",
      label: "Variant A",
      draftBody: JSON.stringify({ text: "hello from A" }),
      scheduledPostId: null,
      targetPlatform: "x",
      scheduledFor: null,
    },
    {
      id: "variant-b",
      experimentId: "exp-1",
      label: "Variant B",
      draftBody: JSON.stringify({ text: "hello from B" }),
      scheduledPostId: null,
      targetPlatform: "x",
      scheduledFor: null,
    },
    {
      id: "variant-c",
      experimentId: "exp-1",
      label: "Variant C",
      draftBody: JSON.stringify({ text: "hello from C" }),
      scheduledPostId: null,
      targetPlatform: "x",
      scheduledFor: null,
    },
  ];
}

/**
 * Build in-memory {@link ExperimentDeps}. `publishVariant` runs the REAL
 * `publishScheduledPost` against the fake provider (so the publish path is
 * exercised, not stubbed), records the fake remote id, and returns a synthetic
 * scheduled post id. `readVariantEngagement` reads the fake's deterministic
 * counts for that remote id — the same source production uses.
 */
function makeDeps(harness: Harness): ExperimentDeps {
  const publishOne = async (variant: ExperimentVariant): Promise<string> => {
    const scheduledPostId = `sched-${variant.id}`;
    const post: ScheduledPost = {
      id: scheduledPostId,
      workspaceId: "default",
      draftId: `draft-${variant.id}`,
      scheduledFor: FIXED_NOW,
      status: "due",
      createdAt: FIXED_NOW,
    };
    const target: PostTarget = {
      id: `target-${variant.id}`,
      scheduledPostId,
      socialAccountId: `acct-${variant.id}`,
      platform: variant.targetPlatform,
      variantBody: null,
      status: "pending",
    };
    const body = JSON.parse(variant.draftBody) as { text: string };

    const publishDeps: PublishDeps = {
      listPostTargets: () => Promise.resolve([target]),
      resolveTargetContent: (): Promise<ResolvedTargetContent | null> =>
        Promise.resolve({
          text: body.text,
          media: [],
          account: {
            id: target.socialAccountId,
            platform: target.platform as Platform,
          },
        }),
      getProviderFor: () => Promise.resolve(harness.provider),
      recordPostHistory: () => Promise.resolve(undefined),
      updatePostTargetStatus: () => Promise.resolve(),
      updateScheduledPostStatus: () => Promise.resolve(),
      sleep: () => Promise.resolve(),
    };

    const outcome = await publishScheduledPost(post, publishDeps);
    const remoteId = outcome.targets[0]?.remoteId;
    if (!remoteId) {
      throw new Error("variant failed to publish in the check harness");
    }
    harness.remoteByScheduledPost.set(scheduledPostId, remoteId);
    return scheduledPostId;
  };

  return {
    now: () => FIXED_NOW,
    publishVariant: publishOne,
    setVariantScheduledPost: (variantId, scheduledPostId) => {
      harness.scheduledByVariant.set(variantId, scheduledPostId);
      return Promise.resolve();
    },
    setExperimentStatus: (_id, status) => {
      harness.status = status;
      return Promise.resolve();
    },
    readVariantEngagement: (variant): Promise<VariantEngagement | null> => {
      const scheduledPostId = harness.scheduledByVariant.get(variant.id);
      if (!scheduledPostId) {
        return Promise.resolve(null);
      }
      const remoteId = harness.remoteByScheduledPost.get(scheduledPostId);
      if (!remoteId) {
        return Promise.resolve(null);
      }
      return harness.provider
        .readEngagement({
          platform: variant.targetPlatform as Platform,
          remoteId,
        })
        .then((counts) => ({
          likes: counts.likes ?? 0,
          comments: counts.comments ?? 0,
          shares: counts.shares ?? 0,
          views: counts.views ?? 0,
        }));
    },
    recordResults: (input) => {
      harness.results = input.results;
      harness.measuredAt = input.measuredAt;
      return Promise.resolve();
    },
  };
}

/**
 * Independently compute the expected winner by reading the same fake counts the
 * engine will, so the assertion doesn't hardcode magic numbers and survives a
 * metric-formula tweak.
 */
async function expectedWinner(
  harness: Harness,
  variants: ExperimentVariant[],
  goalMetric: ExperimentGoalMetric
): Promise<string | null> {
  const scored: ScoredVariant[] = [];
  for (const variant of variants) {
    const scheduledPostId = harness.scheduledByVariant.get(variant.id);
    const remoteId = scheduledPostId
      ? harness.remoteByScheduledPost.get(scheduledPostId)
      : undefined;
    const value = remoteId
      ? metricValue(
          goalMetric,
          await (async () => {
            const counts = await harness.provider.readEngagement({
              platform: variant.targetPlatform as Platform,
              remoteId,
            });
            return {
              likes: counts.likes ?? 0,
              comments: counts.comments ?? 0,
              shares: counts.shares ?? 0,
              views: counts.views ?? 0,
            };
          })()
        )
      : 0;
    scored.push({ variantId: variant.id, metricValue: value });
  }
  return computeWinner(scored)?.variantId ?? null;
}

async function checkFullPath(goalMetric: ExperimentGoalMetric): Promise<void> {
  const harness = makeHarness();
  const deps = makeDeps(harness);
  const variants = makeVariants();

  // Create -> publish: start the experiment, publishing every variant.
  const published = await startExperiment("exp-1", variants, deps);

  assert(harness.status === "running", `${goalMetric}: experiment -> running`);
  assert(
    harness.provider.posts.size === variants.length,
    `${goalMetric}: fake recorded one published post per variant`
  );
  for (const variant of published) {
    assert(
      variant.scheduledPostId === `sched-${variant.id}`,
      `${goalMetric}: variant linked to its scheduled post`
    );
    assert(
      harness.scheduledByVariant.get(variant.id) === variant.scheduledPostId,
      `${goalMetric}: scheduled post id persisted on the variant`
    );
  }

  // Record -> winner: evaluate after the observation window.
  const expected = await expectedWinner(harness, published, goalMetric);
  const outcome = await evaluateExperiment(
    "exp-1",
    goalMetric,
    published,
    deps
  );

  assert(
    harness.status === "complete",
    `${goalMetric}: experiment -> complete`
  );
  assert(
    harness.results.length === variants.length,
    `${goalMetric}: one result row per variant`
  );
  assert(
    outcome.winnerVariantId === expected,
    `${goalMetric}: engine winner matches independent argmax (${outcome.winnerVariantId} vs ${expected})`
  );

  const winnerRows = harness.results.filter((row) => row.isWinner);
  assert(
    winnerRows.length === 1,
    `${goalMetric}: exactly one variant flagged winner`
  );
  assert(
    winnerRows[0].variantId === outcome.winnerVariantId,
    `${goalMetric}: persisted winner row matches the computed winner`
  );
  for (const scored of outcome.scored) {
    assert(
      Number.isFinite(scored.metricValue),
      `${goalMetric}: metric value is finite (no NaN from divide-by-zero)`
    );
  }
}

function checkComputeWinnerTiebreak(): void {
  // All-equal metrics (e.g. every engagement_rate is 0) must pick the first
  // variant deterministically.
  const winner = computeWinner([
    { variantId: "a", metricValue: 0 },
    { variantId: "b", metricValue: 0 },
    { variantId: "c", metricValue: 0 },
  ]);
  assert(winner?.variantId === "a", "tie breaks toward the first variant");

  assert(computeWinner([]) === null, "empty input -> no winner");

  const clear = computeWinner([
    { variantId: "a", metricValue: 1 },
    { variantId: "b", metricValue: 5 },
    { variantId: "c", metricValue: 3 },
  ]);
  assert(clear?.variantId === "b", "highest metric wins");
}

function checkEngagementRateGuard(): void {
  assert(
    metricValue("engagement_rate", {
      likes: 10,
      comments: 5,
      shares: 5,
      views: 0,
    }) === 0,
    "engagement_rate is 0 when views is 0 (no divide-by-zero)"
  );
  assert(
    metricValue("engagement_rate", {
      likes: 10,
      comments: 5,
      shares: 5,
      views: 100,
    }) === 0.2,
    "engagement_rate = (likes+comments+shares)/views"
  );
}

async function main(): Promise<void> {
  checkComputeWinnerTiebreak();
  checkEngagementRateGuard();
  await checkFullPath("likes");
  await checkFullPath("comments");
  await checkFullPath("views");
  await checkFullPath("engagement_rate");
  process.stdout.write("experiments engine check: OK\n");
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
