/**
 * Store for the production pipeline kanban (U33).
 *
 * Owns the content items shown on the board: create / edit / move stage /
 * reorder / delete. Mirrors `use-money-store`: mutate via the repo, then reload
 * from the repo so the view is always backed by persisted rows and survives a
 * restart. The promote-to-composer flow lives in the panel (it touches the
 * composer + navigation stores), keeping this store focused on the board's data.
 */

import { create } from "zustand";
import { logger } from "@/lib/logger";
import {
  type CreateContentItemInput,
  createContentItem,
  deleteContentItem,
  listContentItems,
  reorderContentItem,
  setContentItemStage,
  type UpdateContentItemInput,
  updateContentItem,
} from "@/lib/repos/content-items";
import type { ContentItem, ContentStage } from "@/lib/social-schema";

interface PipelineState {
  items: ContentItem[];
  isLoading: boolean;
  error: string | null;

  refresh: () => Promise<void>;
  addItem: (input: CreateContentItemInput) => Promise<void>;
  editItem: (id: string, patch: UpdateContentItemInput) => Promise<void>;
  moveItem: (id: string, stage: ContentStage) => Promise<void>;
  reorderItem: (id: string, sortOrder: number) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const usePipelineStore = create<PipelineState>()((set, get) => ({
  items: [],
  isLoading: false,
  error: null,

  refresh: async () => {
    set({ isLoading: true });
    try {
      const items = await listContentItems();
      set({ items, isLoading: false });
    } catch (error) {
      logger.error({ err: error }, "[Pipeline] Failed to refresh");
      set({ isLoading: false });
    }
  },

  addItem: async (input) => {
    set({ error: null });
    try {
      await createContentItem(input);
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Pipeline] Failed to add item");
      set({ error: describeError(error, "Failed to add item") });
    }
  },

  editItem: async (id, patch) => {
    set({ error: null });
    try {
      await updateContentItem(id, patch);
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Pipeline] Failed to update item");
      set({ error: describeError(error, "Failed to update item") });
    }
  },

  moveItem: async (id, stage) => {
    set({ error: null });
    try {
      await setContentItemStage(id, stage);
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Pipeline] Failed to move item");
      set({ error: describeError(error, "Failed to move item") });
    }
  },

  reorderItem: async (id, sortOrder) => {
    set({ error: null });
    try {
      await reorderContentItem(id, sortOrder);
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Pipeline] Failed to reorder item");
      set({ error: describeError(error, "Failed to reorder item") });
    }
  },

  removeItem: async (id) => {
    set({ error: null });
    try {
      await deleteContentItem(id);
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Pipeline] Failed to remove item");
      set({ error: describeError(error, "Failed to remove item") });
    }
  },
}));
