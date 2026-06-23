/**
 * Review queue for auto cross-post (U19).
 *
 * The detected-post listener (lib/cross-post/listener.ts) runs outside React; it
 * reads/writes this store via `getState()` (the same pattern the publish runner
 * uses with `usePublishQueueStore`). When confirmation is required, an ingested
 * post is enqueued here and a review dialog mounted at the app root renders it.
 *
 * Each pending item already passed dedupe and resolved at least one connected
 * target, so the review step is purely "do you want this to go out", never a
 * place where new routing decisions are made.
 */

import { create } from "zustand";
import type { DetectedPost } from "@/lib/cross-post/types";
import type { Platform } from "@/lib/providers/types";

/** A detected post awaiting the user's confirm/cancel decision. */
export interface PendingCrossPost {
  /** Stable id for list keys + dequeue. */
  id: string;
  detected: DetectedPost;
  /** The target platforms resolved from config at ingest time. */
  targetPlatforms: Platform[];
}

interface CrossPostState {
  /** FIFO queue of posts awaiting confirmation. */
  pending: PendingCrossPost[];
  /** Item id currently being published (confirm in flight), for button state. */
  publishingId: string | null;

  /** Add a detected post to the review queue. */
  enqueue: (item: PendingCrossPost) => void;
  /** Remove an item from the queue by id (after confirm or cancel). */
  dequeue: (id: string) => void;
  /** Mark an item as publishing (or clear with null). */
  setPublishing: (id: string | null) => void;
}

export const useCrossPostStore = create<CrossPostState>()((set) => ({
  pending: [],
  publishingId: null,

  enqueue: (item) => set((state) => ({ pending: [...state.pending, item] })),

  dequeue: (id) =>
    set((state) => ({
      pending: state.pending.filter((p) => p.id !== id),
      publishingId: state.publishingId === id ? null : state.publishingId,
    })),

  setPublishing: (id) => set({ publishingId: id }),
}));
