/**
 * Provider-agnostic integration core.
 *
 * Outpost talks to social platforms through a single `PlatformProvider`
 * interface so the rest of the app never depends on whether the underlying
 * transport is Composio, a native API, or an in-memory fake. Two
 * implementations ship today: `ComposioProvider` (BYO Composio API key) and
 * `FakePlatformProvider` (deterministic, in-memory, used in tests/dev).
 *
 * The `Platform` union here is the single vocabulary for platform keys. It must
 * stay a superset of the free-form `platform: string` values used in
 * `social-schema.ts` so DTOs never fork the platform names.
 */

/** Every social platform Outpost can target. */
export type Platform =
  | "x"
  | "instagram"
  | "tiktok"
  | "youtube"
  | "linkedin"
  | "reddit"
  | "facebook"
  | "bluesky"
  | "threads";

/** All known platform keys, ordered for stable UI rendering. */
export const PLATFORMS: readonly Platform[] = [
  "x",
  "instagram",
  "tiktok",
  "youtube",
  "linkedin",
  "reddit",
  "facebook",
  "bluesky",
  "threads",
] as const;

/**
 * Which actions a provider supports for a given platform/account. This is the
 * runtime source of truth the UI consults before offering an action.
 *
 * `schedule` is always `false` for providers: scheduling is owned by Outpost's
 * own scheduler (it stores the post and publishes at the target time), never
 * delegated to the provider. It lives in the matrix so callers have one place
 * to ask "is this action available" without special-casing.
 */
export interface PlatformCapabilities {
  publish: boolean;
  readComments: boolean;
  readDMs: boolean;
  sendDM: boolean;
  readEngagement: boolean;
  /** Always false for providers — Outpost schedules locally. */
  schedule: boolean;
}

/** A capability matrix keyed by platform. */
export type CapabilityMatrix = Record<Platform, PlatformCapabilities>;

/**
 * A connected account as the provider needs to see it. This is a thin DTO, not
 * the persisted `SocialAccount` row — providers only need enough to identify
 * the account and the platform it belongs to.
 */
export interface ProviderAccount {
  /** Stable id of the account within Outpost (the `SocialAccount.id`). */
  id: string;
  platform: Platform;
  /** Human-friendly label, e.g. an @handle. Optional. */
  label?: string;
  /** The account id as known to the remote platform, when known. */
  externalId?: string | null;
}

/** A piece of media attached to a publish target. */
export interface PublishMedia {
  /** Local file path or remote URL the provider can fetch/upload. */
  url: string;
  /** MIME type, e.g. "image/png", "video/mp4". */
  mimeType: string;
  /** Accessible alt text, when available. */
  altText?: string;
}

/** One ordered segment of a multi-segment publish (thread tweet / carousel slide). */
export interface PublishSegment {
  /** This segment's text. */
  text: string;
  /** This segment's ordered media, if any. */
  media?: PublishMedia[];
}

/** A single, fully-resolved publish request to one account. */
export interface PublishTarget {
  account: ProviderAccount;
  /** The post body text. For a multi-segment post this mirrors `segments[0]`. */
  text: string;
  /** Ordered media attachments, if any. For multi-segment, mirrors `segments[0]`. */
  media?: PublishMedia[];
  /**
   * Ordered segments for a thread/carousel (U12). When present, length >= 1 and
   * `segments[0]` mirrors the top-level `text`/`media`. Providers that don't
   * support multi-segment ignore this and publish `text`/`media` (the first
   * segment), which is the intended degrade.
   */
  segments?: PublishSegment[];
  /** Idempotency key so retries don't double-post. Optional. */
  idempotencyKey?: string;
}

/** A reference to an already-published post on a remote platform. */
export interface RemotePostRef {
  platform: Platform;
  /** The post id as known to the remote platform. */
  remoteId: string;
  /** The canonical URL of the post, when known. */
  remoteUrl?: string;
}

/**
 * Result of a publish attempt. A discriminated union rather than a thrown
 * error so callers can branch exhaustively without try/catch.
 */
export type PublishResult =
  | { ok: true; remoteId: string; remoteUrl?: string }
  | { ok: false; error: string };

/** The kind of an inbox item a provider can surface. */
export type ProviderInboxKind = "comment" | "reply" | "mention" | "dm";

/**
 * One engagement item as a provider surfaces it (U20). This is a thin DTO, not
 * the persisted `InboxItem` row — like `ProviderAccount`, it carries only what
 * the provider knows. The inbox layer maps it onto an `InboxItem` and persists
 * it, deduping on `externalId`.
 */
export interface ProviderInboxItem {
  /** The item's id as known to the remote platform — the dedupe key. */
  externalId: string;
  platform: Platform;
  kind: ProviderInboxKind;
  /** Display name / handle of whoever authored the item. */
  author: string;
  text: string;
  /** Canonical URL of the item on the remote platform, when known. */
  permalink?: string;
  /** Unix epoch millis the item was created on the remote platform. */
  receivedAt: number;
}

/** Engagement counts for a single post. All fields optional/unknown-safe. */
export interface EngagementCounts {
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  /** Unix epoch millis the counts were read. */
  fetchedAt: number;
}

/**
 * The provider-agnostic contract. Every method is async. Implementations must
 * be side-effect-free to construct (no network in the constructor) so the
 * registry can build them cheaply.
 */
export interface PlatformProvider {
  /** Stable identifier of this provider implementation. */
  readonly id: "composio" | "fake" | "bluesky" | "threads";

  /**
   * Establish (or re-establish) a connection for an account. Resolves when the
   * account is usable; rejects with an `Error` on failure.
   */
  connect(account: ProviderAccount): Promise<void>;

  /** Tear down the connection for an account. Idempotent. */
  disconnect(account: ProviderAccount): Promise<void>;

  /** Publish a single post to a single account. Never throws for expected
   * failures — returns a `{ ok: false }` result instead. */
  publish(target: PublishTarget): Promise<PublishResult>;

  /** Read current engagement counts for a previously published post. */
  readEngagement(ref: RemotePostRef): Promise<EngagementCounts>;

  /**
   * Resolve the capability matrix for one platform. Implementations should be
   * cheap/cacheable; the registry layer caches across calls.
   */
  capabilities(platform: Platform): Promise<PlatformCapabilities>;

  /**
   * Read engagement items (comments, replies, mentions, and DMs where
   * supported) for one connected account. Optional: providers that can't read
   * an inbox omit it, and the inbox layer treats a missing method as "returns
   * nothing", degrading cleanly. Implementations should only surface DMs where
   * the platform's `readDMs` capability is true.
   */
  readInbox?(account: ProviderAccount): Promise<ProviderInboxItem[]>;

  /**
   * Reply to a previously-read inbox item. Optional, for the same reason as
   * `readInbox`. Returns a `PublishResult` (the reply is itself a published
   * post/comment/DM), so callers branch on `ok` without try/catch.
   */
  replyToInboxItem?(
    item: ProviderInboxItem,
    text: string
  ): Promise<PublishResult>;
}

/** A capability matrix where every platform is unsupported. */
export function emptyCapabilities(): PlatformCapabilities {
  return {
    publish: false,
    readComments: false,
    readDMs: false,
    sendDM: false,
    readEngagement: false,
    schedule: false,
  };
}

/** Build a full matrix from a per-platform factory. */
export function buildMatrix(
  make: (platform: Platform) => PlatformCapabilities
): CapabilityMatrix {
  const matrix = {} as CapabilityMatrix;
  for (const platform of PLATFORMS) {
    matrix[platform] = make(platform);
  }
  return matrix;
}
