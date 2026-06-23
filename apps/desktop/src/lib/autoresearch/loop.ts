/**
 * Autoresearch loop core (U27) — a Karpathy-autoresearch-style closed loop.
 *
 * Modeled on github.com/karpathy/autoresearch: the agent edits a strategy, runs
 * a fixed-budget experiment, scores ONE hard metric, keeps or discards the
 * change, and repeats. The strategy document is the `program.md` analog that
 * steers the loop; this file is the loop itself.
 *
 * One iteration = (a) propose a content change consistent with the strategy +
 * voice + past winners; (b) run an experiment via the U25 engine over a fixed
 * observation window; (c) score the goal metric; (d) keep or discard; (e) record
 * the iteration. The loop is split into two step-able halves so it never has to
 * wait real hours in a test: `runIteration` proposes + starts the experiment,
 * `scoreIteration` evaluates + decides + records.
 *
 * Design mirrors `lib/experiments/engine.ts` and `lib/publish/pipeline.ts`: the
 * orchestration is a pure function over an injectable `deps` bag, and the
 * keep/discard verdict is a pure function over two metrics. Production wiring
 * lives in `lib/autoresearch/deps.ts` (the only file that imports the DB repos,
 * the ACP propose step, and the experiments engine); the bun-runnable check
 * (`loop.check.ts`) injects in-memory deps. This file intentionally imports
 * nothing from `@tauri-apps/*`, no repos, and no ACP client, so it loads under
 * plain bun.
 */

import type { AutoresearchDecision } from "@/lib/social-schema";

/**
 * A content/strategy change the agent proposes for one iteration. The `hook` is
 * surfaced into the composer (an "Open in composer" action); `format` and
 * `timing` capture the other levers a proposal can pull. `rationale` ties the
 * proposal back to the strategy doc so the history is inspectable.
 */
export interface AutoresearchProposalData {
  /** The opening line / hook the proposal leads with — surfaced to the composer. */
  hook: string;
  /** The full candidate post body to run as the challenger. */
  body: string;
  /** The post format the proposal targets, e.g. "single", "thread". */
  format: string;
  /** A human-readable timing suggestion, e.g. "weekday mornings". */
  timing: string;
  /** Why this change should help, grounded in the strategy. */
  rationale: string;
  /** Platform key the challenger publishes to, e.g. "x". */
  targetPlatform: string;
}

/**
 * Decide whether a freshly-scored challenger should be kept. The first
 * iteration (no prior best) always keeps, establishing the baseline. Otherwise a
 * challenger is kept only if it strictly beats the current best metric — ties
 * discard, so a change has to actually move the needle to stick.
 */
export function decideKeep(
  challengerMetric: number,
  currentBest: number | null
): AutoresearchDecision {
  if (currentBest === null) {
    return "kept";
  }
  return challengerMetric > currentBest ? "kept" : "discarded";
}

/**
 * Everything the loop needs from the outside world, injectable so the check can
 * swap in-memory fakes for the real ACP + DB + experiments wiring. Production
 * callers use `defaultAutoresearchDeps()` from `deps.ts`.
 */
export interface AutoresearchLoopDeps {
  /**
   * Ask the agent to propose a content change consistent with the strategy doc,
   * the learned voice, and past winners. Returns null when no proposal could be
   * produced (e.g. no agent configured) so the loop reports it rather than
   * throwing.
   */
  propose: () => Promise<AutoresearchProposalData | null>;
  /**
   * Run the proposal as a U25 experiment over the observation window: create +
   * start it and return its id. The loop links this id onto the iteration.
   */
  startExperimentFor: (proposal: AutoresearchProposalData) => Promise<string>;
  /** Persist a started-but-unscored iteration; returns its id. */
  recordIterationStart: (input: {
    iterationNumber: number;
    proposal: AutoresearchProposalData;
    experimentId: string;
  }) => Promise<string>;
  /** The next iteration number (max recorded + 1; 1 for an empty loop). */
  nextIterationNumber: () => Promise<number>;
  /**
   * Score a started experiment: evaluate it and return the winning variant's
   * goal-metric value. The challenger is the experiment's single variant, so its
   * measured metric is what we compare against the running best.
   */
  scoreExperiment: (experimentId: string) => Promise<number>;
  /** The current best kept metric for the loop, or null when nothing kept yet. */
  bestKeptMetric: () => Promise<number | null>;
  /** Persist an iteration's scored metric + keep/discard verdict. */
  recordIterationScore: (input: {
    iterationId: string;
    metricValue: number;
    decision: AutoresearchDecision;
  }) => Promise<void>;
}

/** Why an iteration could not be started, for the caller to surface. */
export type RunIterationFailure = "no-proposal" | "no-experiment";

/** The outcome of starting an iteration. */
export interface RunIterationResult {
  /** Set when the iteration could not be started; the rest is then null. */
  failure: RunIterationFailure | null;
  /** The persisted iteration id, when started. */
  iterationId: string | null;
  /** The U25 experiment started to score the proposal, when started. */
  experimentId: string | null;
  /** The proposal the agent produced, when one was produced. */
  proposal: AutoresearchProposalData | null;
}

/**
 * Run one iteration's first half: propose a change and start the experiment that
 * will score it. Stops at the experiment boundary (the iteration is recorded
 * `pending`) so the loop is inspectable without waiting real hours — call
 * {@link scoreIteration} to evaluate it. Never throws on a missing proposal: it
 * returns a typed failure.
 */
export async function runIteration(
  deps: AutoresearchLoopDeps
): Promise<RunIterationResult> {
  const proposal = await deps.propose();
  if (!proposal) {
    return {
      failure: "no-proposal",
      iterationId: null,
      experimentId: null,
      proposal: null,
    };
  }

  let experimentId: string;
  try {
    experimentId = await deps.startExperimentFor(proposal);
  } catch {
    return {
      failure: "no-experiment",
      iterationId: null,
      experimentId: null,
      proposal,
    };
  }

  const iterationNumber = await deps.nextIterationNumber();
  const iterationId = await deps.recordIterationStart({
    iterationNumber,
    proposal,
    experimentId,
  });

  return { failure: null, iterationId, experimentId, proposal };
}

/** The outcome of scoring an iteration. */
export interface ScoreIterationResult {
  /** The challenger's measured goal-metric value. */
  metricValue: number;
  /** The running best at decision time (null on the first iteration). */
  previousBest: number | null;
  /** The keep/discard verdict. */
  decision: AutoresearchDecision;
}

/**
 * Run one iteration's second half: score the started experiment, compare against
 * the running best, decide keep/discard, and persist the verdict on the
 * iteration. This is the "advance/score" action that closes the loop.
 */
export async function scoreIteration(
  input: { iterationId: string; experimentId: string },
  deps: AutoresearchLoopDeps
): Promise<ScoreIterationResult> {
  const metricValue = await deps.scoreExperiment(input.experimentId);
  const previousBest = await deps.bestKeptMetric();
  const decision = decideKeep(metricValue, previousBest);

  await deps.recordIterationScore({
    iterationId: input.iterationId,
    metricValue,
    decision,
  });

  return { metricValue, previousBest, decision };
}
