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

/**
 * How much the autopilot crew orchestrator (U30) is allowed to act on its own:
 * - `suggest`: only show the proposed plan; never queue anything.
 * - `approve-each`: the DEFAULT — every queued action needs an explicit per-action
 *   user approval before it touches a real account.
 * - `full-auto`: queue + schedule proposed posts without prompting.
 *
 * `full-auto` is OFF by default and requires an explicit, confirmed opt-in
 * (a Dialog that states it posts to real public accounts), per the unit's safety
 * contract. When a persisted value is absent or unrecognized, callers MUST coerce
 * to `approve-each` so the absence path can never resolve to `full-auto`.
 */
export type AutopilotAutonomy = "suggest" | "approve-each" | "full-auto";

/** The default autonomy level. Never `full-auto`. */
export const DEFAULT_AUTOPILOT_AUTONOMY: AutopilotAutonomy = "approve-each";

/**
 * The lifecycle of a single autopilot action (U30):
 * - `proposed`: the strategist put it in the plan; nothing has touched a real
 *   account yet.
 * - `approved`: the user explicitly approved it (the `approve-each` gate) but it
 *   has not been queued yet — a transient state the store advances through.
 * - `queued`: it has been turned into a real `scheduled_posts` row (the auditable
 *   "this was actually queued" record). `scheduledPostId` is then set.
 * - `rejected`: the user declined it; it stays in the log for auditability.
 */
export type AutopilotActionStatus =
  | "proposed"
  | "approved"
  | "queued"
  | "rejected";

/**
 * One auditable autopilot action (U30): a proposed post in a weekly content plan.
 *
 * This single table doubles as plan storage AND the audit log the unit's
 * acceptance criteria require — one row per proposed post, grouped into a plan by
 * `planId`. The strategist agent produces the body + rationale + timing hint; the
 * orchestrator assigns a concrete `scheduledFor` deterministically from the U26
 * timing recommender. `status` records whether it was approved/queued/rejected,
 * and `scheduledPostId` links a queued action to the real `scheduled_posts` row it
 * created, so the whole chain stays inspectable. `body` is a JSON-encoded draft
 * body (the same shape `drafts.body` / experiment `draftBody` use) so the action
 * shape can evolve without a schema migration. Workspace-scoped. DDL lives in the
 * v17 -> v18 migration in `lib/db.ts`.
 */
export interface AutopilotAction {
  id: string;
  workspaceId: string;
  /** Groups all actions proposed together as one weekly plan. */
  planId: string;
  /** JSON-encoded draft body for the proposed post. */
  body: string;
  /** The opening line/hook, surfaced in the plan UI. */
  hook: string;
  /** Platform key the post targets, e.g. "x". */
  targetPlatform: string;
  /** Concrete Unix epoch millis the orchestrator assigned, or null if unscheduled. */
  scheduledFor: number | null;
  /** Why the strategist proposed this, grounded in the crew's signals. */
  rationale: string;
  status: AutopilotActionStatus;
  /** The `scheduled_posts` row this action created once queued, else null. */
  scheduledPostId: string | null;
  createdAt: number;
}

/**
 * A sponsorship deal's lifecycle (U31), the columns the money-hub kanban/table
 * groups by:
 * - `lead`: an inbound/identified opportunity, not yet in conversation.
 * - `negotiating`: terms (scope, rate, timeline) are being agreed.
 * - `active`: agreed and in progress — deliverables are being produced.
 * - `delivered`: the deliverables have shipped; awaiting payment.
 * - `paid`: closed out, money received.
 */
export type DealStatus =
  | "lead"
  | "negotiating"
  | "active"
  | "delivered"
  | "paid";

/** One agreed line item of work in a sponsorship deal (U31). */
export interface DealDeliverable {
  /** What is owed, e.g. "1 dedicated post" or "3-tweet thread". */
  description: string;
  /** 1 once this line item has been delivered, else 0. */
  done: boolean;
}

/**
 * A brand sponsorship deal in the creator's money hub (U31).
 *
 * One row per deal, moved through {@link DealStatus} as it progresses. The
 * `deliverables` list is stored as a JSON blob (the brand_kit precedent: a TEXT
 * column the repo parses to this typed shape, never exposed raw) so a deal can
 * carry its line items without a schema migration. `rate` + `currency` capture
 * the money; `dueDate` and `notes` are optional. Workspace-scoped. DDL lives in
 * the v18 -> v19 migration in `lib/db.ts`.
 */
export interface Deal {
  id: string;
  workspaceId: string;
  /** The sponsoring brand / company name. */
  brand: string;
  status: DealStatus;
  /** The agreed rate for the deal, in `currency`. */
  rate: number;
  /** ISO 4217 currency code, e.g. "USD". */
  currency: string;
  /** The agreed line items of work. */
  deliverables: DealDeliverable[];
  /** Unix epoch millis the deliverables are due, when set. */
  dueDate: number | null;
  notes: string | null;
  createdAt: number;
}

/** The UTM parameters of a tracked link (U31), stored as a JSON blob. */
export interface UtmParams {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
}

/**
 * A UTM / affiliate link in the money hub (U31).
 *
 * One row per shareable link: a `destinationUrl`, a typed `utm` blob (the
 * brand_kit JSON precedent), a generated `shortCode`, and a best-effort `clicks`
 * counter. There is no redirect server, so `clicks` is a manual/best-effort
 * counter incremented from the UI rather than true attribution. Workspace-scoped;
 * a UNIQUE index on (workspace_id, short_code) keeps generated codes unique. DDL
 * lives in the v18 -> v19 migration in `lib/db.ts`.
 */
export interface TrackedLink {
  id: string;
  workspaceId: string;
  /** Human-friendly label for the link, e.g. "Spring sale - X bio". */
  label: string;
  /** The URL the link points at, before UTM params are appended. */
  destinationUrl: string;
  utm: UtmParams;
  /** Short, workspace-unique code identifying the link. */
  shortCode: string;
  /** Best-effort click count (manually incremented; no redirect server). */
  clicks: number;
  createdAt: number;
}

/**
 * The production lifecycle a content item moves through (U33), which the
 * pipeline kanban groups its columns by:
 * - `idea`: a raw concept, not yet written.
 * - `script`: being written / scripted.
 * - `record`: scripted; recording the asset (video/audio).
 * - `edit`: recorded; editing into its final form.
 * - `publish`: edited and ready to publish (promote into a draft/scheduled post).
 */
export type ContentStage = "idea" | "script" | "record" | "edit" | "publish";

/**
 * A content item on the production pipeline kanban (U33).
 *
 * One row per idea, moved through {@link ContentStage} as it is produced. `body`
 * is a JSON draft-body blob (the `drafts.body` / `autopilot_actions.body`
 * precedent: a TEXT column the repo stores raw and the composer decodes) so a
 * card can carry the post text + media it will be promoted into without a schema
 * migration. `sortOrder` orders cards within a stage column. Workspace-scoped;
 * DDL lives in the v19 -> v20 migration in `lib/db.ts`.
 */
export interface ContentItem {
  id: string;
  workspaceId: string;
  /** Short, human-friendly title for the idea/card. */
  title: string;
  stage: ContentStage;
  /** Free-form production notes, when set. */
  notes: string | null;
  /** JSON draft-body blob the card promotes into; defaults to "{}". */
  body: string;
  /** Orders cards within a stage column (lower first). */
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}
