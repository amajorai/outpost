/**
 * Store for the integration core's user-facing state.
 *
 * Holds only non-secret derived state (whether a Composio key is configured)
 * plus the active capability matrix. The API key itself lives exclusively in
 * encrypted secure storage and is never mirrored here or in `settings.json`.
 */

import { create } from "zustand";
import { logger } from "@/lib/logger";
import {
  type CapabilityMatrix,
  getActiveProvider,
  getCapabilityMatrix,
  hasComposioApiKey,
  removeComposioApiKey,
  resetActiveProvider,
  storeComposioApiKey,
} from "@/lib/providers";

interface IntegrationState {
  composioConfigured: boolean;
  /** The active provider's id ("composio" | "fake"), once resolved. */
  activeProviderId: string | null;
  capabilityMatrix: CapabilityMatrix | null;
  isLoading: boolean;

  /** Load configured-state, resolve the active provider, and warm the matrix. */
  refresh: () => Promise<void>;
  /** Save a new Composio API key, rebuild the provider, and refresh. */
  saveComposioApiKey: (key: string) => Promise<void>;
  /** Remove the Composio API key, fall back to the fake provider, and refresh. */
  clearComposioApiKey: () => Promise<void>;
}

async function resolveState(): Promise<{
  composioConfigured: boolean;
  activeProviderId: string;
  capabilityMatrix: CapabilityMatrix;
}> {
  const composioConfigured = await hasComposioApiKey();
  const provider = await getActiveProvider();
  const capabilityMatrix = await getCapabilityMatrix(provider);
  return {
    composioConfigured,
    activeProviderId: provider.id,
    capabilityMatrix,
  };
}

export const useIntegrationStore = create<IntegrationState>()((set) => ({
  composioConfigured: false,
  activeProviderId: null,
  capabilityMatrix: null,
  isLoading: false,

  refresh: async () => {
    set({ isLoading: true });
    try {
      set({ ...(await resolveState()), isLoading: false });
    } catch (error) {
      logger.error({ err: error }, "[Integration] Failed to refresh state");
      set({ isLoading: false });
    }
  },

  saveComposioApiKey: async (key: string) => {
    set({ isLoading: true });
    try {
      await storeComposioApiKey(key);
      resetActiveProvider();
      set({ ...(await resolveState()), isLoading: false });
    } catch (error) {
      logger.error({ err: error }, "[Integration] Failed to save Composio key");
      set({ isLoading: false });
      throw error;
    }
  },

  clearComposioApiKey: async () => {
    set({ isLoading: true });
    try {
      await removeComposioApiKey();
      resetActiveProvider();
      set({ ...(await resolveState()), isLoading: false });
    } catch (error) {
      logger.error(
        { err: error },
        "[Integration] Failed to remove Composio key"
      );
      set({ isLoading: false });
      throw error;
    }
  },
}));
