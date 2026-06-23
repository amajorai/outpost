/**
 * Brand kit state + actions (U13).
 *
 * Holds the workspace's brand kit (logos, colors, fonts, watermark) and the
 * actions to load and save it. The settings editor mutates it; the composer
 * reads it (to overlay the watermark in the preview). One shared store keeps
 * both surfaces consistent without prop-drilling or re-fetching.
 */

import { create } from "zustand";
import { logger } from "@/lib/logger";
import {
  emptyBrandKit,
  getBrandKit,
  saveBrandKit,
} from "@/lib/repos/brand-kit";
import type {
  BrandColor,
  BrandFont,
  BrandKit,
  BrandLogo,
  BrandWatermark,
} from "@/lib/social-schema";

interface BrandKitState {
  kit: BrandKit;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  /** Load the workspace's brand kit. */
  load: () => Promise<void>;
  /** Persist the given editable fields and update local state. */
  save: (input: {
    logos: BrandLogo[];
    colors: BrandColor[];
    fonts: BrandFont[];
    watermark: BrandWatermark | null;
  }) => Promise<void>;
}

export const useBrandKitStore = create<BrandKitState>()((set) => ({
  kit: emptyBrandKit(),
  isLoading: false,
  isSaving: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const kit = await getBrandKit();
      set({ kit, isLoading: false });
    } catch (error) {
      logger.error({ err: error }, "[BrandKit] Failed to load");
      set({
        isLoading: false,
        error:
          error instanceof Error ? error.message : "Failed to load brand kit",
      });
    }
  },

  save: async (input) => {
    set({ isSaving: true, error: null });
    try {
      const kit = await saveBrandKit(input);
      set({ kit, isSaving: false });
    } catch (error) {
      logger.error({ err: error }, "[BrandKit] Failed to save");
      set({
        isSaving: false,
        error:
          error instanceof Error ? error.message : "Failed to save brand kit",
      });
      throw error;
    }
  },
}));
