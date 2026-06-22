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

/** A single, fully-resolved publish request to one account. */
export interface PublishTarget {
  account: ProviderAccount;
  /** The post body text. */
  text: string;
  /** Ordered media attachments, if any. */
  media?: PublishMedia[];
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
  readonly id: "composio" | "fake";

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
