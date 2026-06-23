/**
 * Production wiring for the autoresearch loop (U27).
 *
 * Builds an {@link AutoresearchLoopDeps} backed by the real ACP propose step,
 * the U25 experiments engine + repo, and the autoresearch repo. Kept separate
 * from `loop.ts` so the loop core stays free of `@tauri-apps/*` / ACP / repo
 * imports and the bun-runnable check can build its own in-memory deps.
 *
 * Running a proposal reuses the U25 engine verbatim: the proposal becomes a
 * single-variant experiment (the challenger) that publishes through the existing
 * scheduled_posts/post_targets pipeline. Scoring evaluates that experiment and
 * reads back the challenger's measured goal-metric value. The loop compares it
 * against the running best and keeps or discards.
 */

import type {
  AutoresearchLoopDeps,
  AutoresearchProposalData,
} from "@/lib/autoresearch/loop";
import { proposeChange } from "@/lib/autoresearch/propose";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { defaultExperimentDeps } from "@/lib/experiments/deps";
import { evaluateExperiment, startExperiment } from "@/lib/experiments/engine";
import {
  createIteration,
  getBestKeptMetric,
  getMaxIterationNumber,
  getStrategy,
  scoreIteration,
} from "@/lib/repos/autoresearch";
import { emptyDraftBody, encodeDraftBody } from "@/lib/repos/drafts";
import {
  createExperiment,
  getExperiment,
  listExperimentResults,
  listExperimentVariants,
} from "@/lib/repos/experiments";
import type { AutoresearchStrategy } from "@/lib/social-schema";

/**
 * Create + start the U25 experiment that scores a proposal. The proposal is the
 * single challenger variant: we encode its body as a draft body, create a
 * one-variant experiment for the strategy's goal metric + observation window,
 * and start it (publishes the variant via the existing pipeline). Returns the
 * experiment id so the loop can link it to the iteration and score it later.
 */
async function startExperimentFor(
  proposal: AutoresearchProposalData,
  strategy: AutoresearchStrategy
): Promise<string> {
  const body = encodeDraftBody({
    ...emptyDraftBody(),
    text: proposal.body,
    segments: [{ text: proposal.body, media: [] }],
  });
  const created = await createExperiment({
    name: `Autoresearch: ${proposal.hook}`.slice(0, 80),
    goalMetric: strategy.goalMetric,
    observationWindowHours: strategy.observationWindowHours,
    variants: [
      {
        label: "Challenger",
        draftBody: body,
        targetPlatform: proposal.targetPlatform,
      },
    ],
    workspaceId: strategy.workspaceId,
  });
  await startExperiment(
    created.experiment.id,
    created.variants,
    defaultExperimentDeps()
  );
  return created.experiment.id;
}

/**
 * Score a started experiment and return the challenger's goal-metric value.
 * Evaluates it (reads engagement, computes + persists the winner) then reads the
 * single variant's recorded result. Returns 0 when the experiment has no
 * measurable result, so a dead challenger scores lowest rather than aborting.
 */
async function scoreExperiment(experimentId: string): Promise<number> {
  const experiment = await getExperiment(experimentId);
  if (!experiment) {
    return 0;
  }
  const variants = await listExperimentVariants(experimentId);
  await evaluateExperiment(
    experimentId,
    experiment.goalMetric,
    variants,
    defaultExperimentDeps()
  );
  const results = await listExperimentResults(experimentId);
  // The challenger is the experiment's single variant; its result is the score.
  const winner = results.find((result) => result.isWinner === 1);
  return winner?.metricValue ?? results[0]?.metricValue ?? 0;
}

/**
 * Build the production {@link AutoresearchLoopDeps} for a workspace. Reads the
 * current strategy once so the proposal + experiment share the same goal metric
 * + window for this run.
 */
export function defaultAutoresearchDeps(
  workspaceId: string = getCurrentWorkspaceId()
): AutoresearchLoopDeps {
  return {
    propose: async () => {
      const strategy = await getStrategy(workspaceId);
      const { proposal } = await proposeChange(strategy, workspaceId);
      return proposal;
    },
    startExperimentFor: async (proposal) => {
      const strategy = await getStrategy(workspaceId);
      return startExperimentFor(proposal, strategy);
    },
    recordIterationStart: async (input) => {
      const iteration = await createIteration({
        iterationNumber: input.iterationNumber,
        proposal: JSON.stringify(input.proposal),
        experimentId: input.experimentId,
        workspaceId,
      });
      return iteration.id;
    },
    nextIterationNumber: async () =>
      (await getMaxIterationNumber(workspaceId)) + 1,
    scoreExperiment,
    bestKeptMetric: () => getBestKeptMetric(workspaceId),
    recordIterationScore: (input) => scoreIteration(input),
  };
}
