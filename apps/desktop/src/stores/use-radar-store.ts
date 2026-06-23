/**
 * Store for the competitor/trend radar view (U28).
 *
 * Owns the tracked targets (creators + topics) and the cached findings the radar
 * surfaces:
 * - `addTarget` / `removeTarget` edit what the radar watches.
 * - `refresh` reloads targets + cached signals from the repo.
 * - `runRefresh` re-fetches every target (provider reads + ACP trends) and
 *   reloads the cache, then exposes the result count.
 *
 * Mirrors `use-autoresearch-store`: mutate via the repo + fetch wiring, then
 * reload from the repo so the view is always backed by persisted rows and
 * survives a restart. The pure ranking/formatting lives in `lib/radar/rank.ts`;
 * this store is the React-facing glue.
 */

import { create } from "zustand";
import { logger } from "@/lib/logger";
import { refreshRadar } from "@/lib/radar/fetch";
import {
  type AddRadarTargetInput,
  addRadarTarget,
  listRadarTargets,
  listTrendSignals,
  removeRadarTarget,
} from "@/lib/repos/radar";
import type { RadarTarget, TrendSignal } from "@/lib/social-schema";

interface RadarState {
  targets: RadarTarget[];
  signals: TrendSignal[];
  isLoading: boolean;
  /** True while a re-fetch of every target is in flight. */
  isRefreshing: boolean;
  /** Unix epoch millis of the most recent cached signal, for a staleness hint. */
  lastFetchedAt: number | null;
  error: string | null;

  refresh: () => Promise<void>;
  addTarget: (input: AddRadarTargetInput) => Promise<void>;
  removeTarget: (id: string) => Promise<void>;
  runRefresh: () => Promise<void>;
}

function newestFetch(signals: TrendSignal[]): number | null {
  let newest: number | null = null;
  for (const signal of signals) {
    if (newest === null || signal.fetchedAt > newest) {
      newest = signal.fetchedAt;
    }
  }
  return newest;
}

export const useRadarStore = create<RadarState>()((set, get) => ({
  targets: [],
  signals: [],
  isLoading: false,
  isRefreshing: false,
  lastFetchedAt: null,
  error: null,

  refresh: async () => {
    set({ isLoading: true });
    try {
      const [targets, signals] = await Promise.all([
        listRadarTargets(),
        listTrendSignals(),
      ]);
      set({
        targets,
        signals,
        lastFetchedAt: newestFetch(signals),
        isLoading: false,
      });
    } catch (error) {
      logger.error({ err: error }, "[Radar] Failed to refresh");
      set({ isLoading: false });
    }
  },

  addTarget: async (input) => {
    set({ error: null });
    try {
      await addRadarTarget(input);
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Radar] Failed to add target");
      set({
        error: error instanceof Error ? error.message : "Failed to add target",
      });
    }
  },

  removeTarget: async (id) => {
    set({ error: null });
    try {
      await removeRadarTarget(id);
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Radar] Failed to remove target");
      set({
        error:
          error instanceof Error ? error.message : "Failed to remove target",
      });
    }
  },

  runRefresh: async () => {
    set({ isRefreshing: true, error: null });
    try {
      const result = await refreshRadar();
      await get().refresh();
      if (result.signalsCached === 0 && get().targets.length > 0) {
        set({
          error:
            "No signals fetched. Connect an account for competitors, and configure a text-generation agent in Settings for topics.",
        });
      }
    } catch (error) {
      logger.error({ err: error }, "[Radar] Failed to run refresh");
      set({
        error:
          error instanceof Error ? error.message : "Failed to refresh radar",
      });
    } finally {
      set({ isRefreshing: false });
    }
  },
}));
