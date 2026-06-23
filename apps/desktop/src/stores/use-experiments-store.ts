/**
 * Store for the experiments view (U25).
 *
 * Loads the workspace's experiments with their variants and (once evaluated)
 * results, and exposes the create -> start -> evaluate lifecycle the UI drives.
 *
 * Lifecycle:
 * - `create` persists a `draft` experiment + its variants.
 * - `start` publishes every variant via the publish pipeline and flips the
 *   experiment to `running` (engine + production deps).
 * - `evaluate` reads each variant's engagement, computes + persists the winner,
 *   and flips the experiment to `complete`.
 *
 * Mirrors `use-activity-store`: mutate, then reload from the repos so the view
 * is always backed by persisted rows and survives a restart.
 */

import { create } from "zustand";
import { defaultExperimentDeps } from "@/lib/experiments/deps";
import { evaluateExperiment, startExperiment } from "@/lib/experiments/engine";
import { logger } from "@/lib/logger";
import {
  type CreateExperimentInput,
  createExperiment,
  getExperiment,
  listExperimentResults,
  listExperiments,
  listExperimentVariants,
} from "@/lib/repos/experiments";
import type {
  Experiment,
  ExperimentResult,
  ExperimentVariant,
} from "@/lib/social-schema";

/** An experiment plus its variants and results, as the view renders it. */
export interface ExperimentWithDetail {
  experiment: Experiment;
  variants: ExperimentVariant[];
  results: ExperimentResult[];
}

async function loadDetail(
  experiment: Experiment
): Promise<ExperimentWithDetail> {
  const [variants, results] = await Promise.all([
    listExperimentVariants(experiment.id),
    listExperimentResults(experiment.id),
  ]);
  return { experiment, variants, results };
}

interface ExperimentsState {
  items: ExperimentWithDetail[];
  isLoading: boolean;
  /** Id of the experiment currently publishing/evaluating, if any. */
  busyId: string | null;

  refresh: () => Promise<void>;
  create: (input: CreateExperimentInput) => Promise<void>;
  start: (experimentId: string) => Promise<void>;
  evaluate: (experimentId: string) => Promise<void>;
}

export const useExperimentsStore = create<ExperimentsState>()((set, get) => ({
  items: [],
  isLoading: false,
  busyId: null,

  refresh: async () => {
    set({ isLoading: true });
    try {
      const experiments = await listExperiments();
      const items = await Promise.all(experiments.map(loadDetail));
      set({ items, isLoading: false });
    } catch (error) {
      logger.error({ err: error }, "[Experiments] Failed to refresh");
      set({ isLoading: false });
    }
  },

  create: async (input) => {
    try {
      await createExperiment(input);
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Experiments] Failed to create experiment");
      throw error;
    }
  },

  start: async (experimentId) => {
    set({ busyId: experimentId });
    try {
      const variants = await listExperimentVariants(experimentId);
      await startExperiment(experimentId, variants, defaultExperimentDeps());
      await get().refresh();
    } catch (error) {
      logger.error(
        { err: error, experimentId },
        "[Experiments] Failed to start experiment"
      );
      throw error;
    } finally {
      set({ busyId: null });
    }
  },

  evaluate: async (experimentId) => {
    set({ busyId: experimentId });
    try {
      const experiment = await getExperiment(experimentId);
      if (!experiment) {
        throw new Error(`Experiment ${experimentId} not found`);
      }
      const variants = await listExperimentVariants(experimentId);
      await evaluateExperiment(
        experimentId,
        experiment.goalMetric,
        variants,
        defaultExperimentDeps()
      );
      await get().refresh();
    } catch (error) {
      logger.error(
        { err: error, experimentId },
        "[Experiments] Failed to evaluate experiment"
      );
      throw error;
    } finally {
      set({ busyId: null });
    }
  },
}));
