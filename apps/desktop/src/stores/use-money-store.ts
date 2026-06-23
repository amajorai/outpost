/**
 * Store for the Sponsorship & money hub (U31).
 *
 * Owns three surfaces:
 * - deals: the sponsorship pipeline (create / patch / move status / delete).
 * - links: UTM/affiliate tracked links (create / bump clicks / delete).
 * - activityItems: the latest activity-feed snapshot, loaded so the media-kit
 *   generator can populate from real per-platform KPIs + top posts without
 *   re-deriving them here.
 *
 * Mirrors `use-radar-store`: mutate via the repo, then reload from the repo so
 * the view is always backed by persisted rows and survives a restart. Pure
 * compute (media-kit formatting, UTM URL building) lives outside the store.
 */

import { create } from "zustand";
import { logger } from "@/lib/logger";
import { listActivityItems } from "@/lib/repos/activity-items";
import {
  type CreateDealInput,
  createDeal,
  deleteDeal,
  listDeals,
  setDealStatus,
  type UpdateDealInput,
  updateDeal,
} from "@/lib/repos/deals";
import {
  type CreateTrackedLinkInput,
  createTrackedLink,
  deleteTrackedLink,
  incrementLinkClicks,
  listTrackedLinks,
  setLinkClicks,
} from "@/lib/repos/tracked-links";
import type {
  ActivityItem,
  Deal,
  DealStatus,
  TrackedLink,
} from "@/lib/social-schema";

interface MoneyState {
  deals: Deal[];
  links: TrackedLink[];
  activityItems: ActivityItem[];
  isLoading: boolean;
  error: string | null;

  refresh: () => Promise<void>;
  addDeal: (input: CreateDealInput) => Promise<void>;
  editDeal: (id: string, patch: UpdateDealInput) => Promise<void>;
  moveDeal: (id: string, status: DealStatus) => Promise<void>;
  removeDeal: (id: string) => Promise<void>;
  addLink: (input: CreateTrackedLinkInput) => Promise<void>;
  bumpLinkClicks: (id: string) => Promise<void>;
  editLinkClicks: (id: string, clicks: number) => Promise<void>;
  removeLink: (id: string) => Promise<void>;
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const useMoneyStore = create<MoneyState>()((set, get) => ({
  deals: [],
  links: [],
  activityItems: [],
  isLoading: false,
  error: null,

  refresh: async () => {
    set({ isLoading: true });
    try {
      const [deals, links, activityItems] = await Promise.all([
        listDeals(),
        listTrackedLinks(),
        listActivityItems(),
      ]);
      set({ deals, links, activityItems, isLoading: false });
    } catch (error) {
      logger.error({ err: error }, "[Money] Failed to refresh");
      set({ isLoading: false });
    }
  },

  addDeal: async (input) => {
    set({ error: null });
    try {
      await createDeal(input);
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Money] Failed to add deal");
      set({ error: describeError(error, "Failed to add deal") });
    }
  },

  editDeal: async (id, patch) => {
    set({ error: null });
    try {
      await updateDeal(id, patch);
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Money] Failed to update deal");
      set({ error: describeError(error, "Failed to update deal") });
    }
  },

  moveDeal: async (id, status) => {
    set({ error: null });
    try {
      await setDealStatus(id, status);
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Money] Failed to move deal");
      set({ error: describeError(error, "Failed to move deal") });
    }
  },

  removeDeal: async (id) => {
    set({ error: null });
    try {
      await deleteDeal(id);
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Money] Failed to remove deal");
      set({ error: describeError(error, "Failed to remove deal") });
    }
  },

  addLink: async (input) => {
    set({ error: null });
    try {
      await createTrackedLink(input);
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Money] Failed to add link");
      set({ error: describeError(error, "Failed to add link") });
    }
  },

  bumpLinkClicks: async (id) => {
    set({ error: null });
    try {
      await incrementLinkClicks(id);
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Money] Failed to record click");
      set({ error: describeError(error, "Failed to record click") });
    }
  },

  editLinkClicks: async (id, clicks) => {
    set({ error: null });
    try {
      await setLinkClicks(id, clicks);
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Money] Failed to set clicks");
      set({ error: describeError(error, "Failed to set clicks") });
    }
  },

  removeLink: async (id) => {
    set({ error: null });
    try {
      await deleteTrackedLink(id);
      await get().refresh();
    } catch (error) {
      logger.error({ err: error }, "[Money] Failed to remove link");
      set({ error: describeError(error, "Failed to remove link") });
    }
  },
}));
