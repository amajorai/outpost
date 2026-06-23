/**
 * Voice profile state + actions (U16).
 *
 * Holds the workspace's learned writing-voice profile and the actions to load
 * it, re-derive it from past posts, and clear it. The Templates panel surfaces
 * the profile and triggers derivation; the reformat flow reads the persisted
 * profile directly (it's a `lib/` service), so this store is the UI's view.
 */

import { create } from "zustand";
import { logger } from "@/lib/logger";
import {
  deleteVoiceProfile,
  getVoiceProfile,
  type VoiceProfileData,
} from "@/lib/repos/voice-profile";
import { deriveVoiceProfile, type VoiceDeriveResult } from "@/lib/voice/derive";

interface VoiceProfileState {
  /** The current profile, or null when none has been derived. */
  profile: VoiceProfileData | null;
  isLoading: boolean;
  /** True while a derivation run is in flight. */
  isDeriving: boolean;
  error: string | null;

  /** Load the workspace's persisted voice profile. */
  load: () => Promise<void>;
  /**
   * Re-derive the profile from past posts via the ACP agent and persist it.
   * Returns the run result so the caller can surface a toast; never throws.
   */
  derive: () => Promise<VoiceDeriveResult>;
  /** Delete the workspace's voice profile. */
  clear: () => Promise<void>;
}

export const useVoiceProfileStore = create<VoiceProfileState>()((set) => ({
  profile: null,
  isLoading: false,
  isDeriving: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const profile = await getVoiceProfile();
      set({ profile, isLoading: false });
    } catch (error) {
      logger.error({ err: error }, "[Voice] Failed to load profile");
      set({
        isLoading: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load voice profile",
      });
    }
  },

  derive: async () => {
    set({ isDeriving: true, error: null });
    try {
      const result = await deriveVoiceProfile();
      if (result.profile) {
        set({ profile: result.profile });
      }
      return result;
    } finally {
      set({ isDeriving: false });
    }
  },

  clear: async () => {
    try {
      await deleteVoiceProfile();
      set({ profile: null });
    } catch (error) {
      logger.error({ err: error }, "[Voice] Failed to clear profile");
      set({
        error:
          error instanceof Error
            ? error.message
            : "Failed to clear voice profile",
      });
    }
  },
}));
