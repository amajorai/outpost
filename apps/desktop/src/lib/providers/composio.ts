/**
 * `PlatformProvider` backed by Composio (https://composio.dev).
 *
 * Composio brokers OAuth connections and tool execution for many SaaS apps,
 * including the social platforms Outpost targets. The user supplies their own
 * Composio API key (BYO), which we store via the encrypted `secure_storage`
 * Tauri commands under `composio_api_key` and never persist anywhere else.
 *
 * The HTTP calls here are intentionally thin and structured around Composio's
 * documented v3 request/response shapes. Where a live key is required to verify
 * exact field names (tool slugs, response envelopes), the code is marked with
 * `TODO(composio-live)` so it is easy to find and finish against a real key.
 */

import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger";
import {
  type EngagementCounts,
  emptyCapabilities,
  type Platform,
  type PlatformCapabilities,
  type PlatformProvider,
  type ProviderAccount,
  type ProviderInboxItem,
  type ProviderInboxKind,
  type PublishResult,
  type PublishTarget,
  type RemotePostRef,
} from "./types";

/** secure_storage key under which the BYO Composio API key is stored. */
export const COMPOSIO_API_KEY_NAME = "composio_api_key";

/** Composio API base. The v3 REST surface is documented at backend.composio.dev. */
const COMPOSIO_API_BASE = "https://backend.composio.dev/api/v3";

/**
 * Composio "toolkit" slug for each Outpost platform. These are the app/toolkit
 * identifiers Composio uses to namespace tools and connections.
 *
 * TODO(composio-live): confirm each slug against the live `/toolkits` list —
 * some platforms may expose multiple toolkits (e.g. a Facebook Pages vs.
 * personal toolkit) and the exact slug casing must match.
 */
const TOOLKIT_BY_PLATFORM: Record<Platform, string> = {
  x: "twitter",
  instagram: "instagram",
  tiktok: "tiktok",
  youtube: "youtube",
  linkedin: "linkedin",
  reddit: "reddit",
  facebook: "facebook",
  bluesky: "bluesky",
  threads: "threads",
};

/** Store the user's Composio API key in encrypted secure storage. */
export async function storeComposioApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) {
    throw new Error("Composio API key cannot be empty");
  }
  await invoke("secure_storage_store", {
    key: COMPOSIO_API_KEY_NAME,
    value: trimmed,
  });
}

/** Retrieve the stored Composio API key, or null when none is set. */
export function getComposioApiKey(): Promise<string | null> {
  return invoke<string | null>("secure_storage_retrieve", {
    key: COMPOSIO_API_KEY_NAME,
  });
}

/** Remove the stored Composio API key. Returns true when a key was removed. */
export function removeComposioApiKey(): Promise<boolean> {
  return invoke<boolean>("secure_storage_remove_encrypted", {
    key: COMPOSIO_API_KEY_NAME,
  });
}

/** Whether a Composio API key is currently configured. */
export function hasComposioApiKey(): Promise<boolean> {
  return invoke<boolean>("secure_storage_exists", {
    key: COMPOSIO_API_KEY_NAME,
  });
}

interface ComposioRequestInit {
  method?: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
}

export class ComposioProvider implements PlatformProvider {
  readonly id = "composio" as const;

  private readonly apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("ComposioProvider requires a non-empty API key");
    }
    this.apiKey = apiKey;
  }

  /**
   * Construct a provider from the stored key, or null when no key is set so the
   * registry can fall back to the fake provider.
   */
  static async fromStoredKey(): Promise<ComposioProvider | null> {
    const key = await getComposioApiKey();
    return key ? new ComposioProvider(key) : null;
  }

  private async request<T>({
    method = "GET",
    path,
    body,
  }: ComposioRequestInit): Promise<T> {
    const response = await fetch(`${COMPOSIO_API_BASE}${path}`, {
      method,
      headers: {
        "x-api-key": this.apiKey,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Composio ${method} ${path} failed: ${response.status} ${detail}`.trim()
      );
    }

    return (await response.json()) as T;
  }

  /**
   * Composio connections are established via a hosted OAuth flow. Here we kick
   * off an authorized connection request for the account's toolkit.
   *
   * TODO(composio-live): the real flow returns a `redirectUrl` the user must
   * visit to grant access; Outpost should open it and poll the connection
   * status. The exact `/connected_accounts` request body (auth config id,
   * entity/user id) needs a live key to finalize.
   */
  async connect(account: ProviderAccount): Promise<void> {
    const toolkit = TOOLKIT_BY_PLATFORM[account.platform];
    await this.request<{ id: string; redirectUrl?: string }>({
      method: "POST",
      path: "/connected_accounts",
      body: {
        toolkit,
        // TODO(composio-live): map Outpost account.id to a Composio user/entity id.
        userId: account.id,
      },
    });
  }

  /** Delete the Composio connected account for this Outpost account. */
  async disconnect(account: ProviderAccount): Promise<void> {
    const externalId = account.externalId;
    if (!externalId) {
      // Nothing remote to tear down.
      return;
    }
    await this.request<unknown>({
      method: "DELETE",
      path: `/connected_accounts/${encodeURIComponent(externalId)}`,
    });
  }

  /**
   * Publish via Composio tool execution. Each platform exposes a "create post"
   * tool; we execute it with the post arguments.
   *
   * TODO(composio-live): the tool slug (e.g. `TWITTER_CREATION_OF_A_POST`) and
   * its argument schema differ per platform and must be confirmed against the
   * live `/tools` catalog. Media upload may require a separate upload tool.
   */
  async publish(target: PublishTarget): Promise<PublishResult> {
    const toolkit = TOOLKIT_BY_PLATFORM[target.account.platform];
    try {
      const result = await this.request<{
        successful?: boolean;
        error?: string | null;
        data?: { id?: string; url?: string; permalink?: string };
      }>({
        method: "POST",
        path: "/tools/execute",
        body: {
          // TODO(composio-live): replace with the platform-specific post tool slug.
          toolSlug: `${toolkit.toUpperCase()}_CREATE_POST`,
          connectedAccountId: target.account.externalId,
          arguments: {
            text: target.text,
            media: target.media?.map((m) => m.url) ?? [],
          },
        },
      });

      if (result.successful === false || result.error) {
        return { ok: false, error: result.error ?? "Composio publish failed" };
      }

      const remoteId = result.data?.id;
      if (!remoteId) {
        return { ok: false, error: "Composio publish returned no post id" };
      }
      return {
        ok: true,
        remoteId,
        remoteUrl: result.data?.url ?? result.data?.permalink,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error }, "[Composio] publish failed");
      return { ok: false, error: message };
    }
  }

  /**
   * Read engagement counts by executing a per-platform "get post" / analytics
   * tool.
   *
   * TODO(composio-live): confirm the analytics tool slug and which metric
   * fields each platform returns (some expose `like_count`, others `favorites`).
   */
  async readEngagement(ref: RemotePostRef): Promise<EngagementCounts> {
    const toolkit = TOOLKIT_BY_PLATFORM[ref.platform];
    const result = await this.request<{
      data?: {
        like_count?: number;
        reply_count?: number;
        comment_count?: number;
        share_count?: number;
        retweet_count?: number;
        view_count?: number;
        impression_count?: number;
      };
    }>({
      method: "POST",
      path: "/tools/execute",
      body: {
        // TODO(composio-live): replace with the platform-specific lookup tool slug.
        toolSlug: `${toolkit.toUpperCase()}_GET_POST`,
        arguments: { postId: ref.remoteId },
      },
    });

    const data = result.data ?? {};
    return {
      likes: data.like_count,
      comments: data.comment_count ?? data.reply_count,
      shares: data.share_count ?? data.retweet_count,
      views: data.view_count ?? data.impression_count,
      fetchedAt: Date.now(),
    };
  }

  /**
   * Resolve real capabilities for a platform by inspecting which tools the
   * toolkit exposes. We fetch the toolkit's tool list and map well-known tool
   * categories onto the capability flags.
   *
   * TODO(composio-live): the precise tool slugs/tags per toolkit need a live
   * key to enumerate; until then we infer from substring matches on tool
   * slugs, which is a best-effort heuristic.
   */
  async capabilities(platform: Platform): Promise<PlatformCapabilities> {
    const toolkit = TOOLKIT_BY_PLATFORM[platform];
    try {
      const result = await this.request<{
        items?: { slug?: string }[];
      }>({
        method: "GET",
        path: `/tools?toolkit_slug=${encodeURIComponent(toolkit)}&limit=200`,
      });

      const slugs = (result.items ?? [])
        .map((tool) => tool.slug?.toLowerCase() ?? "")
        .filter(Boolean);

      const some = (needle: string) => slugs.some((s) => s.includes(needle));

      return {
        publish: some("post") || some("create") || some("tweet"),
        readComments: some("comment") || some("repl"),
        readDMs: some("message") && some("get"),
        sendDM: some("message") && (some("send") || some("create")),
        readEngagement: some("metric") || some("analytic") || some("insight"),
        // Outpost always schedules locally; never delegated to Composio.
        schedule: false,
      };
    } catch (error) {
      logger.error(
        { err: error },
        `[Composio] capabilities lookup failed for ${platform}`
      );
      return emptyCapabilities();
    }
  }

  /**
   * Read the engagement inbox (comments/replies/mentions, plus DMs where the
   * toolkit supports them) for one account by executing the toolkit's
   * "list comments" / "list mentions" / "list messages" tools.
   *
   * TODO(composio-live): the exact tool slugs and response shapes differ per
   * toolkit and must be confirmed against the live `/tools` catalog. The mapping
   * below assumes a `data.items[]` envelope with id/author/text/created_at/url
   * fields; adjust field names once a real key is available.
   */
  async readInbox(account: ProviderAccount): Promise<ProviderInboxItem[]> {
    const toolkit = TOOLKIT_BY_PLATFORM[account.platform];
    const caps = await this.capabilities(account.platform);
    const tools: { slug: string; kind: ProviderInboxKind }[] = [];
    if (caps.readComments) {
      tools.push(
        { slug: `${toolkit.toUpperCase()}_LIST_COMMENTS`, kind: "comment" },
        { slug: `${toolkit.toUpperCase()}_LIST_MENTIONS`, kind: "mention" }
      );
    }
    if (caps.readDMs) {
      tools.push({
        slug: `${toolkit.toUpperCase()}_LIST_MESSAGES`,
        kind: "dm",
      });
    }
    if (tools.length === 0) {
      return [];
    }

    const items: ProviderInboxItem[] = [];
    for (const tool of tools) {
      try {
        const result = await this.request<{
          data?: {
            items?: {
              id?: string;
              author?: string;
              username?: string;
              text?: string;
              body?: string;
              url?: string;
              permalink?: string;
              created_at?: number | string;
            }[];
          };
        }>({
          method: "POST",
          path: "/tools/execute",
          body: {
            toolSlug: tool.slug,
            connectedAccountId: account.externalId,
            arguments: {},
          },
        });

        for (const raw of result.data?.items ?? []) {
          if (!raw.id) {
            continue;
          }
          items.push({
            externalId: raw.id,
            platform: account.platform,
            kind: tool.kind,
            author: raw.author ?? raw.username ?? "unknown",
            text: raw.text ?? raw.body ?? "",
            permalink: raw.url ?? raw.permalink,
            receivedAt:
              typeof raw.created_at === "number"
                ? raw.created_at
                : Date.parse(String(raw.created_at ?? "")) || Date.now(),
          });
        }
      } catch (error) {
        logger.error(
          { err: error },
          `[Composio] readInbox tool ${tool.slug} failed`
        );
      }
    }
    return items;
  }

  /**
   * Reply to an inbox item by executing the toolkit's reply / send-message tool.
   *
   * TODO(composio-live): the reply tool slug and its argument schema (whether it
   * takes the parent comment id vs a conversation id for DMs) must be confirmed
   * against the live catalog.
   */
  async replyToInboxItem(
    item: ProviderInboxItem,
    text: string
  ): Promise<PublishResult> {
    const toolkit = TOOLKIT_BY_PLATFORM[item.platform];
    const slug =
      item.kind === "dm"
        ? `${toolkit.toUpperCase()}_SEND_MESSAGE`
        : `${toolkit.toUpperCase()}_REPLY_TO_COMMENT`;
    try {
      const result = await this.request<{
        successful?: boolean;
        error?: string | null;
        data?: { id?: string; url?: string; permalink?: string };
      }>({
        method: "POST",
        path: "/tools/execute",
        body: {
          toolSlug: slug,
          arguments: { parentId: item.externalId, text },
        },
      });

      if (result.successful === false || result.error) {
        return { ok: false, error: result.error ?? "Composio reply failed" };
      }
      const remoteId = result.data?.id;
      if (!remoteId) {
        return { ok: false, error: "Composio reply returned no id" };
      }
      return {
        ok: true,
        remoteId,
        remoteUrl: result.data?.url ?? result.data?.permalink,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error }, "[Composio] replyToInboxItem failed");
      return { ok: false, error: message };
    }
  }
}
