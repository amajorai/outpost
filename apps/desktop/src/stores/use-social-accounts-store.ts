/**
 * Store for connected social accounts (U5).
 *
 * Orchestrates the connect/disconnect flow through the active `PlatformProvider`
 * and persists the result to the `social_accounts` table. The provider owns
 * OAuth tokens; this store and the table only ever hold the account identity and
 * a connected flag — never a raw token.
 *
 * Connect = generate an id, `provider.connect()`, then persist the row on
 * success (so a failed connect persists nothing). Disconnect =
 * `provider.disconnect()`, then remove the row.
 */

import { create } from "zustand";
import { logger } from "@/lib/logger";
import {
  getActiveProvider,
  type Platform,
  type ProviderAccount,
} from "@/lib/providers";
import {
  createSocialAccount,
  listSocialAccounts,
  removeSocialAccount,
} from "@/lib/repos/social-accounts";
import type { SocialAccount } from "@/lib/social-schema";

/**
 * Platforms U5 lets users connect. A subset of the full provider `Platform`
 * union: bluesky and threads are out of scope for this unit.
 */
export const SUPPORTED_PLATFORMS: readonly Platform[] = [
  "x",
  "instagram",
  "tiktok",
  "youtube",
  "linkedin",
  "reddit",
  "facebook",
] as const;

interface SocialAccountsState {
  accounts: SocialAccount[];
  /** True while the initial list load is in flight. */
  isLoading: boolean;
  /** Account id currently being disconnected, for per-row button state. */
  disconnectingId: string | null;
  /** Platform currently being connected, for per-platform button state. */
  connectingPlatform: Platform | null;

  /** Load all accounts for the default workspace. */
  refresh: () => Promise<void>;
  /**
   * Connect a new account: provider.connect() then persist on success. Throws
   * on failure so the caller can surface the error.
   */
  connect: (platform: Platform, accountLabel: string) => Promise<void>;
  /** Disconnect and remove an account. Throws on failure. */
  disconnect: (account: SocialAccount) => Promise<void>;
}

function toProviderAccount(
  id: string,
  platform: Platform,
  label: string,
  externalId: string | null
): ProviderAccount {
  return { id, platform, label, externalId };
}

export const useSocialAccountsStore = create<SocialAccountsState>()((set) => ({
  accounts: [],
  isLoading: false,
  disconnectingId: null,
  connectingPlatform: null,

  refresh: async () => {
    set({ isLoading: true });
    try {
      const accounts = await listSocialAccounts();
      set({ accounts, isLoading: false });
    } catch (error) {
      logger.error({ err: error }, "[SocialAccounts] Failed to load accounts");
      set({ isLoading: false });
    }
  },

  connect: async (platform, accountLabel) => {
    const label = accountLabel.trim();
    if (!label) {
      throw new Error("An account label is required");
    }
    set({ connectingPlatform: platform });
    try {
      const provider = await getActiveProvider();
      const id = crypto.randomUUID();
      await provider.connect(toProviderAccount(id, platform, label, null));
      const account = await createSocialAccount({
        id,
        platform,
        accountLabel: label,
      });
      set((state) => ({
        accounts: [account, ...state.accounts],
        connectingPlatform: null,
      }));
    } catch (error) {
      logger.error(
        { err: error, platform },
        "[SocialAccounts] Failed to connect account"
      );
      set({ connectingPlatform: null });
      throw error;
    }
  },

  disconnect: async (account) => {
    set({ disconnectingId: account.id });
    try {
      const provider = await getActiveProvider();
      await provider.disconnect(
        toProviderAccount(
          account.id,
          account.platform as Platform,
          account.accountLabel,
          account.externalId
        )
      );
      await removeSocialAccount(account.id);
      set((state) => ({
        accounts: state.accounts.filter((a) => a.id !== account.id),
        disconnectingId: null,
      }));
    } catch (error) {
      logger.error(
        { err: error, accountId: account.id },
        "[SocialAccounts] Failed to disconnect account"
      );
      set({ disconnectingId: null });
      throw error;
    }
  },
}));
