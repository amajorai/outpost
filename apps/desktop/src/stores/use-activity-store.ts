/**
 * Store for the activity feed (U21).
 *
 * Aggregates the user's published posts across every connected account into a
 * single timeline with their latest engagement counts.
 *
 * Refresh flow: for each connected account, list the posts Outpost published to
 * it (`post_history` joined to `post_targets`), resolve the provider responsible
 * for the account's platform, and — only when the platform's `readEngagement`
 * capability is true — read each post's current counts and upsert them into
 * `activity_items`. The store then lists the persisted rows so the feed is
 * stable across refreshes and survives a restart.
 *
 * Platforms whose provider can't read engagement degrade cleanly: their
 * published posts are still tracked (with zeroed counts) so they appear in the
 * feed, just without metrics.
 */

import { create } from "zustand";
import { logger } from "@/lib/logger";
import {
  getCapabilities,
  getProviderFor,
  type Platform,
  type PlatformProvider,
} from "@/lib/providers";
import {
  listActivityItems,
  type UpsertActivityItemInput,
  upsertActivityItem,
} from "@/lib/repos/activity-items";
import {
  listPublishedTargetsForAccount,
  type PublishedTarget,
} from "@/lib/repos/post-history";
import { listSocialAccounts } from "@/lib/repos/social-accounts";
import type { ActivityItem, SocialAccount } from "@/lib/social-schema";

/**
 * Map one account's published posts to activity-item upsert inputs, reading
 * engagement through the provider when the platform supports it.
 *
 * Pure relative to persistence: it takes the published targets and a provider
 * and returns the rows to upsert, never touching `getDb`. This is the unit the
 * fake provider exercises — `FakePlatformProvider.readEngagement` returns a
 * deterministic count for any ref, so a check can drive this with synthetic
 * targets and assert the counts flow through.
 */
export async function buildActivityUpserts(
  account: Pick<SocialAccount, "id" | "workspaceId"> & { platform: Platform },
  targets: PublishedTarget[],
  provider: PlatformProvider
): Promise<UpsertActivityItemInput[]> {
  const caps = await getCapabilities(provider, account.platform);
  const upserts: UpsertActivityItemInput[] = [];
  for (const target of targets) {
    const base: UpsertActivityItemInput = {
      workspaceId: account.workspaceId,
      socialAccountId: account.id,
      platform: target.platform,
      postRemoteId: target.remoteId,
      permalink: target.remoteUrl,
      text: target.variantBody,
      publishedAt: target.publishedAt,
    };
    if (!caps.readEngagement) {
      // Degrade: track the post so it shows in the feed, just without metrics.
      upserts.push(base);
      continue;
    }
    try {
      const counts = await provider.readEngagement({
        platform: account.platform,
        remoteId: target.remoteId,
        remoteUrl: target.remoteUrl ?? undefined,
      });
      upserts.push({
        ...base,
        likes: counts.likes ?? 0,
        comments: counts.comments ?? 0,
        shares: counts.shares ?? 0,
        views: counts.views ?? 0,
        engagementFetchedAt: counts.fetchedAt,
      });
    } catch (error) {
      logger.error(
        { err: error, accountId: account.id, remoteId: target.remoteId },
        "[Activity] Failed to read engagement for post"
      );
      upserts.push(base);
    }
  }
  return upserts;
}

/** Read + persist the activity feed for one connected account. */
async function syncAccount(account: SocialAccount): Promise<void> {
  const platform = account.platform as Platform;
  const targets = await listPublishedTargetsForAccount(account.id);
  if (targets.length === 0) {
    return;
  }
  const provider = await getProviderFor(platform);
  const upserts = await buildActivityUpserts(
    { id: account.id, workspaceId: account.workspaceId, platform },
    targets,
    provider
  );
  for (const upsert of upserts) {
    await upsertActivityItem(upsert);
  }
}

interface ActivityState {
  items: ActivityItem[];
  accounts: SocialAccount[];
  isLoading: boolean;

  /** Sync every connected account's posts + metrics, then list the rows. */
  refresh: () => Promise<void>;
}

export const useActivityStore = create<ActivityState>()((set) => ({
  items: [],
  accounts: [],
  isLoading: false,

  refresh: async () => {
    set({ isLoading: true });
    try {
      const accounts = (await listSocialAccounts()).filter(
        (account) => account.connected === 1
      );
      // Sync each account's posts; a failure on one account is logged and
      // doesn't abort the others.
      await Promise.all(
        accounts.map(async (account) => {
          try {
            await syncAccount(account);
          } catch (error) {
            logger.error(
              { err: error, accountId: account.id },
              "[Activity] Failed to sync account"
            );
          }
        })
      );
      const items = await listActivityItems();
      set({ accounts, items, isLoading: false });
    } catch (error) {
      logger.error({ err: error }, "[Activity] Failed to refresh activity");
      set({ isLoading: false });
    }
  },
}));
