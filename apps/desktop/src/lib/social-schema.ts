/**
 * TypeScript shapes for the v10 multi-tenant posting schema.
 *
 * One SQLite database can hold data for multiple workspaces. Every domain
 * table carries a `workspace_id` so a single install can isolate unrelated
 * sets of accounts, drafts, and scheduled posts. The matching DDL lives in the
 * v9 -> v10 migration in `lib/db.ts`.
 *
 * Repositories (CRUD) live in their own feature units; this file only declares
 * the row shapes so callers share a single source of truth.
 */

/**
 * The deterministic id of the default workspace seeded by the v10 migration.
 * Existing rows from migrations 1-9 are back-filled to this id. Later feature
 * units should reference this constant rather than re-deriving the string.
 */
export const DEFAULT_WORKSPACE_ID = "default";

/** A tenant boundary. All domain rows belong to exactly one workspace. */
export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
}

/** A connected social platform account scoped to a workspace. */
export interface SocialAccount {
  id: string;
  workspaceId: string;
  /** Platform key, e.g. "x", "bluesky", "mastodon", "linkedin". */
  platform: string;
  /** Human-friendly label shown in the UI, e.g. an @handle. */
  accountLabel: string;
  /** The account id as known to the remote platform. */
  externalId: string | null;
  /** 1 when the account currently has a usable connection, else 0. */
  connected: number;
  createdAt: number;
}

/** A composed-but-unscheduled post body, stored as JSON. */
export interface Draft {
  id: string;
  workspaceId: string;
  /** JSON-encoded post body (text, media refs, per-platform overrides). */
  body: string;
  createdAt: number;
  updatedAt: number;
}

export type ScheduledPostStatus =
  | "scheduled"
  /**
   * Marked by the local scheduler when `scheduledFor <= now`. This is the
   * handoff state between the scheduler (U9) and the publish pipeline (U10):
   * the scheduler transitions `scheduled -> due` and emits the row, then U10
   * picks it up and moves it to `publishing`. Added as an additive enum value
   * on the TEXT `status` column — no DDL change, so no `user_version` bump.
   */
  | "due"
  | "publishing"
  | "published"
  /**
   * Some targets published and some failed. Set by the publish pipeline (U10)
   * when a fan-out post had mixed per-target results. Added as an additive enum
   * value on the TEXT `status` column — same precedent as `due` above, so no DDL
   * change and no `user_version` bump (additive-only per CLAUDE.md).
   */
  | "partial"
  | "failed"
  | "cancelled";

/** A draft queued to publish at a specific time across its targets. */
export interface ScheduledPost {
  id: string;
  workspaceId: string;
  draftId: string | null;
  /** Unix epoch millis the post should be published at. */
  scheduledFor: number;
  status: ScheduledPostStatus;
  createdAt: number;
}

export type PostTargetStatus =
  | "pending"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

/** One scheduled post fanned out to a single social account. */
export interface PostTarget {
  id: string;
  scheduledPostId: string;
  socialAccountId: string;
  platform: string;
  /** Per-target body override; null means use the draft body verbatim. */
  variantBody: string | null;
  status: PostTargetStatus;
}

export type PostHistoryStatus = "published" | "failed";

/** The terminal record of a publish attempt for a single target. */
export interface PostHistory {
  id: string;
  postTargetId: string;
  status: PostHistoryStatus;
  /** Canonical URL of the published post, when available. */
  remoteUrl: string | null;
  /** The post id as known to the remote platform, when available. */
  remoteId: string | null;
  /** Error message when the attempt failed, else null. */
  error: string | null;
  publishedAt: number | null;
}

/** A reusable post body template scoped to a workspace. */
export interface Template {
  id: string;
  workspaceId: string;
  name: string;
  body: string;
  createdAt: number;
}

/** The kind of a saved media asset, derived from its MIME type. */
export type MediaAssetKind = "image" | "video";

/**
 * A reusable media item in the workspace's library (U13).
 *
 * Like a composer attachment, this is a *reference* to a local file (its path),
 * never a copy. Saving an attachment to the library lets it be reused across
 * posts. The matching DDL lives in the v10 -> v11 migration in `lib/db.ts`.
 */
export interface MediaAsset {
  id: string;
  workspaceId: string;
  kind: MediaAssetKind;
  /** Local file path (the absolute path the file dialog returned). */
  path: string;
  /** Display file name. */
  name: string;
  /** Best-effort MIME type derived from the file extension, when known. */
  mimeType: string | null;
  createdAt: number;
}

/** A named brand color. */
export interface BrandColor {
  name: string;
  /** CSS color value, e.g. a hex string. */
  value: string;
}

/** A brand font family. */
export interface BrandFont {
  name: string;
  /** CSS font-family value. */
  family: string;
}

/** A brand logo, referencing a local file path. */
export interface BrandLogo {
  /** Local file path. */
  path: string;
  name: string;
}

/** Where a watermark anchors over a post preview. */
export type WatermarkPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "center";

/** The brand watermark applied over post media. */
export interface BrandWatermark {
  /** Local file path of the watermark image (typically a logo). */
  path: string;
  position: WatermarkPosition;
  /** 0..1 opacity of the overlay. */
  opacity: number;
}

/**
 * A workspace's brand kit (U13): logos, colors, fonts, and an optional
 * watermark. Stored as a single per-workspace row whose list/object fields are
 * JSON blobs so the shape can evolve without a SQLite migration. The matching
 * DDL lives in the v10 -> v11 migration in `lib/db.ts`.
 */
export interface BrandKit {
  id: string;
  workspaceId: string;
  logos: BrandLogo[];
  colors: BrandColor[];
  fonts: BrandFont[];
  watermark: BrandWatermark | null;
  createdAt: number;
  updatedAt: number;
}
