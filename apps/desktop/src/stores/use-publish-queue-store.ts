/**
 * Publish queue state (U10).
 *
 * A minimal, observable view of what the publish pipeline is doing: which posts
 * are in flight and the most recent settled results. The runner updates this as
 * posts move through, and the Activity section (or any UI) can subscribe. Toasts
 * are fired by the runner, not here, so this store stays presentation-free.
 */

import { create } from "zustand";
import type { PostOutcome } from "@/lib/publish/pipeline";

/** A settled publish result kept for the recent-results list. */
export interface PublishQueueResult {
  postId: string;
  status: PostOutcome["status"];
  published: number;
  total: number;
  settledAt: number;
}

/** How many recent results to retain. */
const MAX_RECENT = 50;

interface PublishQueueState {
  /** Ids of posts currently being published. */
  inFlight: string[];
  /** Most recent settled results, newest first. */
  recent: PublishQueueResult[];

  /** Mark a post as in flight. */
  start: (postId: string) => void;
  /** Record a settled outcome and clear its in-flight marker. */
  settle: (outcome: PostOutcome) => void;
}

export const usePublishQueueStore = create<PublishQueueState>()((set) => ({
  inFlight: [],
  recent: [],

  start: (postId) =>
    set((state) =>
      state.inFlight.includes(postId)
        ? state
        : { inFlight: [...state.inFlight, postId] }
    ),

  settle: (outcome) =>
    set((state) => {
      const result: PublishQueueResult = {
        postId: outcome.postId,
        status: outcome.status,
        published: outcome.targets.filter((t) => t.status === "published")
          .length,
        total: outcome.targets.length,
        settledAt: Date.now(),
      };
      return {
        inFlight: state.inFlight.filter((id) => id !== outcome.postId),
        recent: [result, ...state.recent].slice(0, MAX_RECENT),
      };
    }),
}));
