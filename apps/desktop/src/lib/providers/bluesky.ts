/**
 * Direct `PlatformProvider` for Bluesky via the AT Protocol (U6).
 *
 * Unlike `ComposioProvider`, which brokers many platforms through one hosted
 * API, this talks to Bluesky's XRPC endpoints directly with a BYO app password.
 * The user supplies their handle and an app password (Settings -> App
 * passwords), which we store via the encrypted `secure_storage` Tauri commands
 * under `bluesky_handle` / `bluesky_app_password` and never persist anywhere
 * else. Session tokens (accessJwt/refreshJwt) live only in memory: we mint them
 * on demand from the stored app password and refresh them as they expire.
 *
 * Transport is a thin `fetch` against the documented XRPC methods rather than
 * `@atproto/api`, to avoid pulling the SDK into the bundle and to keep this file
 * free of heavy dependencies. The shapes used here are from atproto.com:
 *  - com.atproto.server.createSession  -> { accessJwt, refreshJwt, did, handle }
 *  - com.atproto.server.refreshSession -> { accessJwt, refreshJwt, did, handle }
 *  - com.atproto.repo.uploadBlob       -> { blob }
 *  - com.atproto.repo.createRecord     -> { uri, cid }
 *  - app.bsky.feed.getPosts            -> { posts: [{ uri, likeCount, ... }] }
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

/** secure_storage key for the BYO Bluesky handle (e.g. "alice.bsky.social"). */
export const BLUESKY_HANDLE_NAME = "bluesky_handle";
/** secure_storage key for the BYO Bluesky app password (never the main one). */
export const BLUESKY_APP_PASSWORD_NAME = "bluesky_app_password";

/**
 * The user's Personal Data Server. Bluesky's default PDS hosts createSession,
 * createRecord, and uploadBlob. getPosts is an AppView read, served without auth
 * by the public AppView.
 */
const BLUESKY_PDS_BASE = "https://bsky.social";
const BLUESKY_APPVIEW_BASE = "https://public.api.bsky.app";

/** The Bluesky web app, used to build human-friendly post URLs. */
const BLUESKY_WEB_BASE = "https://bsky.app";

/** Matches the parts of an `at://did/collection/rkey` URI. */
const AT_URI_RE = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/;
/** Leading `@` on a handle, stripped before storing. */
const LEADING_AT_RE = /^@/;
/** A remote http(s) media URL, as opposed to a local file path. */
const HTTP_URL_RE = /^https?:\/\//;

/** Refresh the access token this many millis before it would otherwise expire. */
const TOKEN_REFRESH_SKEW_MS = 60_000;
/** Conservative access-token lifetime assumed when we can't read `exp`. */
const ACCESS_TOKEN_TTL_MS = 90 * 60 * 1000; // ~90 minutes

/** Credentials as stored in secure storage. */
export interface BlueskyCredentials {
  handle: string;
  appPassword: string;
}

/** Shape returned by createSession / refreshSession. */
interface SessionResponse {
  accessJwt: string;
  refreshJwt: string;
  did: string;
  handle: string;
}

/** A live, in-memory session. Tokens are never persisted to disk. */
interface ActiveSession extends SessionResponse {
  /** Unix epoch millis after which the access token should be refreshed. */
  accessExpiresAt: number;
}

/** A com.atproto.repo.strongRef: the uri + cid of a created record. Used to
 * chain thread replies (root/parent) in a multi-segment post (U12). */
interface StrongRef {
  uri: string;
  cid: string;
}

/** The `blob` object returned by uploadBlob and embedded into a post record. */
interface BlobRef {
  $type: "blob";
  ref: { $link: string };
  mimeType: string;
  size: number;
}

/** Store the user's Bluesky handle + app password in encrypted secure storage. */
export async function storeBlueskyCredentials(
  handle: string,
  appPassword: string
): Promise<void> {
  const trimmedHandle = handle.trim().replace(LEADING_AT_RE, "");
  const trimmedPassword = appPassword.trim();
  if (!trimmedHandle) {
    throw new Error("Bluesky handle cannot be empty");
  }
  if (!trimmedPassword) {
    throw new Error("Bluesky app password cannot be empty");
  }
  await invoke("secure_storage_store", {
    key: BLUESKY_HANDLE_NAME,
    value: trimmedHandle,
  });
  await invoke("secure_storage_store", {
    key: BLUESKY_APP_PASSWORD_NAME,
    value: trimmedPassword,
  });
}

/** Retrieve the stored Bluesky credentials, or null when not fully configured. */
export async function getBlueskyCredentials(): Promise<BlueskyCredentials | null> {
  const handle = await invoke<string | null>("secure_storage_retrieve", {
    key: BLUESKY_HANDLE_NAME,
  });
  const appPassword = await invoke<string | null>("secure_storage_retrieve", {
    key: BLUESKY_APP_PASSWORD_NAME,
  });
  if (!(handle && appPassword)) {
    return null;
  }
  return { handle, appPassword };
}

/** Remove the stored Bluesky credentials. Returns true when anything was removed. */
export async function removeBlueskyCredentials(): Promise<boolean> {
  const removedHandle = await invoke<boolean>(
    "secure_storage_remove_encrypted",
    {
      key: BLUESKY_HANDLE_NAME,
    }
  );
  const removedPassword = await invoke<boolean>(
    "secure_storage_remove_encrypted",
    { key: BLUESKY_APP_PASSWORD_NAME }
  );
  return removedHandle || removedPassword;
}

/** Whether both Bluesky credentials are currently configured. */
export async function hasBlueskyCredentials(): Promise<boolean> {
  const handle = await invoke<boolean>("secure_storage_exists", {
    key: BLUESKY_HANDLE_NAME,
  });
  const appPassword = await invoke<boolean>("secure_storage_exists", {
    key: BLUESKY_APP_PASSWORD_NAME,
  });
  return handle && appPassword;
}

/** Read the `at://did/collection/rkey` parts out of an at-uri. */
function parseAtUri(
  uri: string
): { did: string; collection: string; rkey: string } | null {
  const match = AT_URI_RE.exec(uri);
  if (!match) {
    return null;
  }
  return { did: match[1], collection: match[2], rkey: match[3] };
}

/** Decode a JWT's `exp` claim (seconds) without verifying the signature. */
function readJwtExpiryMs(jwt: string): number | null {
  const parts = jwt.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(payload)) as { exp?: number };
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Bluesky provider. Holds at most one in-memory session, lazily created from the
 * stored app password and refreshed as it nears expiry. Safe to construct
 * without network (no I/O in the constructor).
 */
export class BlueskyProvider implements PlatformProvider {
  readonly id = "bluesky" as const;

  private readonly credentials: BlueskyCredentials;
  private session: ActiveSession | null = null;
  /** Coalesces concurrent session creation/refresh into a single request. */
  private sessionPromise: Promise<ActiveSession> | null = null;

  constructor(credentials: BlueskyCredentials) {
    if (!(credentials.handle && credentials.appPassword)) {
      throw new Error("BlueskyProvider requires a handle and an app password");
    }
    this.credentials = credentials;
  }

  /**
   * Build a provider from stored credentials, or null when not configured so
   * the registry can fall back to the active provider.
   */
  static async fromStoredCredentials(): Promise<BlueskyProvider | null> {
    const credentials = await getBlueskyCredentials();
    return credentials ? new BlueskyProvider(credentials) : null;
  }

  /** Build an `ActiveSession` from a raw session response, deriving expiry. */
  private static toActiveSession(raw: SessionResponse): ActiveSession {
    const expFromJwt = readJwtExpiryMs(raw.accessJwt);
    const accessExpiresAt =
      (expFromJwt ?? Date.now() + ACCESS_TOKEN_TTL_MS) - TOKEN_REFRESH_SKEW_MS;
    return { ...raw, accessExpiresAt };
  }

  /** POST a JSON XRPC procedure against a given base, returning parsed JSON. */
  private async xrpcJson<T>(
    base: string,
    nsid: string,
    body: unknown,
    bearer?: string
  ): Promise<T> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (bearer) {
      headers.authorization = `Bearer ${bearer}`;
    }
    const response = await fetch(`${base}/xrpc/${nsid}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Bluesky ${nsid} failed: ${response.status} ${detail}`.trim()
      );
    }
    return (await response.json()) as T;
  }

  /** GET a JSON XRPC query against a given base, returning parsed JSON. */
  private async xrpcGet<T>(base: string, nsidWithQuery: string): Promise<T> {
    const response = await fetch(`${base}/xrpc/${nsidWithQuery}`);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Bluesky ${nsidWithQuery} failed: ${response.status} ${detail}`.trim()
      );
    }
    return (await response.json()) as T;
  }

  /** Create a brand-new session from the stored app password. */
  private async createSession(): Promise<ActiveSession> {
    const raw = await this.xrpcJson<SessionResponse>(
      BLUESKY_PDS_BASE,
      "com.atproto.server.createSession",
      {
        identifier: this.credentials.handle,
        password: this.credentials.appPassword,
      }
    );
    return BlueskyProvider.toActiveSession(raw);
  }

  /**
   * Refresh using the refreshJwt as bearer (a common gotcha: refresh uses the
   * refresh token, not the access token). Falls back to a fresh createSession
   * if the refresh token has itself expired.
   */
  private async refreshSession(refreshJwt: string): Promise<ActiveSession> {
    try {
      const raw = await this.xrpcJson<SessionResponse>(
        BLUESKY_PDS_BASE,
        "com.atproto.server.refreshSession",
        {},
        refreshJwt
      );
      return BlueskyProvider.toActiveSession(raw);
    } catch (error) {
      logger.warn(
        { err: error },
        "[Bluesky] refreshSession failed, recreating session"
      );
      return this.createSession();
    }
  }

  /** Return a valid session, creating or refreshing as needed. */
  private ensureSession(): Promise<ActiveSession> {
    const current = this.session;
    if (current && Date.now() < current.accessExpiresAt) {
      return Promise.resolve(current);
    }
    if (this.sessionPromise) {
      return this.sessionPromise;
    }
    const work = (
      current ? this.refreshSession(current.refreshJwt) : this.createSession()
    )
      .then((session) => {
        this.session = session;
        this.sessionPromise = null;
        return session;
      })
      .catch((error) => {
        this.sessionPromise = null;
        throw error;
      });
    this.sessionPromise = work;
    return work;
  }

  /** Verify the credentials by minting a session. Throws on bad credentials. */
  async connect(_account: ProviderAccount): Promise<void> {
    await this.ensureSession();
  }

  /** Drop the in-memory session. Stored credentials are untouched. */
  disconnect(_account: ProviderAccount): Promise<void> {
    this.session = null;
    this.sessionPromise = null;
    return Promise.resolve();
  }

  /**
   * Fetch the bytes for a single media item (remote URL or local file path) as
   * an `ArrayBuffer`, the canonical body type uploadBlob sends.
   */
  private async readMediaBytes(media: PublishMedia): Promise<ArrayBuffer> {
    if (HTTP_URL_RE.test(media.url)) {
      const response = await fetch(media.url);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch media ${media.url}: ${response.status}`
        );
      }
      return await response.arrayBuffer();
    }
    // Local file path: read via the Tauri fs plugin, then copy into a fresh
    // ArrayBuffer so the body type is unambiguous across TS lib versions.
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const bytes = await readFile(media.url);
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
  }

  /** Upload one media item as a blob and return the embeddable blob ref. */
  private async uploadBlob(
    session: ActiveSession,
    media: PublishMedia
  ): Promise<BlobRef> {
    const bytes = await this.readMediaBytes(media);
    const response = await fetch(
      `${BLUESKY_PDS_BASE}/xrpc/com.atproto.repo.uploadBlob`,
      {
        method: "POST",
        headers: {
          "content-type": media.mimeType,
          authorization: `Bearer ${session.accessJwt}`,
        },
        body: bytes,
      }
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Bluesky uploadBlob failed: ${response.status} ${detail}`.trim()
      );
    }
    const json = (await response.json()) as { blob: BlobRef };
    return json.blob;
  }

  /** Build the `app.bsky.embed.images` embed from uploaded media, if any. */
  private async buildImageEmbed(
    session: ActiveSession,
    media: PublishMedia[] | undefined
  ): Promise<Record<string, unknown> | undefined> {
    const images = (media ?? []).filter((m) => m.mimeType.startsWith("image/"));
    if (images.length === 0) {
      return undefined;
    }
    const uploaded = await Promise.all(
      images.map(async (m) => ({
        alt: m.altText ?? "",
        image: await this.uploadBlob(session, m),
      }))
    );
    return { $type: "app.bsky.embed.images", images: uploaded };
  }

  /**
   * Create a single feed post record (text + optional images), optionally as a
   * reply chained to a root + parent. Returns the new post's strong ref.
   */
  private async createPostRecord(
    session: ActiveSession,
    segment: { text: string; media?: PublishMedia[] },
    reply?: { root: StrongRef; parent: StrongRef }
  ): Promise<StrongRef> {
    const embed = await this.buildImageEmbed(session, segment.media);
    const record: Record<string, unknown> = {
      $type: "app.bsky.feed.post",
      text: segment.text,
      createdAt: new Date().toISOString(),
    };
    if (embed) {
      record.embed = embed;
    }
    if (reply) {
      record.reply = { root: reply.root, parent: reply.parent };
    }
    const result = await this.xrpcJson<{ uri: string; cid: string }>(
      BLUESKY_PDS_BASE,
      "com.atproto.repo.createRecord",
      {
        repo: session.did,
        collection: "app.bsky.feed.post",
        record,
      },
      session.accessJwt
    );
    return { uri: result.uri, cid: result.cid };
  }

  /**
   * Publish a post via com.atproto.repo.createRecord. When `target.segments`
   * holds more than one segment (U12), publishes them as a Bluesky thread: the
   * first post is the root and each subsequent segment is a reply chained to the
   * previous post. A single-segment target degrades to one post. The returned
   * remote id/url point at the thread root so engagement reads stay stable.
   */
  async publish(target: PublishTarget): Promise<PublishResult> {
    try {
      const session = await this.ensureSession();
      const segments =
        target.segments && target.segments.length > 0
          ? target.segments
          : [{ text: target.text, media: target.media }];

      const root = await this.createPostRecord(session, segments[0]);
      let parent = root;
      for (let i = 1; i < segments.length; i++) {
        parent = await this.createPostRecord(session, segments[i], {
          root,
          parent,
        });
      }

      // remoteId is the root at-uri so readEngagement looks up the thread head.
      const parsed = parseAtUri(root.uri);
      const remoteUrl = parsed
        ? `${BLUESKY_WEB_BASE}/profile/${this.credentials.handle}/post/${parsed.rkey}`
        : undefined;
      return { ok: true, remoteId: root.uri, remoteUrl };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error }, "[Bluesky] publish failed");
      return { ok: false, error: message };
    }
  }

  /** Read like/repost/reply counts for a previously published post. */
  async readEngagement(ref: RemotePostRef): Promise<EngagementCounts> {
    const result = await this.xrpcGet<{
      posts?: {
        uri?: string;
        likeCount?: number;
        repostCount?: number;
        replyCount?: number;
      }[];
    }>(
      BLUESKY_APPVIEW_BASE,
      `app.bsky.feed.getPosts?uris=${encodeURIComponent(ref.remoteId)}`
    );
    const post = result.posts?.[0] ?? {};
    return {
      likes: post.likeCount,
      comments: post.replyCount,
      shares: post.repostCount,
      fetchedAt: Date.now(),
    };
  }

  /**
   * Bluesky's direct adapter publishes and reads engagement. It exposes no DM
   * surface, and (like every provider) never schedules — Outpost schedules
   * locally. Counts are only meaningful for the `bluesky` platform.
   */
  capabilities(platform: Platform): Promise<PlatformCapabilities> {
    if (platform !== "bluesky") {
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
