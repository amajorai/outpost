/**
 * Route a confirmed detected post to its cross-post targets (U19).
 *
 * Reuses the existing publish stack rather than reimplementing publishing: a
 * confirmed post becomes a "post now" scheduled post (one `post_target` per
 * resolved account, carrying the detected text as `variant_body`), then a single
 * scheduler sweep fires it immediately. From there the established
 * scheduler -> runner -> publish-pipeline path publishes each target and writes
 * `post_history` rows with full retry/backoff, exactly as a normal scheduled
 * post would.
 *
 * Target resolution: for each enabled target platform we publish to every
 * connected account on that platform. The source platform is always excluded
 * (cross-posting means posting to *other* platforms).
 *
 * Limitation (deliberate, matching U18): this is text-only. Detected media are
 * `blob:` preview URLs that aren't usable on the desktop, and the publish
 * pipeline's variant-body path is text-only anyway, so detected media are not
 * carried across. Long-form source posts may exceed a target's char limit and
 * be rejected by the provider — surfaced as a per-target failure in history.
 */

import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { logger } from "@/lib/logger";
import type { Platform } from "@/lib/providers/types";
import {
  createScheduledPost,
  type ScheduleTargetInput,
} from "@/lib/repos/scheduled-posts";
import { listSocialAccounts } from "@/lib/repos/social-accounts";
import { runSweep } from "@/lib/scheduler/scheduler";
import type { DetectedPost } from "./types";

export interface RouteResult {
  /** The created scheduled post id, or null when there was nothing to post. */
  scheduledPostId: string | null;
  /** How many target accounts the post was fanned out to. */
  targetCount: number;
}

/**
 * Build the per-account targets for a detected post given its enabled target
 * platforms. Every connected account on each enabled platform (excluding the
 * source platform) becomes one target carrying the detected text as its
 * variant body.
 */
async function buildTargets(
  detected: DetectedPost,
  targetPlatforms: Platform[],
  workspaceId: string
): Promise<ScheduleTargetInput[]> {
  const accounts = await listSocialAccounts(workspaceId);
  const enabled = new Set(
    targetPlatforms.filter((p) => p !== detected.platform)
  );

  const targets: ScheduleTargetInput[] = [];
  for (const account of accounts) {
    if (!(enabled.has(account.platform as Platform) && account.connected)) {
      continue;
    }
    targets.push({
      socialAccountId: account.id,
      platform: account.platform,
      // Variant body carries the detected text so the publish pipeline posts it
      // verbatim without needing a draft.
      variantBody: detected.text,
    });
  }
  return targets;
}

/**
 * Route a confirmed detected post to its configured target platforms. Creates a
 * "post now" scheduled post and triggers an immediate sweep so it publishes
 * without waiting for the next poll. Returns the created post id + target count;
 * when no connected target accounts resolve, posts nothing and returns null.
 */
export async function routeDetectedPost(
  detected: DetectedPost,
  targetPlatforms: Platform[],
  workspaceId: string = getCurrentWorkspaceId()
): Promise<RouteResult> {
  const targets = await buildTargets(detected, targetPlatforms, workspaceId);
  if (targets.length === 0) {
    logger.info(
      { source: detected.platform, targetPlatforms },
      "[CrossPost] No connected target accounts; nothing to post"
    );
    return { scheduledPostId: null, targetCount: 0 };
  }

  const created = await createScheduledPost({
    draftId: null,
    scheduledFor: Date.now(),
    targets,
    workspaceId,
  });

  logger.info(
    {
      source: detected.platform,
      postId: created.post.id,
      targetCount: targets.length,
    },
    "[CrossPost] Routed detected post to cross-post targets"
  );

  // Fire immediately rather than waiting up to the poll interval. runSweep
  // flips the post to `due` and emits it to the publish runner. It never throws.
  await runSweep();

  return { scheduledPostId: created.post.id, targetCount: targets.length };
}
