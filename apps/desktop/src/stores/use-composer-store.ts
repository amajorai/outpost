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
import type {
  ComposeSegment,
  MediaAttachment,
} from "@/lib/compose/platform-limits";
import { reformatForPlatforms as reformatVariants } from "@/lib/compose/reformat";
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
  /**
   * Ordered post segments (U12). Always length >= 1. `segments[0]` is the
   * primary post; additional segments are thread tweets / carousel slides for
   * platforms that support them. `text`/`media` below always mirror
   * `segments[0]` so single-segment callers and the degrade path stay simple.
   */
  segments: ComposeSegment[];
  /** Mirror of `segments[0].text`. */
  text: string;
  /** Mirror of `segments[0].media`. */
  media: MediaAttachment[];
  /** Selected target account ids. */
  selectedAccountIds: string[];
  /** All connected accounts available as targets. */
  accounts: SocialAccount[];
  /**
   * AI-reformatted per-platform variant text (U15), keyed by platform. When a
   * selected account's platform has an entry here, scheduling sends that text as
   * the target's `variantBody`; otherwise the shared draft text is used. Cleared
   * on `reset()` and whenever the user edits the shared draft.
   */
  platformVariants: Record<string, string>;
  /** True while an AI reformat run is in flight. */
  isReformatting: boolean;
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
  /** Set the text of a segment (defaults to the first/primary segment). */
  setText: (text: string, index?: number) => void;
  /** Append media to a segment (defaults to the first/primary segment). */
  addMedia: (items: MediaAttachment[], index?: number) => void;
  /** Remove a media item by path from a segment (defaults to the first). */
  removeMedia: (path: string, index?: number) => void;
  /** Append a new empty segment to the end. */
  addSegment: () => void;
  /** Remove the segment at `index`. A no-op when only one segment remains. */
  removeSegment: (index: number) => void;
  /** Move the segment at `index` one slot toward "up" or "down". */
  moveSegment: (index: number, direction: "up" | "down") => void;
  toggleAccount: (accountId: string) => void;
  /**
   * Reformat the current draft into per-platform variants via the configured
   * ACP agent (U15). Populates `platformVariants` for each platform the agent
   * returned and leaves the rest on the shared draft. Returns the run result so
   * the caller can surface a toast; never throws.
   */
  reformat: (
    capabilities: import("@/lib/providers").CapabilityMatrix | null
  ) => Promise<import("@/lib/compose/reformat").ReformatResult>;
  /** Set (or replace) the reviewed variant text for a platform. */
  setPlatformVariant: (platform: string, text: string) => void;
  /** Drop a platform's variant so it falls back to the shared draft text. */
  clearPlatformVariant: (platform: string) => void;
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
    text: state.segments[0]?.text ?? "",
    media: state.segments[0]?.media ?? [],
    accountIds: state.selectedAccountIds,
    segments:
      state.segments.length > 0 ? state.segments : [{ text: "", media: [] }],
  };
}

/**
 * Apply a transform to the `segments` array and return the patch, keeping the
 * top-level `text`/`media` mirrors in sync with `segments[0]`. Always normalizes
 * to at least one segment so callers never have to guard for an empty list.
 */
function withSegments(
  segments: ComposeSegment[]
): Pick<ComposerState, "segments" | "text" | "media"> {
  const next = segments.length > 0 ? segments : [{ text: "", media: [] }];
  return { segments: next, text: next[0].text, media: next[0].media };
}

export const useComposerStore = create<ComposerState>()((set, get) => ({
  segments: [{ text: "", media: [] }],
  text: "",
  media: [],
  selectedAccountIds: [],
  accounts: [],
  platformVariants: {},
  isReformatting: false,
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

  setText: (text, index = 0) =>
    set((state) =>
      withSegments(
        state.segments.map((segment, i) =>
          i === index ? { ...segment, text } : segment
        )
      )
    ),

  addMedia: (items, index = 0) =>
    set((state) =>
      withSegments(
        state.segments.map((segment, i) => {
          if (i !== index) {
            return segment;
          }
          const existing = new Set(segment.media.map((m) => m.path));
          const next = items.filter((item) => !existing.has(item.path));
          return { ...segment, media: [...segment.media, ...next] };
        })
      )
    ),

  removeMedia: (path, index = 0) =>
    set((state) =>
      withSegments(
        state.segments.map((segment, i) =>
          i === index
            ? {
                ...segment,
                media: segment.media.filter((item) => item.path !== path),
              }
            : segment
        )
      )
    ),

  addSegment: () =>
    set((state) => withSegments([...state.segments, { text: "", media: [] }])),

  removeSegment: (index) =>
    set((state) => {
      if (state.segments.length <= 1) {
        return {};
      }
      return withSegments(state.segments.filter((_, i) => i !== index));
    }),

  moveSegment: (index, direction) =>
    set((state) => {
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= state.segments.length) {
        return {};
      }
      const next = [...state.segments];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return withSegments(next);
    }),

  toggleAccount: (accountId) =>
    set((state) => ({
      selectedAccountIds: state.selectedAccountIds.includes(accountId)
        ? state.selectedAccountIds.filter((id) => id !== accountId)
        : [...state.selectedAccountIds, accountId],
    })),

  reformat: async (capabilities) => {
    const state = get();
    const selectedPlatforms = [
      ...new Set(
        state.accounts
          .filter((account) => state.selectedAccountIds.includes(account.id))
          .map((account) => account.platform)
      ),
    ];
    set({ isReformatting: true });
    try {
      const result = await reformatVariants(
        state.segments[0]?.text ?? "",
        selectedPlatforms,
        capabilities
      );
      if (Object.keys(result.variants).length > 0) {
        set((current) => ({
          platformVariants: { ...current.platformVariants, ...result.variants },
        }));
      }
      return result;
    } finally {
      set({ isReformatting: false });
    }
  },

  setPlatformVariant: (platform, text) =>
    set((state) => ({
      platformVariants: { ...state.platformVariants, [platform]: text },
    })),

  clearPlatformVariant: (platform) =>
    set((state) => {
      const next = { ...state.platformVariants };
      delete next[platform];
      return { platformVariants: next };
    }),

  reset: () =>
    set({
      segments: [{ text: "", media: [] }],
      text: "",
      media: [],
      selectedAccountIds: [],
      platformVariants: {},
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
        selectedAccountIds: body.accountIds,
        isSubmitting: false,
        ...withSegments(body.segments),
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
          // U15: an AI-reformatted variant for this platform overrides the
          // shared draft text for just this target; omit to use the draft.
          variantBody: state.platformVariants[account.platform] ?? null,
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
