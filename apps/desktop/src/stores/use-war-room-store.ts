/**
 * War Room data store (U29).
 *
 * The home dashboard's single data load. Mirrors `useActivityStore` /
 * `useExperimentsStore`: refresh on mount, render from the store. One `refresh()`
 * reads every persisted source the command center surfaces (the activity feed,
 * experiments, radar signals, past experiment winners, and per-platform timing)
 * so the panel stays presentational and the four role cards derive their
 * recommendations from already-persisted data.
 *
 * Deliberately read-only and ACP-free at load: the expensive generation (a
 * reformat/voice draft) happens in a "ship it" click handler, never here, so the
 * dashboard mounts instantly and can't fail on an agent error.
 */

import { create } from "zustand";
import { logger } from "@/lib/logger";
import { listActivityItems } from "@/lib/repos/activity-items";
import {
  type ExperimentWinner,
  listExperiments,
  listExperimentWinners,
} from "@/lib/repos/experiments";
import { listTrendSignals } from "@/lib/repos/radar";
import type {
  ActivityItem,
  Experiment,
  TrendSignal,
} from "@/lib/social-schema";
import type { TimingRecommendation } from "@/lib/timing/recommender";
import { loadPlatformTiming } from "@/lib/timing/service";

interface WarRoomState {
  /** Latest-snapshot activity feed rows (the analytics + score input). */
  activityItems: ActivityItem[];
  /** Every experiment, newest first, for the active-experiment status. */
  experiments: Experiment[];
  /** Past experiment winners, highest metric first (Copywriter input). */
  winners: ExperimentWinner[];
  /** Cached radar findings, highest score first (Researcher input). */
  signals: TrendSignal[];
  /** Per-platform timing recommendations, keyed by platform (Analyst input). */
  timing: Map<string, TimingRecommendation>;
  isLoading: boolean;
  /** True once the first refresh has settled, so the panel can tell empty from loading. */
  hasLoaded: boolean;
  refresh: () => Promise<void>;
}

export const useWarRoomStore = create<WarRoomState>()((set) => ({
  activityItems: [],
  experiments: [],
  winners: [],
  signals: [],
  timing: new Map(),
  isLoading: false,
  hasLoaded: false,

  refresh: async () => {
    set({ isLoading: true });
    try {
      const [activityItems, experiments, winners, signals, timing] =
        await Promise.all([
          listActivityItems(),
          listExperiments(),
          listExperimentWinners(),
          listTrendSignals(),
          loadPlatformTiming(),
        ]);
      set({
        activityItems,
        experiments,
        winners,
        signals,
        timing,
        isLoading: false,
        hasLoaded: true,
      });
    } catch (error) {
      logger.error({ err: error }, "[WarRoom] Failed to refresh dashboard");
      set({ isLoading: false, hasLoaded: true });
    }
  },
}));
