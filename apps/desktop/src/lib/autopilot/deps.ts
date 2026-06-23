/**
 * Production wiring for the crew orchestrator / Autopilot (U30).
 *
 * Builds an {@link AutopilotDeps} backed by the real Strategist ACP call, the
 * U26 timing recommender (the Analyst), the autopilot repo, and the existing
 * scheduled_posts pipeline. Kept separate from `orchestrator.ts` so the core
 * stays free of `@tauri-apps/*` / ACP / repo imports and the bun-runnable check
 * can build its own in-memory deps.
 *
 * Two responsibilities live here:
 *  - `buildPlan`: ask the Strategist for posts, then let the Analyst place the
 *    times. The agent only gives a timing *hint*; concrete `scheduledFor`s come
 *    from `recommendationsByPlatform(activity)` + `nextOccurrence`, spread across
 *    the week (each item on a platform advances the base date) so a whole plan
 *    never stacks on one slot. This is what makes "coordinates the Analyst" real.
 *  - `queueAction`: turn a proposed action into a real `scheduled_posts` row via
 *    the same path the composer uses, and mark the action `queued` with the
 *    scheduled-post id linked. Re-checks the approval gate as defense in depth.
 */

import {
  type AutopilotDeps,
  canQueueAction,
  type PlannedPost,
} from "@/lib/autopilot/orchestrator";
import { buildStrategistPlan } from "@/lib/autopilot/strategist";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { logger } from "@/lib/logger";
import { listActivityItems } from "@/lib/repos/activity-items";
import { createPlan, getAction, markActionQueued } from "@/lib/repos/autopilot";
import {
  decodeDraftBody,
  emptyDraftBody,
  encodeDraftBody,
  saveDraft,
} from "@/lib/repos/drafts";
import { createScheduledPost } from "@/lib/repos/scheduled-posts";
import { listSocialAccounts } from "@/lib/repos/social-accounts";
import type { AutopilotAutonomy } from "@/lib/social-schema";
import {
  computeTimingSlots,
  nextOccurrence,
  recommendationsByPlatform,
  type TimingRecommendation,
} from "@/lib/timing/recommender";

/** Hours apart consecutive plan items on a platform are spread. */
const SPREAD_HOURS = 24;
const MS_PER_HOUR = 3_600_000;

/** A strategist post before the Analyst assigns it a concrete time. */
interface UntimedPost {
  hook: string;
  body: string;
  targetPlatform: string;
  rationale: string;
}

/**
 * Assign a concrete posting time to each planned post using the Analyst's timing
 * recommender. Items targeting the same platform get the platform's best slot
 * projected forward from a base date that advances per item, so consecutive
 * posts on a platform land on distinct days rather than the same hour. Falls back
 * to a forward spread when a platform has no recommendation or no slots.
 */
function placeTimes(
  posts: UntimedPost[],
  byPlatform: Map<string, TimingRecommendation>,
  now: number
): PlannedPost[] {
  const perPlatformCount = new Map<string, number>();
  const placed: PlannedPost[] = [];

  for (const post of posts) {
    const platform = post.targetPlatform;
    const index = perPlatformCount.get(platform) ?? 0;
    perPlatformCount.set(platform, index + 1);

    const recommendation =
      byPlatform.get(platform) ?? computeTimingSlots(platform, []);
    const slot = recommendation.slots[0];
    const base = new Date(now + index * SPREAD_HOURS * MS_PER_HOUR);
    const scheduledFor = slot
      ? nextOccurrence(slot, base).getTime()
      : base.getTime();

    placed.push({
      hook: post.hook,
      body: post.body,
      targetPlatform: platform,
      rationale: post.rationale,
      scheduledFor,
    });
  }

  return placed;
}

/**
 * Resolve a connected account for a platform, or null when the workspace has
 * none. A proposed post can't be queued without an account to publish to.
 */
async function findAccountForPlatform(
  platform: string
): Promise<string | null> {
  const accounts = await listSocialAccounts();
  const match = accounts.find(
    (account) => account.platform === platform && account.connected === 1
  );
  return match?.id ?? null;
}

/**
 * Build the production {@link AutopilotDeps} for a workspace. The autonomy level
 * is captured so `queueAction` can re-check the gate as defense in depth — the
 * orchestrator core already gates, but the deps refuse to queue an action the
 * level does not permit even if called directly.
 */
export function defaultAutopilotDeps(
  autonomy: AutopilotAutonomy,
  workspaceId: string = getCurrentWorkspaceId()
): AutopilotDeps {
  return {
    buildPlan: async () => {
      const { posts } = await buildStrategistPlan(workspaceId);
      if (posts.length === 0) {
        return [];
      }
      // The Analyst places the times: read activity, compute per-platform slots,
      // and project each post forward. Read defensively so a failure degrades to
      // a plan with simple forward-spread times rather than aborting.
      let byPlatform = new Map<string, TimingRecommendation>();
      try {
        const activity = await listActivityItems(workspaceId);
        byPlatform = recommendationsByPlatform(activity);
      } catch (error) {
        logger.error(
          { err: error },
          "[Autopilot] Failed to read activity for timing"
        );
      }
      return placeTimes(posts, byPlatform, Date.now());
    },

    recordPlan: async (posts) => {
      const actions = await createPlan(
        posts.map((post) => ({
          body: encodeDraftBody({
            ...emptyDraftBody(),
            text: post.body,
            segments: [{ text: post.body, media: [] }],
          }),
          hook: post.hook,
          targetPlatform: post.targetPlatform,
          scheduledFor: post.scheduledFor,
          rationale: post.rationale,
        })),
        workspaceId
      );
      return actions.map((action) => action.id);
    },

    queueAction: async (actionId) => {
      const action = await getAction(actionId);
      if (!action) {
        throw new Error(`Autopilot action ${actionId} not found`);
      }
      // Defense in depth: refuse to touch a real account if the gate (autonomy
      // level + the action's current status) does not permit queuing it now.
      if (!canQueueAction(autonomy, action.status)) {
        throw new Error(
          `Autopilot action ${actionId} cannot be queued at the "${autonomy}" autonomy level`
        );
      }

      const accountId = await findAccountForPlatform(action.targetPlatform);
      if (!accountId) {
        throw new Error(
          `No connected ${action.targetPlatform} account to queue this post`
        );
      }

      const draft = await saveDraft({
        body: decodeDraftBody(action.body),
        workspaceId,
      });
      const { post } = await createScheduledPost({
        draftId: draft.id,
        scheduledFor: action.scheduledFor ?? Date.now(),
        targets: [
          { socialAccountId: accountId, platform: action.targetPlatform },
        ],
        workspaceId,
      });
      await markActionQueued(actionId, post.id);
    },
  };
}
