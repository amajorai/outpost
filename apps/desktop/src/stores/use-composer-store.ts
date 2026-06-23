/**
 * Composer state + actions (U8).
 *
 * Holds the in-progress post (text, raw media, selected target accounts) and the
 * actions that persist it: save/load draft, schedule, and post-now. The store is
 * the single orchestration point so the composer components stay presentational.
 *
 * Scheduling fans the post out to one `post_target` per selected account via
 * `createScheduledPost`. "Post now" is the same path with `scheduledFor = now`;
 * the post starts `scheduled`, so the U9 scheduler's next sweep picks it up. We
 * also kick an immediate `runSweep()` after post-now so it fires without waiting
 * for the poll interval — a nice-to-have, not required for correctness.
 */

import { create } from "zustand";
import type { MediaAttachment } from "@/lib/compose/platform-limits";
import { logger } from "@/lib/logger";
import {
  type DraftBody,
  decodeDraftBody,
  emptyDraftBody,
  getDraft,
  saveDraft,
} from "@/lib/repos/drafts";
import { createScheduledPost } from "@/lib/repos/scheduled-posts";
import { listSocialAccounts } from "@/lib/repos/social-accounts";
import { runSweep } from "@/lib/scheduler/scheduler";
import type { SocialAccount } from "@/lib/social-schema";

interface ComposerState {
  /** The post body text. */
  text: string;
  /** Raw media attachments, in order. */
  media: MediaAttachment[];
  /** Selected target account ids. */
  selectedAccountIds: string[];
  /** All connected accounts available as targets. */
  accounts: SocialAccount[];
  /** The draft currently being edited, or null for an unsaved post. */
  draftId: string | null;
  /**
   * A prefilled schedule time (epoch millis) handed off from another surface,
   * e.g. clicking an empty calendar slot (U11). The composer panel reads and
   * clears this on mount via `consumeScheduledAt`; null when nothing is pending.
   */
  pendingScheduledAt: number | null;
  /** True while a save/schedule action is in flight. */
  isSubmitting: boolean;
  /** Last action error, surfaced to the user. */
  error: string | null;

  /** Load available target accounts. */
  loadAccounts: () => Promise<void>;
  setText: (text: string) => void;
  addMedia: (items: MediaAttachment[]) => void;
  removeMedia: (path: string) => void;
  toggleAccount: (accountId: string) => void;
  reset: () => void;
  /** Save (insert or update) the current draft. */
  save: () => Promise<void>;
  /** Load a draft by id into the composer. */
  loadDraft: (id: string) => Promise<void>;
  /** Schedule the post at the given time across selected accounts. */
  schedule: (scheduledFor: number) => Promise<void>;
  /** Schedule the post for immediate publishing. */
  postNow: () => Promise<void>;
  /** Stash a schedule time for the composer panel to pick up on mount (U11). */
  prefillSchedule: (scheduledFor: number) => void;
  /** Read and clear the pending schedule time, if any. */
  consumeScheduledAt: () => number | null;
}

function currentBody(state: ComposerState): DraftBody {
  return {
    ...emptyDraftBody(),
    text: state.text,
    media: state.media,
    accountIds: state.selectedAccountIds,
  };
}

export const useComposerStore = create<ComposerState>()((set, get) => ({
  text: "",
  media: [],
  selectedAccountIds: [],
  accounts: [],
  draftId: null,
  pendingScheduledAt: null,
  isSubmitting: false,
  error: null,

  loadAccounts: async () => {
    try {
      const accounts = await listSocialAccounts();
      set((state) => ({
        accounts,
        // Drop any selected ids that no longer resolve to a connected account.
        selectedAccountIds: state.selectedAccountIds.filter((id) =>
          accounts.some((account) => account.id === id)
        ),
      }));
    } catch (error) {
      logger.error({ err: error }, "[Composer] Failed to load accounts");
    }
  },

  setText: (text) => set({ text }),

  addMedia: (items) =>
    set((state) => {
      const existing = new Set(state.media.map((m) => m.path));
      const next = items.filter((item) => !existing.has(item.path));
      return { media: [...state.media, ...next] };
    }),

  removeMedia: (path) =>
    set((state) => ({
      media: state.media.filter((item) => item.path !== path),
    })),

  toggleAccount: (accountId) =>
    set((state) => ({
      selectedAccountIds: state.selectedAccountIds.includes(accountId)
        ? state.selectedAccountIds.filter((id) => id !== accountId)
        : [...state.selectedAccountIds, accountId],
    })),

  reset: () =>
    set({
      text: "",
      media: [],
      selectedAccountIds: [],
      draftId: null,
      error: null,
    }),

  save: async () => {
    const state = get();
    set({ isSubmitting: true, error: null });
    try {
      const saved = await saveDraft({
        id: state.draftId ?? undefined,
        body: currentBody(state),
      });
      set({ draftId: saved.id, isSubmitting: false });
    } catch (error) {
      logger.error({ err: error }, "[Composer] Failed to save draft");
      set({
        isSubmitting: false,
        error: error instanceof Error ? error.message : "Failed to save draft",
      });
      throw error;
    }
  },

  loadDraft: async (id) => {
    set({ isSubmitting: true, error: null });
    try {
      const draft = await getDraft(id);
      if (!draft) {
        set({ isSubmitting: false, error: "Draft not found" });
        return;
      }
      const body = decodeDraftBody(draft.body);
      set({
        draftId: draft.id,
        text: body.text,
        media: body.media,
        selectedAccountIds: body.accountIds,
        isSubmitting: false,
      });
    } catch (error) {
      logger.error({ err: error }, "[Composer] Failed to load draft");
      set({
        isSubmitting: false,
        error: error instanceof Error ? error.message : "Failed to load draft",
      });
    }
  },

  schedule: async (scheduledFor) => {
    const state = get();
    const selected = state.accounts.filter((account) =>
      state.selectedAccountIds.includes(account.id)
    );
    if (selected.length === 0) {
      set({ error: "Select at least one account" });
      return;
    }
    set({ isSubmitting: true, error: null });
    try {
      // Persist the draft first so the scheduled post links to a stored body.
      const saved = await saveDraft({
        id: state.draftId ?? undefined,
        body: currentBody(state),
      });
      await createScheduledPost({
        draftId: saved.id,
        scheduledFor,
        targets: selected.map((account) => ({
          socialAccountId: account.id,
          platform: account.platform,
        })),
      });
      set({
        draftId: saved.id,
        isSubmitting: false,
      });
    } catch (error) {
      logger.error({ err: error }, "[Composer] Failed to schedule post");
      set({
        isSubmitting: false,
        error:
          error instanceof Error ? error.message : "Failed to schedule post",
      });
      throw error;
    }
  },

  postNow: async () => {
    await get().schedule(Date.now());
    // Kick an immediate sweep so the post fires without waiting for the poll.
    runSweep().catch(() => {
      // runSweep swallows its own errors; the catch keeps the promise unfloated.
    });
  },

  prefillSchedule: (scheduledFor) => set({ pendingScheduledAt: scheduledFor }),

  consumeScheduledAt: () => {
    const pending = get().pendingScheduledAt;
    if (pending !== null) {
      set({ pendingScheduledAt: null });
    }
    return pending;
  },
}));
