/**
 * Store for the autoresearch view (U27).
 *
 * Owns the strategy document the loop runs against and the step-able loop
 * lifecycle the UI drives:
 * - `loadStrategy` / `saveStrategy` edit the `program.md` analog that steers the
 *   loop (goals, voice, niche, guardrails + the goal metric + observation window).
 * - `runIteration` proposes a change and starts the experiment that scores it,
 *   recording a `pending` iteration (the step boundary — no real-hour wait).
 * - `scoreIteration` evaluates that experiment, decides keep/discard, and records
 *   the verdict.
 *
 * Mirrors `use-experiments-store`: mutate via the loop core + production deps,
 * then reload from the repo so the view is always backed by persisted rows and
 * survives a restart. The pure orchestration lives in `lib/autoresearch/loop.ts`;
 * this store is the React-facing glue.
 */

import { create } from "zustand";
import { defaultAutoresearchDeps } from "@/lib/autoresearch/deps";
import {
  type AutoresearchProposalData,
  runIteration as runLoopIteration,
  scoreIteration as scoreLoopIteration,
} from "@/lib/autoresearch/loop";
import { proposeFailureMessage } from "@/lib/autoresearch/propose";
import { logger } from "@/lib/logger";
import {
  getStrategy,
  listIterations,
  saveStrategy as persistStrategy,
  type SaveStrategyInput,
} from "@/lib/repos/autoresearch";
import type {
  AutoresearchIteration,
  AutoresearchStrategy,
} from "@/lib/social-schema";

/** Decode an iteration's JSON proposal, tolerating a malformed blob. */
export function decodeProposal(
  iteration: AutoresearchIteration
): AutoresearchProposalData | null {
  try {
    const parsed = JSON.parse(iteration.proposal) as AutoresearchProposalData;
    return parsed;
  } catch {
    return null;
  }
}

interface AutoresearchState {
  strategy: AutoresearchStrategy | null;
  iterations: AutoresearchIteration[];
  isLoading: boolean;
  isSaving: boolean;
  /** True while an iteration is being proposed + started. */
  isRunning: boolean;
  /** Id of the iteration currently being scored, if any. */
  scoringId: string | null;
  /** Last loop error, surfaced to the user. */
  error: string | null;

  refresh: () => Promise<void>;
  saveStrategy: (input: SaveStrategyInput) => Promise<void>;
  runIteration: () => Promise<void>;
  scoreIteration: (iterationId: string, experimentId: string) => Promise<void>;
}

export const useAutoresearchStore = create<AutoresearchState>()((set, get) => ({
  strategy: null,
  iterations: [],
  isLoading: false,
  isSaving: false,
  isRunning: false,
  scoringId: null,
  error: null,

  refresh: async () => {
    set({ isLoading: true });
    try {
      const [strategy, iterations] = await Promise.all([
        getStrategy(),
        listIterations(),
      ]);
      set({ strategy, iterations, isLoading: false });
    } catch (error) {
      logger.error({ err: error }, "[Autoresearch] Failed to refresh");
      set({ isLoading: false });
    }
  },

  saveStrategy: async (input) => {
    set({ isSaving: true, error: null });
    try {
      const strategy = await persistStrategy(input);
      set({ strategy, isSaving: false });
    } catch (error) {
      logger.error({ err: error }, "[Autoresearch] Failed to save strategy");
      set({
        isSaving: false,
        error:
          error instanceof Error ? error.message : "Failed to save strategy",
      });
      throw error;
    }
  },

  runIteration: async () => {
    set({ isRunning: true, error: null });
    try {
      const result = await runLoopIteration(defaultAutoresearchDeps());
      if (result.failure === "no-proposal") {
        // The agent produced nothing; surface the configured-agent guidance.
        set({ error: proposeFailureMessage("no-agent") });
        return;
      }
      if (result.failure === "no-experiment") {
        set({
          error:
            "Could not start an experiment for the proposal. Connect an account on the target platform.",
        });
        return;
      }
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Autoresearch] Failed to run iteration");
      set({
        error:
          error instanceof Error ? error.message : "Failed to run iteration",
      });
    } finally {
      set({ isRunning: false });
    }
  },

  scoreIteration: async (iterationId, experimentId) => {
    set({ scoringId: iterationId, error: null });
    try {
      await scoreLoopIteration(
        { iterationId, experimentId },
        defaultAutoresearchDeps()
      );
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Autoresearch] Failed to score iteration");
      set({
        error:
          error instanceof Error ? error.message : "Failed to score iteration",
      });
    } finally {
      set({ scoringId: null });
    }
  },
}));
