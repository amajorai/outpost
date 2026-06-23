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

/**
 * A reusable post body template scoped to a workspace (U16).
 *
 * The `body` column is a JSON blob (a versioned {@link TemplateBody}, defined in
 * `lib/repos/templates.ts`) so a template can carry its text plus optional
 * per-platform default overrides without a schema migration — the same approach
 * `drafts.body` uses for `DraftBody`. A legacy plain-text body decodes as a
 * text-only template, so older rows keep working.
 */
export interface Template {
  id: string;
  workspaceId: string;
  name: string;
  /** JSON-encoded {@link TemplateBody} (text + optional platform defaults). */
  body: string;
  createdAt: number;
}

/**
 * A learned writing-voice profile for a workspace (U16).
 *
 * A per-workspace singleton (one row per workspace, keyed by a UNIQUE
 * `workspace_id`) derived from the user's past posts via the ACP agent. Its
 * derived content (a human-readable summary plus structured traits) is a single
 * JSON `profile` blob so the shape can evolve without a SQLite migration —
 * mirroring `brand_kit`. The matching DDL lives in the v12 -> v13 migration in
 * `lib/db.ts`. The concrete blob shape (`VoiceProfileData`) lives in
 * `lib/repos/voice-profile.ts`.
 */
export interface VoiceProfile {
  id: string;
  workspaceId: string;
  /** JSON-encoded voice profile data (summary + traits). */
  profile: string;
  createdAt: number;
  updatedAt: number;
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

/** The kind of an inbox item: a comment/reply/mention or a direct message. */
export type InboxItemKind = "comment" | "reply" | "mention" | "dm";

/**
 * A unified engagement inbox item (U20): one comment, reply, mention, or DM
 * read from a connected account and persisted so the inbox is stable across
 * refreshes. The matching DDL lives in the v11 -> v12 migration in `lib/db.ts`.
 *
 * `externalId` is the remote platform's id for the item; together with
 * `workspaceId` + `socialAccountId` it forms the dedupe key (a UNIQUE index) so
 * re-reading the inbox never duplicates a previously-seen item.
 */
export interface InboxItem {
  id: string;
  workspaceId: string;
  /** The `social_accounts.id` this item was read from. */
  socialAccountId: string;
  /** Platform key, e.g. "x", "instagram", "youtube", "linkedin". */
  platform: string;
  kind: InboxItemKind;
  /** Display name / handle of whoever authored the item. */
  author: string;
  text: string;
  /** Canonical URL of the item on the remote platform, when known. */
  permalink: string | null;
  /** The item's id as known to the remote platform. */
  externalId: string;
  /** Unix epoch millis the item was created on the remote platform. */
  receivedAt: number;
  /** 1 once the user has replied to this item from Outpost, else 0. */
  replied: number;
}

/**
 * A post-performance feed item (U20 creates the table + type; U21 consumes it).
 *
 * One row per published post the app is tracking, holding its latest engagement
 * counts. The table + base columns ship in the v11 -> v12 migration (U20); the
 * `shares` / `engagementFetchedAt` columns and the dedupe UNIQUE index that
 * makes upsert-on-refresh possible are added in the v13 -> v14 migration (U21).
 * Both migrations live in `lib/db.ts`.
 */
export interface ActivityItem {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  platform: string;
  /** The post's id as known to the remote platform. */
  postRemoteId: string;
  permalink: string | null;
  text: string | null;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  /** Unix epoch millis the engagement counts were last read, when known. */
  engagementFetchedAt: number | null;
  publishedAt: number | null;
}

/**
 * The metric an experiment optimizes for (U25). `likes`/`comments`/`views` map
 * directly to the same-named `activity_items` columns; `engagement_rate` is a
 * derived ratio computed from those columns (see `lib/experiments/engine.ts`),
 * not a stored column.
 */
export type ExperimentGoalMetric =
  | "likes"
  | "comments"
  | "views"
  | "engagement_rate";

/**
 * An experiment's lifecycle: `draft` (created, not yet published),
 * `running` (variants published, observation window open), `complete`
 * (window elapsed, winner computed + stored).
 */
export type ExperimentStatus = "draft" | "running" | "complete";

/**
 * An A/B/n experiment over content/timing variants for one goal metric (U25).
 *
 * Workspace-scoped. Its variants ({@link ExperimentVariant}) each publish via
 * the existing scheduled_posts/post_targets pipeline; after
 * `observationWindowHours` the engine collects each variant's engagement and
 * persists a winning {@link ExperimentResult}. The matching DDL lives in the
 * v14 -> v15 migration in `lib/db.ts`.
 */
export interface Experiment {
  id: string;
  workspaceId: string;
  name: string;
  goalMetric: ExperimentGoalMetric;
  status: ExperimentStatus;
  /** Hours after publish to wait before measuring and choosing a winner. */
  observationWindowHours: number;
  createdAt: number;
}

/**
 * One variant of an experiment: a candidate post body published to one platform
 * (U25). Scopes to its experiment through `experimentId` only — like
 * `post_targets`, child rows reach the workspace through their parent.
 *
 * `draftBody` is a JSON blob (the same shape `drafts.body` uses) so a variant
 * can carry text + media without a schema migration. `scheduledPostId` is set
 * once the engine has published the variant via the pipeline.
 */
export interface ExperimentVariant {
  id: string;
  experimentId: string;
  /** Human-friendly label, e.g. "Variant A" or "Morning post". */
  label: string;
  /** JSON-encoded post body for this variant. */
  draftBody: string;
  /** The `scheduled_posts.id` created for this variant, once published. */
  scheduledPostId: string | null;
  /** Platform key this variant publishes to, e.g. "x", "bluesky". */
  targetPlatform: string;
  /** Unix epoch millis this variant is scheduled to publish, when known. */
  scheduledFor: number | null;
}

/**
 * The measured outcome for one variant of an experiment (U25): its goal-metric
 * value at measurement time and whether it won. One row per variant (a UNIQUE
 * index on `experiment_id, variant_id` keeps re-measurement an upsert).
 */
export interface ExperimentResult {
  id: string;
  experimentId: string;
  variantId: string;
  /** The variant's goal-metric value at `measuredAt`. */
  metricValue: number;
  measuredAt: number;
  /** 1 when this variant won the experiment, else 0. */
  isWinner: number;
}

/**
 * The user-editable strategy document that steers the autoresearch loop (U27).
 *
 * Modeled on karpathy/autoresearch's `program.md`: a single markdown document
 * the user authors with goals, voice, niche, and guardrails. It is the "program"
 * the loop runs against. The `goalMetric` + `observationWindowHours` on the same
 * row turn the prose into a concrete experiment configuration: the markdown
 * steers the AI proposal, the goal metric + window steer the U25 experiment that
 * scores it. Workspace-scoped, one row per workspace. DDL lives in the
 * v15 -> v16 migration in `lib/db.ts`.
 */
export interface AutoresearchStrategy {
  workspaceId: string;
  /** The markdown strategy doc (goals, voice, niche, guardrails). */
  content: string;
  /** The single hard metric every iteration is scored against. */
  goalMetric: ExperimentGoalMetric;
  /** Hours the challenger experiment observes before it is scored. */
  observationWindowHours: number;
  updatedAt: number;
}

/**
 * The keep/discard verdict of one autoresearch iteration (U27). `kept` means the
 * proposed challenger beat the running best metric and becomes the new best;
 * `discarded` means it did not. `pending` is an iteration that has been proposed
 * + started but not yet scored (the step boundary, so the loop is inspectable
 * mid-flight without waiting real hours).
 */
export type AutoresearchDecision = "pending" | "kept" | "discarded";

/**
 * One iteration of the Karpathy-style autoresearch loop (U27): a single
 * propose -> run experiment -> score -> keep/discard cycle, recorded whether it
 * was kept or discarded so the whole history stays inspectable.
 *
 * Scopes through `workspaceId`. `experimentId` links to the U25 experiment the
 * iteration ran to score its proposal; `metricValue` is that experiment's
 * measured goal-metric value once scored (null while `pending`). `proposal` is a
 * JSON blob ({@link AutoresearchProposalData}) so the proposal shape can evolve
 * without a schema migration.
 */
export interface AutoresearchIteration {
  id: string;
  workspaceId: string;
  /** 1-based position of this iteration within the workspace's loop. */
  iterationNumber: number;
  /** JSON-encoded {@link AutoresearchProposalData} the agent produced. */
  proposal: string;
  /** The U25 experiment this iteration ran to score the proposal, when started. */
  experimentId: string | null;
  /** The goal-metric value the experiment measured, or null while pending. */
  metricValue: number | null;
  /** The keep/discard verdict; `pending` until the iteration is scored. */
  decision: AutoresearchDecision;
  createdAt: number;
}

/**
 * What a radar target tracks (U28): a specific creator (`competitor`, whose
 * `value` is an @handle on `platform`) or a topic/keyword (`topic`, whose
 * `value` is the search phrase). A single kind-discriminated table keeps the
 * competitor + topic surfaces symmetric in the repo and UI.
 */
export type RadarTargetKind = "competitor" | "topic";

/**
 * A creator or topic the user is tracking on the competitor/trend radar (U28).
 *
 * The user *input* of the radar — what to watch. The radar fetch step reads
 * these and produces {@link TrendSignal}s (the cached output). Workspace-scoped.
 * The matching DDL lives in the v16 -> v17 migration in `lib/db.ts`; a UNIQUE
 * index on (workspace_id, kind, platform, value) makes re-adding the same target
 * idempotent.
 */
export interface RadarTarget {
  id: string;
  workspaceId: string;
  kind: RadarTargetKind;
  /** Platform key for a competitor (e.g. "x"); a hint/null for a topic. */
  platform: string | null;
  /** The @handle for a competitor, or the keyword/phrase for a topic. */
  value: string;
  /** Optional human-friendly label shown in the UI. */
  label: string | null;
  addedAt: number;
}

/**
 * The kind of a cached radar finding (U28): a tracked creator's recent
 * high-performing post (`creator-winner`) or a rising topic/format (`trend`).
 */
export type TrendSignalKind = "creator-winner" | "trend";

/**
 * A cached radar finding (U28): a competitor's winning post or a rising
 * topic/format, surfaced in the radar view and consumable by the U27
 * autoresearch loop as research input.
 *
 * The *output* of the radar fetch step. Workspace-scoped. `targetId` links the
 * signal back to the {@link RadarTarget} it was fetched for (null for a general
 * trend). The matching DDL lives in the v16 -> v17 migration in `lib/db.ts`; a
 * UNIQUE dedupe index on (workspace_id, kind, platform, target_id, external_id)
 * makes a refresh upsert in place rather than duplicate — the activity-feed
 * pattern. `raw` is an optional JSON blob for provider-specific extras.
 */
export interface TrendSignal {
  id: string;
  workspaceId: string;
  kind: TrendSignalKind;
  /** The {@link RadarTarget} this signal came from, or null for a general trend. */
  targetId: string | null;
  platform: string | null;
  /** Stable per-signal key (remote post id or a slug of the title) — dedupe key. */
  externalId: string;
  title: string;
  summary: string | null;
  url: string | null;
  /** Relative strength of the signal (e.g. an engagement count or rank score). */
  score: number;
  /** Optional JSON blob of provider-specific extras. */
  raw: string | null;
  /** Unix epoch millis the signal was fetched/cached. */
  fetchedAt: number;
}
