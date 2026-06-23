/**
 * Store for the unified engagement inbox (U20).
 *
 * Aggregates comments, replies, mentions, and DMs across every connected
 * account, gated by the capability matrix:
 *  - comment / reply / mention items require `readComments`
 *  - DM items require `readDMs`
 *  - replying requires `readComments` (or `sendDM` for a DM)
 *
 * Reading flow: for each connected account, resolve the provider responsible
 * for its platform, skip it when the provider can't read an inbox, otherwise
 * `readInbox()` and persist each item via `INSERT OR IGNORE` (so re-syncing
 * never duplicates). The store then lists the persisted rows so the inbox is
 * stable across refreshes and survives a restart.
 *
 * Providers/platforms that support nothing degrade cleanly: they contribute no
 * items and the inbox simply shows what the supported ones returned.
 */

import { create } from "zustand";
import { logger } from "@/lib/logger";
import {
  getCapabilities,
  getProviderFor,
  type Platform,
  type PlatformProvider,
  type ProviderAccount,
  type ProviderInboxItem,
} from "@/lib/providers";
import {
  createInboxItem,
  listInboxItems,
  markInboxItemReplied,
} from "@/lib/repos/inbox-items";
import { listSocialAccounts } from "@/lib/repos/social-accounts";
import type { InboxItem, SocialAccount } from "@/lib/social-schema";

/** Whether a kind is allowed for an account given its platform capabilities. */
async function canReplyToKind(
  provider: PlatformProvider,
  platform: Platform,
  kind: InboxItem["kind"]
): Promise<boolean> {
  const caps = await getCapabilities(provider, platform);
  return kind === "dm" ? caps.sendDM : caps.readComments;
}

function toProviderAccount(account: SocialAccount): ProviderAccount {
  return {
    id: account.id,
    platform: account.platform as Platform,
    label: account.accountLabel,
    externalId: account.externalId,
  };
}

/** Read + persist the inbox for one connected account. */
async function syncAccount(account: SocialAccount): Promise<void> {
  const platform = account.platform as Platform;
  const provider = await getProviderFor(platform);
  if (!provider.readInbox) {
    return;
  }
  const caps = await getCapabilities(provider, platform);
  if (!(caps.readComments || caps.readDMs)) {
    return;
  }

  let items: ProviderInboxItem[];
  try {
    items = await provider.readInbox(toProviderAccount(account));
  } catch (error) {
    logger.error(
      { err: error, accountId: account.id },
      "[Inbox] Failed to read inbox for account"
    );
    return;
  }

  for (const item of items) {
    // Respect the matrix even if a provider over-reports: drop DM items when
    // the platform doesn't read DMs, and comment-family items when it doesn't
    // read comments.
    const supported = item.kind === "dm" ? caps.readDMs : caps.readComments;
    if (!supported) {
      continue;
    }
    await createInboxItem({
      socialAccountId: account.id,
      platform: item.platform,
      kind: item.kind,
      author: item.author,
      text: item.text,
      permalink: item.permalink ?? null,
      externalId: item.externalId,
      receivedAt: item.receivedAt,
      workspaceId: account.workspaceId,
    });
  }
}

interface InboxState {
  items: InboxItem[];
  accounts: SocialAccount[];
  isLoading: boolean;
  /** Inbox item id currently having a reply sent, for per-row button state. */
  replyingId: string | null;

  /** Read every connected account's inbox, persist, then list the rows. */
  refresh: () => Promise<void>;
  /**
   * Send a reply to an inbox item through its account's provider, then mark the
   * item replied on success. Returns true when the reply was sent.
   */
  reply: (item: InboxItem, text: string) => Promise<boolean>;
}

export const useInboxStore = create<InboxState>()((set, get) => ({
  items: [],
  accounts: [],
  isLoading: false,
  replyingId: null,

  refresh: async () => {
    set({ isLoading: true });
    try {
      const accounts = (await listSocialAccounts()).filter(
        (account) => account.connected === 1
      );
      // Sync each account's inbox into the table; failures are logged per
      // account and don't abort the others.
      await Promise.all(accounts.map((account) => syncAccount(account)));
      const items = await listInboxItems();
      set({ accounts, items, isLoading: false });
    } catch (error) {
      logger.error({ err: error }, "[Inbox] Failed to refresh inbox");
      set({ isLoading: false });
    }
  },

  reply: async (item, text) => {
    const body = text.trim();
    if (!body) {
      return false;
    }
    const account = get().accounts.find((a) => a.id === item.socialAccountId);
    if (!account) {
      logger.error(
        { itemId: item.id },
        "[Inbox] No connected account for inbox item"
      );
      return false;
    }
    const platform = item.platform as Platform;
    set({ replyingId: item.id });
    try {
      const provider = await getProviderFor(platform);
      if (!provider.replyToInboxItem) {
        logger.error(
          { platform },
          "[Inbox] Provider cannot reply to inbox items"
        );
        set({ replyingId: null });
        return false;
      }
      const allowed = await canReplyToKind(provider, platform, item.kind);
      if (!allowed) {
        logger.error(
          { platform, kind: item.kind },
          "[Inbox] Replying is not supported for this item"
        );
        set({ replyingId: null });
        return false;
      }
      const result = await provider.replyToInboxItem(
        {
          externalId: item.externalId,
          platform,
          kind: item.kind,
          author: item.author,
          text: item.text,
          permalink: item.permalink ?? undefined,
          receivedAt: item.receivedAt,
        },
        body
      );
      if (!result.ok) {
        logger.error({ error: result.error }, "[Inbox] Reply failed");
        set({ replyingId: null });
        return false;
      }
      await markInboxItemReplied(item.id);
      set((state) => ({
        replyingId: null,
        items: state.items.map((i) =>
          i.id === item.id ? { ...i, replied: 1 } : i
        ),
      }));
      return true;
    } catch (error) {
      logger.error({ err: error, itemId: item.id }, "[Inbox] Reply threw");
      set({ replyingId: null });
      return false;
    }
  },
}));
