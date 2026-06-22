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
  | "publishing"
  | "published"
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
