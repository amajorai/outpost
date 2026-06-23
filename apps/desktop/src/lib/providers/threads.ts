/**
 * Direct `PlatformProvider` for Meta Threads via the Threads Graph API (U7).
 *
 * Like the Bluesky adapter, this talks to Meta's API directly with a BYO
 * (bring-your-own) credential rather than brokering through Composio. The user
 * supplies a long-lived Threads user access token plus their Threads user id
 * (both obtainable from a self-managed Meta app), which we store via the
 * encrypted `secure_storage` Tauri commands under `threads_access_token` /
 * `threads_user_id` and never persist anywhere else.
 *
 * Token model (important, and different from Bluesky): on Threads the *token
 * itself* is the durable credential. Bluesky derives ephemeral sessions from a
 * stored app password; here there is no password to re-mint from, so when we
 * refresh a long-lived token we write the new token (and its expiry) back to
 * secure storage. Refreshing only needs the current token, no client secret:
 *   GET /refresh_access_token?grant_type=th_refresh_token&access_token=...
 * which extends a long-lived token (24h+ old, unexpired) for another ~60 days.
 *
 * Publishing is a documented two-step flow:
 *   1. POST /{user-id}/threads          -> creation_id (a "media container")
 *   2. POST /{user-id}/threads_publish  -> media id (the live post)
 * Media is referenced by a *publicly accessible URL* (`image_url`/`video_url`);
 * Meta's servers fetch it server-side. There is no binary blob upload, so a
 * local file path cannot be published — we reject that explicitly rather than
 * building a request Meta cannot fulfill.
 *
 * Transport is a thin `fetch` against the documented Graph endpoints. Shapes are
 * from developers.facebook.com/docs/threads. Anything not verifiable without a
 * live token is marked `TODO(threads-live)`, mirroring the `TODO(composio-live)`
 * convention used elsewhere in this folder.
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
  type PublishMedia,
  type PublishResult,
  type PublishTarget,
  type RemotePostRef,
} from "./types";

/** secure_storage key for the BYO long-lived Threads user access token. */
export const THREADS_ACCESS_TOKEN_NAME = "threads_access_token";
/** secure_storage key for the BYO Threads user id (the container/publish path). */
export const THREADS_USER_ID_NAME = "threads_user_id";
/** secure_storage key for the cached token expiry (unix epoch millis, as text). */
export const THREADS_TOKEN_EXPIRES_AT_NAME = "threads_token_expires_at";

/** The Threads Graph API base for user/media endpoints. */
const THREADS_GRAPH_BASE = "https://graph.threads.net/v1.0";
/** Host for the (unversioned) token refresh endpoint. */
const THREADS_TOKEN_BASE = "https://graph.threads.net";

/** A remote http(s) media URL, as opposed to a local file path. */
const HTTP_URL_RE = /^https?:\/\//;

/** Refresh the long-lived token once it is within this window of expiring. */
const TOKEN_REFRESH_SKEW_MS = 24 * 60 * 60 * 1000; // 1 day
/** Long-lived token lifetime assumed when the API omits `expires_in`. */
const DEFAULT_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // ~60 days
const MS_PER_SECOND = 1000;

/** Credentials as stored in secure storage. */
export interface ThreadsCredentials {
  accessToken: string;
  userId: string;
}

/** Store the user's Threads token + user id in encrypted secure storage. */
export async function storeThreadsCredentials(
  accessToken: string,
  userId: string
): Promise<void> {
  const trimmedToken = accessToken.trim();
  const trimmedUserId = userId.trim();
  if (!trimmedToken) {
    throw new Error("Threads access token cannot be empty");
  }
  if (!trimmedUserId) {
    throw new Error("Threads user id cannot be empty");
  }
  await invoke("secure_storage_store", {
    key: THREADS_ACCESS_TOKEN_NAME,
    value: trimmedToken,
  });
  await invoke("secure_storage_store", {
    key: THREADS_USER_ID_NAME,
    value: trimmedUserId,
  });
  // Persist an assumed expiry once, at store time, so the proactive refresh in
  // `ensureToken` actually fires before Meta's real ~60-day expiry. Defaulting
  // this at construction instead would push expiry forward on every restart and
  // a regularly-restarted app would never refresh.
  const expiresAt = Date.now() + DEFAULT_TOKEN_TTL_MS;
  await invoke("secure_storage_store", {
    key: THREADS_TOKEN_EXPIRES_AT_NAME,
    value: String(expiresAt),
  }).catch(() => {
    /* expiry cache is best-effort */
  });
}

/** Retrieve the stored Threads credentials, or null when not fully configured. */
export async function getThreadsCredentials(): Promise<ThreadsCredentials | null> {
  const accessToken = await invoke<string | null>("secure_storage_retrieve", {
    key: THREADS_ACCESS_TOKEN_NAME,
  });
  const userId = await invoke<string | null>("secure_storage_retrieve", {
    key: THREADS_USER_ID_NAME,
  });
  if (!(accessToken && userId)) {
    return null;
  }
  return { accessToken, userId };
}

/** Remove the stored Threads credentials. Returns true when anything was removed. */
export async function removeThreadsCredentials(): Promise<boolean> {
  const removedToken = await invoke<boolean>(
    "secure_storage_remove_encrypted",
    {
      key: THREADS_ACCESS_TOKEN_NAME,
    }
  );
  const removedUserId = await invoke<boolean>(
    "secure_storage_remove_encrypted",
    { key: THREADS_USER_ID_NAME }
  );
  await invoke<boolean>("secure_storage_remove_encrypted", {
    key: THREADS_TOKEN_EXPIRES_AT_NAME,
  }).catch(() => false);
  return removedToken || removedUserId;
}

/** Whether both Threads credentials are currently configured. */
export async function hasThreadsCredentials(): Promise<boolean> {
  const accessToken = await invoke<boolean>("secure_storage_exists", {
    key: THREADS_ACCESS_TOKEN_NAME,
  });
  const userId = await invoke<boolean>("secure_storage_exists", {
    key: THREADS_USER_ID_NAME,
  });
  return accessToken && userId;
}

/** Determine which `media_type` to declare for a container given the media. */
function mediaTypeFor(media: PublishMedia[] | undefined): {
  mediaType: "TEXT" | "IMAGE" | "VIDEO";
  primary?: PublishMedia;
} {
  const first = media?.[0];
  if (!first) {
    return { mediaType: "TEXT" };
  }
  if (first.mimeType.startsWith("video/")) {
    return { mediaType: "VIDEO", primary: first };
  }
  return { mediaType: "IMAGE", primary: first };
}

/** Shape of the token refresh response. */
interface RefreshTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

/** A single metric entry in an insights response. */
interface InsightValue {
  name?: string;
  values?: { value?: number }[];
  total_value?: { value?: number };
}

/**
 * Threads provider. Holds the credential in memory after loading it from secure
 * storage, refreshing the long-lived token (and persisting the refreshed value)
 * as it nears expiry. Safe to construct without network (no I/O in the
 * constructor), mirroring the other direct adapters.
 */
export class ThreadsProvider implements PlatformProvider {
  readonly id = "threads" as const;

  private accessToken: string;
  private readonly userId: string;
  /** Cached token expiry (unix epoch millis); null until known. */
  private tokenExpiresAt: number | null;
  /** Coalesces concurrent refreshes into a single request. */
  private refreshPromise: Promise<string> | null = null;

  constructor(credentials: ThreadsCredentials, tokenExpiresAt?: number | null) {
    if (!(credentials.accessToken && credentials.userId)) {
      throw new Error("ThreadsProvider requires an access token and user id");
    }
    this.accessToken = credentials.accessToken;
    this.userId = credentials.userId;
    this.tokenExpiresAt = tokenExpiresAt ?? null;
  }

  /**
   * Build a provider from stored credentials, or null when not configured so
   * the registry can fall back to the active provider.
   */
  static async fromStoredCredentials(): Promise<ThreadsProvider | null> {
    const credentials = await getThreadsCredentials();
    if (!credentials) {
      return null;
    }
    const storedExpiry = await invoke<string | null>(
      "secure_storage_retrieve",
      { key: THREADS_TOKEN_EXPIRES_AT_NAME }
    ).catch(() => null);
    const expiresAt = storedExpiry ? Number(storedExpiry) : null;
    return new ThreadsProvider(
      credentials,
      Number.isFinite(expiresAt) ? expiresAt : null
    );
  }

  /** Build a `graph.threads.net/v1.0/{path}` URL with query params. */
  private graphUrl(path: string, params: Record<string, string>): string {
    const url = new URL(`${THREADS_GRAPH_BASE}/${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  /** GET a Graph endpoint as JSON, throwing a descriptive error on failure. */
  private async graphGet<T>(
    path: string,
    params: Record<string, string>
  ): Promise<T> {
    const token = await this.ensureToken();
    const url = this.graphUrl(path, { ...params, access_token: token });
    const response = await fetch(url);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Threads GET ${path} failed: ${response.status} ${detail}`.trim()
      );
    }
    return (await response.json()) as T;
  }

  /** POST a Graph endpoint with form params as JSON, throwing on failure. */
  private async graphPost<T>(
    path: string,
    params: Record<string, string>
  ): Promise<T> {
    const token = await this.ensureToken();
    const body = new URLSearchParams({ ...params, access_token: token });
    const response = await fetch(`${THREADS_GRAPH_BASE}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Threads POST ${path} failed: ${response.status} ${detail}`.trim()
      );
    }
    return (await response.json()) as T;
  }

  /**
   * Refresh the long-lived token and persist the new value + expiry. Only the
   * current token is needed (no client secret), which keeps this BYOK-friendly.
   */
  private async refreshToken(): Promise<string> {
    const url = new URL(`${THREADS_TOKEN_BASE}/refresh_access_token`);
    url.searchParams.set("grant_type", "th_refresh_token");
    url.searchParams.set("access_token", this.accessToken);
    const response = await fetch(url.toString());
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Threads token refresh failed: ${response.status} ${detail}`.trim()
      );
    }
    const json = (await response.json()) as RefreshTokenResponse;
    if (!json.access_token) {
      throw new Error("Threads token refresh returned no access_token");
    }
    this.accessToken = json.access_token;
    const ttlMs = json.expires_in
      ? json.expires_in * MS_PER_SECOND
      : DEFAULT_TOKEN_TTL_MS;
    this.tokenExpiresAt = Date.now() + ttlMs;
    await invoke("secure_storage_store", {
      key: THREADS_ACCESS_TOKEN_NAME,
      value: this.accessToken,
    });
    await invoke("secure_storage_store", {
      key: THREADS_TOKEN_EXPIRES_AT_NAME,
      value: String(this.tokenExpiresAt),
    }).catch(() => {
      /* expiry cache is best-effort */
    });
    return this.accessToken;
  }

  /**
   * Return a usable access token, refreshing it first when it is within
   * `TOKEN_REFRESH_SKEW_MS` of expiring. The expiry is seeded once at store time
   * (`storeThreadsCredentials`) and re-derived on every refresh, so the proactive
   * path fires roughly a day before Meta's real ~60-day expiry. When the expiry
   * is unknown (legacy storage without the cached timestamp) the token is used
   * as-is; the next `storeThreadsCredentials` will seed it.
   */
  private ensureToken(): Promise<string> {
    const expiry = this.tokenExpiresAt;
    const needsRefresh =
      expiry != null && Date.now() >= expiry - TOKEN_REFRESH_SKEW_MS;
    if (!needsRefresh) {
      return Promise.resolve(this.accessToken);
    }
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    const work = this.refreshToken()
      .then((token) => {
        this.refreshPromise = null;
        return token;
      })
      .catch((error) => {
        this.refreshPromise = null;
        logger.warn(
          { err: error },
          "[Threads] token refresh failed, using existing token"
        );
        return this.accessToken;
      });
    this.refreshPromise = work;
    return work;
  }

  /** Verify the credentials by reading the user profile. Throws on bad token. */
  async connect(_account: ProviderAccount): Promise<void> {
    await this.graphGet<{ id: string; username?: string }>(this.userId, {
      fields: "id,username",
    });
  }

  /** Drop any in-flight refresh. Stored credentials are untouched. */
  disconnect(_account: ProviderAccount): Promise<void> {
    this.refreshPromise = null;
    return Promise.resolve();
  }

  /**
   * Create a media container, then publish it. Text-only and single-image/video
   * posts are supported; media must be a publicly reachable URL (Meta fetches it
   * server-side). Carousels and async video-status polling are deferred.
   */
  async publish(target: PublishTarget): Promise<PublishResult> {
    try {
      const { mediaType, primary } = mediaTypeFor(target.media);

      // Carousels are deferred (see class doc). Reject multi-media targets
      // explicitly rather than silently publishing only the first item.
      if ((target.media?.length ?? 0) > 1) {
        return {
          ok: false,
          error:
            "Threads carousels are not supported yet; publish a single image, video, or text post",
        };
      }

      if (primary && !HTTP_URL_RE.test(primary.url)) {
        return {
          ok: false,
          error:
            "Threads can only publish media from a public URL; local files are not supported",
        };
      }

      const containerParams: Record<string, string> = {
        media_type: mediaType,
      };
      if (target.text) {
        containerParams.text = target.text;
      }
      if (primary && mediaType === "IMAGE") {
        containerParams.image_url = primary.url;
        if (primary.altText) {
          containerParams.alt_text = primary.altText;
        }
      }
      if (primary && mediaType === "VIDEO") {
        containerParams.video_url = primary.url;
        if (primary.altText) {
          containerParams.alt_text = primary.altText;
        }
      }

      // Step 1: create the container.
      const container = await this.graphPost<{ id: string }>(
        `${this.userId}/threads`,
        containerParams
      );
      if (!container.id) {
        return { ok: false, error: "Threads create-container returned no id" };
      }

      // TODO(threads-live): VIDEO containers may process asynchronously; poll
      // GET /{container-id}?fields=status until FINISHED before publishing.

      // Step 2: publish the container.
      const published = await this.graphPost<{ id: string }>(
        `${this.userId}/threads_publish`,
        { creation_id: container.id }
      );
      if (!published.id) {
        return { ok: false, error: "Threads publish returned no id" };
      }

      const remoteUrl = await this.fetchPermalink(published.id);
      return { ok: true, remoteId: published.id, remoteUrl };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error }, "[Threads] publish failed");
      return { ok: false, error: message };
    }
  }

  /** Best-effort lookup of a published post's permalink. */
  private async fetchPermalink(mediaId: string): Promise<string | undefined> {
    try {
      const result = await this.graphGet<{ permalink?: string }>(mediaId, {
        fields: "permalink",
      });
      return result.permalink;
    } catch (error) {
      logger.warn({ err: error }, "[Threads] permalink lookup failed");
      return undefined;
    }
  }

  /**
   * Read engagement metrics for a previously published post via insights.
   *
   * TODO(threads-live): the `metric` names (views/likes/replies/reposts/quotes)
   * match the documented media insights but are not verified against a live
   * token; an unsupported name makes the whole call error, leaving only
   * `fetchedAt`. Confirm the exact metric list and adjust if Meta rejects any.
   */
  async readEngagement(ref: RemotePostRef): Promise<EngagementCounts> {
    const result = await this.graphGet<{ data?: InsightValue[] }>(
      `${ref.remoteId}/insights`,
      { metric: "views,likes,replies,reposts,quotes" }
    );
    const counts: EngagementCounts = { fetchedAt: Date.now() };
    for (const entry of result.data ?? []) {
      const value = entry.values?.[0]?.value ?? entry.total_value?.value;
      if (value == null) {
        continue;
      }
      switch (entry.name) {
        case "views":
          counts.views = value;
          break;
        case "likes":
          counts.likes = value;
          break;
        case "replies":
          counts.comments = value;
          break;
        case "reposts":
        case "quotes":
          counts.shares = (counts.shares ?? 0) + value;
          break;
        default:
          break;
      }
    }
    return counts;
  }

  /**
   * Threads' direct adapter publishes and reads engagement. It exposes no DM or
   * comment-read surface here, and (like every provider) never schedules.
   * Capabilities are only meaningful for the `threads` platform.
   */
  capabilities(platform: Platform): Promise<PlatformCapabilities> {
    if (platform !== "threads") {
      return Promise.resolve(emptyCapabilities());
    }
    return Promise.resolve({
      publish: true,
      readComments: false,
      readDMs: false,
      sendDM: false,
      readEngagement: true,
      schedule: false,
    });
  }
}
