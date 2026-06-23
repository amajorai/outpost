/**
 * Production wiring for the experiments engine (U25).
 *
 * Builds an {@link ExperimentDeps} backed by the real DB repos, the publish
 * pipeline, and the provider registry. Kept separate from `engine.ts` so the
 * engine core stays free of `@tauri-apps/*` imports and the bun-runnable check
 * can build its own in-memory deps.
 *
 * Publishing a variant reuses the existing publish path verbatim: the variant's
 * JSON body becomes a `Draft`, a `scheduled_posts` row + one `post_targets` row
 * (to a connected account on the variant's platform) is created, and
 * `publishScheduledPost` fans it out -> `post_history`. Evaluation reads each
 * variant's published remote id from `post_history` and queries the provider's
 * `readEngagement`, the same engagement source the activity feed (U21) uses.
 */

import { getProviderFor, type Platform } from "@/lib/providers";
import { defaultPublishDeps } from "@/lib/publish/deps";
import { publishScheduledPost } from "@/lib/publish/pipeline";
import { decodeDraftBody, saveDraft } from "@/lib/repos/drafts";
import {
  recordExperimentResults,
  setVariantScheduledPost,
  updateExperimentStatus,
} from "@/lib/repos/experiments";
import { listPostHistoryForTarget } from "@/lib/repos/post-history";
import {
  createScheduledPost,
  listPostTargets,
} from "@/lib/repos/scheduled-posts";
import { listSocialAccounts } from "@/lib/repos/social-accounts";
import type { ExperimentVariant } from "@/lib/social-schema";
import type { ExperimentDeps, VariantEngagement } from "./engine";

/**
 * Resolve a connected account for a variant's platform, or null when the
 * workspace has none. A variant can't publish without an account to publish to.
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
 * Publish one variant via the existing pipeline. Saves the variant body as a
 * draft, schedules it to a connected account on its platform (at its
 * `scheduledFor`, or now), then publishes it. Returns the scheduled post id so
 * the engine can record it on the variant.
 */
async function publishVariant(variant: ExperimentVariant): Promise<string> {
  const accountId = await findAccountForPlatform(variant.targetPlatform);
  if (!accountId) {
    throw new Error(
      `No connected ${variant.targetPlatform} account to publish variant "${variant.label}"`
    );
  }

  const draft = await saveDraft({ body: decodeDraftBody(variant.draftBody) });
  const { post } = await createScheduledPost({
    draftId: draft.id,
    scheduledFor: variant.scheduledFor ?? Date.now(),
    targets: [{ socialAccountId: accountId, platform: variant.targetPlatform }],
  });

  // Publish immediately through the same orchestration the scheduler uses, so a
  // variant flows create -> publish -> post_history exactly like any other post.
  await publishScheduledPost(post, defaultPublishDeps());
  return post.id;
}

/**
 * Read a variant's current engagement after publish. Finds the variant's
 * published target (the scheduled post it created has exactly one target),
 * resolves the remote id from `post_history`, and queries the provider. Returns
 * null when the variant never published, so it scores 0 rather than aborting.
 */
async function readVariantEngagement(
  variant: ExperimentVariant
): Promise<VariantEngagement | null> {
  if (!variant.scheduledPostId) {
    return null;
  }
  const targets = await listPostTargets(variant.scheduledPostId);
  const target = targets[0];
  if (!target) {
    return null;
  }
  const history = await listPostHistoryForTarget(target.id);
  const published = history.find(
    (row) => row.status === "published" && row.remoteId
  );
  if (!published?.remoteId) {
    return null;
  }

  const platform = variant.targetPlatform as Platform;
  const provider = await getProviderFor(platform);
  const counts = await provider.readEngagement({
    platform,
    remoteId: published.remoteId,
    remoteUrl: published.remoteUrl ?? undefined,
  });
  return {
    likes: counts.likes ?? 0,
    comments: counts.comments ?? 0,
    shares: counts.shares ?? 0,
    views: counts.views ?? 0,
  };
}

/** Build the production {@link ExperimentDeps} backed by the real data layer. */
export function defaultExperimentDeps(): ExperimentDeps {
  return {
    publishVariant,
    setVariantScheduledPost,
    setExperimentStatus: updateExperimentStatus,
    readVariantEngagement,
    recordResults: (input) =>
      recordExperimentResults({
        experimentId: input.experimentId,
        measuredAt: input.measuredAt,
        results: input.results,
      }),
  };
}
