/**
 * Runnable integration check for the autoresearch loop (U27). No test runner is
 * configured in this app, so this is a plain script you run with:
 *
 *   bun apps/desktop/src/lib/autoresearch/loop.check.ts
 *
 * It drives the FULL propose -> run experiment -> score -> keep/discard path
 * against in-memory deps (no `@tauri-apps/plugin-sql`, which can't load under
 * plain bun) and asserts:
 *   - the loop is step-able: `runIteration` proposes + starts an experiment and
 *     records a `pending` iteration; `scoreIteration` evaluates + decides + records
 *   - the FIRST iteration always keeps (establishes the baseline)
 *   - a challenger that beats the running best is kept; one that ties or loses is
 *     discarded — the keep/discard verdict matches an INDEPENDENT comparison
 *   - every iteration is recorded whether kept or discarded (full history)
 *   - a missing proposal (no agent) yields a typed failure, not a throw
 *
 * The real ACP propose + DB + experiments wiring in `deps.ts` mirrors the
 * established sibling patterns (reformat.ts / experiments deps) and is covered by
 * `tsc`. This check exercises the pure loop core in `loop.ts`.
 */

import {
  type AutoresearchLoopDeps,
  type AutoresearchProposalData,
  decideKeep,
  runIteration,
  scoreIteration,
} from "./loop";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

/** A recorded iteration in the in-memory store. */
interface FakeIteration {
  id: string;
  iterationNumber: number;
  proposal: AutoresearchProposalData;
  experimentId: string;
  metricValue: number | null;
  decision: "pending" | "kept" | "discarded";
}

function makeProposal(hook: string): AutoresearchProposalData {
  return {
    hook,
    body: `${hook}\n\nbody`,
    format: "single",
    timing: "anytime",
    rationale: "test",
    targetPlatform: "x",
  };
}

/**
 * Build in-memory deps. `proposalQueue` is consumed one per `runIteration`;
 * `experimentScores` maps experiment id -> the metric `scoreExperiment` returns.
 * The store mirrors the rows the real repo would write so the check can assert
 * on them.
 */
function makeDeps(options: {
  proposalQueue: (AutoresearchProposalData | null)[];
  scoreOf: (experimentId: string) => number;
}): {
  deps: AutoresearchLoopDeps;
  iterations: FakeIteration[];
} {
  const iterations: FakeIteration[] = [];
  let proposalIndex = 0;
  let experimentSeq = 0;

  const deps: AutoresearchLoopDeps = {
    propose: () => {
      const next = options.proposalQueue[proposalIndex] ?? null;
      proposalIndex += 1;
      return Promise.resolve(next);
    },
    startExperimentFor: () => {
      experimentSeq += 1;
      return Promise.resolve(`exp-${experimentSeq}`);
    },
    recordIterationStart: (input) => {
      const id = `iter-${iterations.length + 1}`;
      iterations.push({
        id,
        iterationNumber: input.iterationNumber,
        proposal: input.proposal,
        experimentId: input.experimentId,
        metricValue: null,
        decision: "pending",
      });
      return Promise.resolve(id);
    },
    nextIterationNumber: () => Promise.resolve(iterations.length + 1),
    scoreExperiment: (experimentId) =>
      Promise.resolve(options.scoreOf(experimentId)),
    bestKeptMetric: () => {
      let best: number | null = null;
      for (const iteration of iterations) {
        if (iteration.decision === "kept" && iteration.metricValue !== null) {
          best =
            best === null
              ? iteration.metricValue
              : Math.max(best, iteration.metricValue);
        }
      }
      return Promise.resolve(best);
    },
    recordIterationScore: (input) => {
      const row = iterations.find(
        (iteration) => iteration.id === input.iterationId
      );
      if (row) {
        row.metricValue = input.metricValue;
        row.decision = input.decision;
      }
      return Promise.resolve();
    },
  };

  return { deps, iterations };
}

function checkPureDecision(): void {
  assert(decideKeep(5, null) === "kept", "first iteration (no best) keeps");
  assert(decideKeep(10, 5) === "kept", "beating the best keeps");
  assert(decideKeep(5, 5) === "discarded", "a tie discards");
  assert(decideKeep(3, 5) === "discarded", "losing discards");
}

async function checkFullLoop(): Promise<void> {
  // Three iterations with scores 4 (baseline kept), 9 (beats 4 -> kept), 6
  // (loses to running best 9 -> discarded).
  const scores: Record<string, number> = {
    "exp-1": 4,
    "exp-2": 9,
    "exp-3": 6,
  };
  const { deps, iterations } = makeDeps({
    proposalQueue: [makeProposal("a"), makeProposal("b"), makeProposal("c")],
    scoreOf: (id) => scores[id] ?? 0,
  });

  const expected: ("kept" | "discarded")[] = [];
  let runningBest: number | null = null;
  for (let i = 0; i < 3; i++) {
    const run = await runIteration(deps);
    assert(run.failure === null, `iteration ${i + 1} started`);
    assert(run.iterationId !== null, `iteration ${i + 1} recorded an id`);
    assert(run.experimentId !== null, `iteration ${i + 1} has an experiment`);

    // After runIteration the iteration must be recorded `pending` (step boundary).
    const pendingRow = iterations.find((row) => row.id === run.iterationId);
    assert(
      pendingRow?.decision === "pending",
      `iteration ${i + 1} is pending before scoring`
    );

    const expScore = scores[run.experimentId as string] ?? 0;
    const independent =
      runningBest === null || expScore > runningBest ? "kept" : "discarded";
    if (independent === "kept") {
      runningBest =
        runningBest === null ? expScore : Math.max(runningBest, expScore);
    }
    expected.push(independent);

    const scored = await scoreIteration(
      {
        iterationId: run.iterationId as string,
        experimentId: run.experimentId as string,
      },
      deps
    );
    assert(
      scored.decision === independent,
      `iteration ${i + 1} verdict matches independent comparison (${scored.decision} vs ${independent})`
    );
  }

  // Every iteration is recorded (kept AND discarded) — full inspectable history.
  assert(iterations.length === 3, "all three iterations recorded");
  assert(
    iterations.map((row) => row.decision).join(",") === expected.join(","),
    `recorded decisions match: ${iterations.map((r) => r.decision).join(",")}`
  );
  assert(iterations[0].decision === "kept", "first iteration kept (baseline)");
  assert(iterations[1].decision === "kept", "second iteration (9>4) kept");
  assert(
    iterations[2].decision === "discarded",
    "third iteration (6<9) discarded"
  );
}

async function checkNoProposal(): Promise<void> {
  const { deps, iterations } = makeDeps({
    proposalQueue: [null],
    scoreOf: () => 0,
  });
  const run = await runIteration(deps);
  assert(
    run.failure === "no-proposal",
    "missing proposal yields a typed failure"
  );
  assert(run.iterationId === null, "no iteration recorded without a proposal");
  assert(iterations.length === 0, "store untouched without a proposal");
}

async function main(): Promise<void> {
  checkPureDecision();
  await checkFullLoop();
  await checkNoProposal();
  process.stdout.write("autoresearch loop.check: all assertions passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error}\n`);
  process.exit(1);
});
