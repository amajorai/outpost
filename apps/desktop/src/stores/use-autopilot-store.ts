/**
 * Store for the Autopilot view (U30).
 *
 * Owns the crew orchestrator's lifecycle the UI drives:
 * - `runPlan` asks the Strategist to coordinate the crew into a weekly plan and
 *   persists it as `proposed` actions. In `full-auto` — and only there — the
 *   orchestrator core auto-queues every action; otherwise the plan is shown for
 *   approval.
 * - `approveAction` advances an action to `approved` then queues it through the
 *   gate (the `approve-each` path: explicit per-action approval before anything
 *   touches a real account).
 * - `rejectAction` declines an action; it stays logged for auditability.
 *
 * Mirrors `use-autoresearch-store`: mutate via the orchestrator core + production
 * deps, then reload from the repo so the view is always backed by persisted rows
 * and survives a restart. The pure orchestration + approval gate live in
 * `lib/autopilot/orchestrator.ts`; this store is the React-facing glue. The
 * autonomy level is read from the app settings store at action time, so the gate
 * always reflects the user's current setting.
 */

import { create } from "zustand";
import { defaultAutopilotDeps } from "@/lib/autopilot/deps";
import {
  canQueueAction,
  runPlan as runOrchestratorPlan,
} from "@/lib/autopilot/orchestrator";
import { strategistFailureMessage } from "@/lib/autopilot/strategist";
import { logger } from "@/lib/logger";
import {
  getAction,
  listActions,
  markActionApproved,
  markActionRejected,
} from "@/lib/repos/autopilot";
import type { AutopilotAction } from "@/lib/social-schema";
import { useAppSettingsStore } from "@/stores/use-app-settings-store";

interface AutopilotState {
  actions: AutopilotAction[];
  isLoading: boolean;
  /** True while a plan is being built + recorded. */
  isRunning: boolean;
  /** Id of the action currently being queued/rejected, if any. */
  busyActionId: string | null;
  /** Last orchestrator error, surfaced to the user. */
  error: string | null;

  refresh: () => Promise<void>;
  runPlan: () => Promise<void>;
  approveAction: (actionId: string) => Promise<void>;
  rejectAction: (actionId: string) => Promise<void>;
}

export const useAutopilotStore = create<AutopilotState>()((set, get) => ({
  actions: [],
  isLoading: false,
  isRunning: false,
  busyActionId: null,
  error: null,

  refresh: async () => {
    set({ isLoading: true });
    try {
      const actions = await listActions();
      set({ actions, isLoading: false });
    } catch (error) {
      logger.error({ err: error }, "[Autopilot] Failed to refresh");
      set({ isLoading: false });
    }
  },

  runPlan: async () => {
    set({ isRunning: true, error: null });
    try {
      const autonomy = useAppSettingsStore.getState().autopilotAutonomy;
      const result = await runOrchestratorPlan(
        autonomy,
        defaultAutopilotDeps(autonomy)
      );
      if (result.failure === "no-plan") {
        set({ error: strategistFailureMessage("no-agent") });
        return;
      }
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Autopilot] Failed to run plan");
      set({
        error: error instanceof Error ? error.message : "Failed to run plan",
      });
    } finally {
      set({ isRunning: false });
    }
  },

  approveAction: async (actionId) => {
    set({ busyActionId: actionId, error: null });
    try {
      const autonomy = useAppSettingsStore.getState().autopilotAutonomy;
      // Approving means: advance to `approved`, then queue through the gate. We
      // build deps for the current level so the gate inside `queueAction`
      // permits an explicitly-approved action under `approve-each`.
      const action = await getAction(actionId);
      if (!action) {
        throw new Error("Action not found");
      }
      // The gate check is on the post-approval status, so verify the level
      // permits queuing an approved action before we touch a real account.
      if (!canQueueAction(autonomy, "approved")) {
        set({
          error: 'Set autonomy to "Approve each" or higher to queue this post.',
        });
        return;
      }
      // Advance to `approved` in the DB so the deps' gate check passes against
      // the persisted row, then queue it: `queueAction` turns the approved
      // action into a real scheduled post and marks it `queued`.
      await markActionApproved(actionId);
      await defaultAutopilotDeps(autonomy).queueAction(actionId);
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Autopilot] Failed to approve action");
      set({
        error:
          error instanceof Error ? error.message : "Failed to queue this post",
      });
    } finally {
      set({ busyActionId: null });
    }
  },

  rejectAction: async (actionId) => {
    set({ busyActionId: actionId, error: null });
    try {
      await markActionRejected(actionId);
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Autopilot] Failed to reject action");
      set({
        error:
          error instanceof Error ? error.message : "Failed to reject this post",
      });
    } finally {
      set({ busyActionId: null });
    }
  },
}));
