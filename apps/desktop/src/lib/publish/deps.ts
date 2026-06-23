/**
 * Production wiring for the publish pipeline (U10).
 *
 * Builds a {@link PublishDeps} backed by the real DB repos, the provider
 * registry, and a real clock. Kept separate from `pipeline.ts` so the pipeline
 * core stays free of `@tauri-apps/*` imports and the integration check can build
 * its own in-memory deps without dragging in the DB layer.
 *
 * Content resolution (the one piece of real business logic here): a target's
 * text comes from its `variant_body` override when set, otherwise from the
 * linked draft's decoded JSON body. Media comes from the draft body. The
 * account DTO is resolved from the persisted `social_accounts` row so the
 * provider gets the platform + external id it needs.
 */

import { getProviderFor } from "@/lib/providers";
import type { Platform, PublishMedia } from "@/lib/providers/types";
import { decodeDraftBody, getDraft } from "@/lib/repos/drafts";
import { recordPostHistory } from "@/lib/repos/post-history";
import {
  listPostTargets,
  updatePostTargetStatus,
  updateScheduledPostStatus,
} from "@/lib/repos/scheduled-posts";
import { listSocialAccounts } from "@/lib/repos/social-accounts";
import type { PostTarget, ScheduledPost } from "@/lib/social-schema";
import {
  type PublishDeps,
  type ResolvedTargetContent,
  realSleep,
} from "./pipeline";

/** Map the draft body's media attachments to provider-facing media DTOs. */
function toPublishMedia(
  media: { path: string; mimeType: string; name: string }[]
): PublishMedia[] {
  return media.map((item) => ({
    url: item.path,
    mimeType: item.mimeType,
    altText: item.name,
  }));
}

/**
 * Resolve a target's publish content from the persisted draft + account rows.
 * Returns null when there's no usable body so the pipeline fails the target
 * rather than posting empty.
 */
async function resolveTargetContent(
  post: ScheduledPost,
  target: PostTarget
): Promise<ResolvedTargetContent | null> {
  // Account DTO from the persisted row (workspace-scoped lookup, then by id).
  const accounts = await listSocialAccounts(post.workspaceId);
  const account = accounts.find((a) => a.id === target.socialAccountId);

  const providerAccount = {
    id: target.socialAccountId,
    platform: target.platform as Platform,
    label: account?.accountLabel,
    externalId: account?.externalId ?? null,
  };

  // Per-target override wins; otherwise fall back to the draft body text.
  if (target.variantBody != null && target.variantBody.length > 0) {
    return {
      text: target.variantBody,
      media: [],
      account: providerAccount,
    };
  }

  if (!post.draftId) {
    return null;
  }
  const draft = await getDraft(post.draftId);
  if (!draft) {
    return null;
  }
  const body = decodeDraftBody(draft.body);
  if (body.text.length === 0 && body.media.length === 0) {
    return null;
  }
  return {
    text: body.text,
    media: toPublishMedia(body.media),
    account: providerAccount,
  };
}

/** Build the production {@link PublishDeps} backed by the real data layer. */
export function defaultPublishDeps(): PublishDeps {
  return {
    listPostTargets,
    resolveTargetContent,
    getProviderFor,
    recordPostHistory,
    updatePostTargetStatus,
    updateScheduledPostStatus,
    sleep: realSleep,
  };
}
