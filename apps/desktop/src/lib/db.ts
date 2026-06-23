import Database from "@tauri-apps/plugin-sql";
import { logger } from "@/lib/logger";
import { DEFAULT_WORKSPACE_ID } from "@/lib/social-schema";

let db: Database | null = null;
let dbInitPromise: Promise<Database> | null = null;

// Bump this whenever you add a new migration below.
const TARGET_SCHEMA_VERSION = 17;

/**
 * Pre-v10 domain tables that gain a `workspace_id` in the v10 migration.
 * Each existing row is back-filled to the default workspace.
 */
const V10_LEGACY_DOMAIN_TABLES = [
  "thumbnails",
  "trash",
  "project_revisions",
  "folders",
  "archive_folders",
  "ai_projects",
  "yt_favourites",
  "yt_collections",
  "yt_collection_items",
  "yt_thumbnail_history",
] as const;

type MigrationFn = (database: Database) => Promise<void>;

/**
 * SQLite throws on `ALTER TABLE ... ADD COLUMN` when the column already exists.
 * That's intolerable for our bootstrap path: a user on a pre-tracker install
 * may already have any subset of v1-v6 columns/tables but report
 * `user_version = 0`. Every migration step needs to be safely re-runnable.
 *
 * `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` already are.
 * For ADD COLUMN, swallow the specific "duplicate column name" error and
 * rethrow anything else.
 */
async function safeAddColumn(database: Database, sql: string): Promise<void> {
  try {
    await database.execute(sql);
  } catch (err) {
    const msg = String(err).toLowerCase();
    if (msg.includes("duplicate column name")) {
      return;
    }
    throw err;
  }
}

const migrations: Record<number, MigrationFn> = {
  1: async (database) => {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS thumbnails (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL DEFAULT 0,
        canvasWidth INTEGER,
        canvasHeight INTEGER
      )
    `);
    await database.execute(`
      CREATE TABLE IF NOT EXISTS trash (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        deletedAt INTEGER NOT NULL,
        originalCreatedAt INTEGER NOT NULL,
        originalUpdatedAt INTEGER NOT NULL,
        canvasWidth INTEGER,
        canvasHeight INTEGER
      )
    `);
    await database.execute(`
      CREATE TABLE IF NOT EXISTS project_revisions (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        name TEXT NOT NULL
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_project_revisions_projectId ON project_revisions(projectId, createdAt)"
    );
    await database.execute(`
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      )
    `);
  },
  2: async (database) => {
    await safeAddColumn(
      database,
      "ALTER TABLE thumbnails ADD COLUMN folderId TEXT"
    );
    await safeAddColumn(
      database,
      "ALTER TABLE folders ADD COLUMN sortOrder INTEGER NOT NULL DEFAULT 0"
    );
  },
  3: async (database) => {
    await safeAddColumn(
      database,
      "ALTER TABLE folders ADD COLUMN isCharacterSet INTEGER NOT NULL DEFAULT 0"
    );
    await safeAddColumn(database, "ALTER TABLE folders ADD COLUMN color TEXT");
  },
  4: async (database) => {
    await safeAddColumn(
      database,
      "ALTER TABLE thumbnails ADD COLUMN archivedAt INTEGER"
    );
    await safeAddColumn(
      database,
      "ALTER TABLE thumbnails ADD COLUMN archiveFolderId TEXT"
    );
    await database.execute(`
      CREATE TABLE IF NOT EXISTS archive_folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        sortOrder INTEGER NOT NULL DEFAULT 0,
        color TEXT
      )
    `);
  },
  5: async (database) => {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS ai_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      )
    `);
  },
  6: async (database) => {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS yt_favourites (
        videoId TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        channelTitle TEXT NOT NULL,
        thumbnailUrl TEXT NOT NULL,
        viewCount INTEGER NOT NULL DEFAULT 0,
        likeCount INTEGER NOT NULL DEFAULT 0,
        commentCount INTEGER NOT NULL DEFAULT 0,
        publishedAt TEXT NOT NULL,
        durationSeconds INTEGER NOT NULL DEFAULT 0,
        savedAt INTEGER NOT NULL
      )
    `);
  },
  7: async (_database) => {
    // Schema version tracking introduced — no structural changes needed.
    // Future migrations go here as version 8, 9, etc.
  },
  8: async (database) => {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS yt_collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT,
        sortOrder INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      )
    `);
    await database.execute(`
      CREATE TABLE IF NOT EXISTS yt_collection_items (
        collectionId TEXT NOT NULL,
        videoId TEXT NOT NULL,
        addedAt INTEGER NOT NULL,
        PRIMARY KEY (collectionId, videoId)
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_yt_collection_items_videoId ON yt_collection_items(videoId)"
    );
  },
  9: async (database) => {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS yt_thumbnail_history (
        id TEXT PRIMARY KEY,
        videoId TEXT NOT NULL,
        thumbnailUrl TEXT NOT NULL,
        projectId TEXT,
        note TEXT,
        uploadedAt INTEGER NOT NULL
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_yt_thumbnail_history_videoId ON yt_thumbnail_history(videoId, uploadedAt)"
    );
  },
  10: async (database) => {
    // Multi-tenant posting foundation. New tables carry workspace_id NOT NULL
    // by design; legacy tables get a nullable workspace_id (you can't add a
    // NOT NULL column without a default to an already-populated table) and are
    // then back-filled to the seeded default workspace.
    await database.execute(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      )
    `);
    await database.execute(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        account_label TEXT NOT NULL,
        external_id TEXT,
        connected INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_social_accounts_workspace ON social_accounts(workspace_id)"
    );
    await database.execute(`
      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_drafts_workspace ON drafts(workspace_id)"
    );
    await database.execute(`
      CREATE TABLE IF NOT EXISTS scheduled_posts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        draft_id TEXT,
        scheduled_for INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_scheduled_posts_workspace ON scheduled_posts(workspace_id, scheduled_for)"
    );
    await database.execute(`
      CREATE TABLE IF NOT EXISTS post_targets (
        id TEXT PRIMARY KEY,
        scheduled_post_id TEXT NOT NULL,
        social_account_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        variant_body TEXT,
        status TEXT NOT NULL
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_post_targets_scheduled_post ON post_targets(scheduled_post_id)"
    );
    await database.execute(`
      CREATE TABLE IF NOT EXISTS post_history (
        id TEXT PRIMARY KEY,
        post_target_id TEXT NOT NULL,
        status TEXT NOT NULL,
        remote_url TEXT,
        remote_id TEXT,
        error TEXT,
        published_at INTEGER
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_post_history_post_target ON post_history(post_target_id)"
    );
    await database.execute(`
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_templates_workspace ON templates(workspace_id)"
    );

    // Seed the default workspace before back-filling so back-filled rows point
    // at a row that exists. OR IGNORE keeps this safe on the bootstrap re-run
    // path where the workspace may already be present.
    await database.execute(
      "INSERT OR IGNORE INTO workspaces (id, name, createdAt) VALUES ($1, $2, $3)",
      [DEFAULT_WORKSPACE_ID, "Default", Date.now()]
    );

    // Add workspace_id to every legacy domain table and back-fill existing rows.
    for (const table of V10_LEGACY_DOMAIN_TABLES) {
      await safeAddColumn(
        database,
        `ALTER TABLE ${table} ADD COLUMN workspace_id TEXT`
      );
      await database.execute(
        `UPDATE ${table} SET workspace_id = $1 WHERE workspace_id IS NULL`,
        [DEFAULT_WORKSPACE_ID]
      );
    }
  },
  11: async (database) => {
    // Media library + brand kit (U13). Both are workspace-scoped.
    //
    // media_assets stores references to local media (the same path strings the
    // composer already holds) so saved assets can be reused across posts. We
    // store a reference, never a copy of the file — mirroring the composer's
    // attachment model. brand_kit is a per-workspace singleton (one row per
    // workspace) whose logos/colors/fonts/watermark are JSON blobs so the shape
    // can evolve without a SQLite migration.
    await database.execute(`
      CREATE TABLE IF NOT EXISTS media_assets (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT,
        created_at INTEGER NOT NULL
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_media_assets_workspace ON media_assets(workspace_id, created_at)"
    );
    await database.execute(`
      CREATE TABLE IF NOT EXISTS brand_kit (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL UNIQUE,
        logos TEXT NOT NULL DEFAULT '[]',
        colors TEXT NOT NULL DEFAULT '[]',
        fonts TEXT NOT NULL DEFAULT '[]',
        watermark TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_brand_kit_workspace ON brand_kit(workspace_id)"
    );
  },
  12: async (database) => {
    // Monitoring schema (U20). Both tables are workspace-scoped.
    //
    // inbox_items is the unified engagement inbox: comments, replies, mentions,
    // and DMs read from across connected accounts and persisted so the inbox is
    // stable across refreshes. The UNIQUE index on
    // (workspace_id, social_account_id, external_id) is what makes re-reading
    // the inbox idempotent — repeated fetches `INSERT OR IGNORE` and never
    // accumulate duplicates of the same remote item.
    //
    // activity_items is the post-performance feed consumed by U21 (this unit
    // only creates the table + TS type; no repo or UI reads it yet).
    await database.execute(`
      CREATE TABLE IF NOT EXISTS inbox_items (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        social_account_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        kind TEXT NOT NULL,
        author TEXT NOT NULL,
        text TEXT NOT NULL,
        permalink TEXT,
        external_id TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        replied INTEGER NOT NULL DEFAULT 0
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_inbox_items_workspace ON inbox_items(workspace_id, received_at)"
    );
    await database.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_items_external ON inbox_items(workspace_id, social_account_id, external_id)"
    );
    await database.execute(`
      CREATE TABLE IF NOT EXISTS activity_items (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        social_account_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        post_remote_id TEXT NOT NULL,
        permalink TEXT,
        text TEXT,
        likes INTEGER NOT NULL DEFAULT 0,
        comments INTEGER NOT NULL DEFAULT 0,
        views INTEGER NOT NULL DEFAULT 0,
        published_at INTEGER
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_activity_items_workspace ON activity_items(workspace_id, published_at)"
    );
  },
  13: async (database) => {
    // Voice/style learning (U16). A voice profile is a per-workspace singleton
    // (one row per workspace, keyed by a UNIQUE `workspace_id`) — the same shape
    // as `brand_kit` (v11). Its derived content (a tone/length/emoji/hook
    // summary plus structured traits) lives in a single JSON `profile` blob so
    // the shape can evolve without another SQLite migration.
    //
    // Templates already have a table (v10) — no template DDL here.
    await database.execute(`
      CREATE TABLE IF NOT EXISTS voice_profile (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL UNIQUE,
        profile TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_voice_profile_workspace ON voice_profile(workspace_id)"
    );
  },
  14: async (database) => {
    // Activity feed (U21). The `activity_items` table was created in v12 (U20)
    // but never written to. U21 aggregates published posts across accounts and
    // upserts their latest engagement counts, keyed on
    // (workspace_id, social_account_id, post_remote_id) so a re-refresh updates
    // a post's metrics in place rather than duplicating it. v12's DDL has no
    // such UNIQUE constraint, so we add one here (a new migration, never an edit
    // to the shipped v12 block — per the SQLite versioning contract). Safe
    // because no code has ever written to the table, so there are no duplicate
    // rows to violate the new index.
    //
    // We also add `shares` and `engagement_fetched_at` so the row can carry the
    // remaining fields the provider's `EngagementCounts` returns. Additive
    // columns via safeAddColumn keep the bootstrap-from-untracked-install path
    // forward-safe.
    await safeAddColumn(
      database,
      "ALTER TABLE activity_items ADD COLUMN shares INTEGER NOT NULL DEFAULT 0"
    );
    await safeAddColumn(
      database,
      "ALTER TABLE activity_items ADD COLUMN engagement_fetched_at INTEGER"
    );
    await database.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_items_dedupe ON activity_items(workspace_id, social_account_id, post_remote_id)"
    );
  },
  15: async (database) => {
    // Experiments engine (U25). The attention layer's core: an experiment runs
    // N content/timing variants for a single goal metric, publishes each via the
    // existing scheduled_posts/post_targets pipeline, and after an observation
    // window collects each variant's engagement and computes a winner.
    //
    // `experiments` is workspace-scoped. `experiment_variants` and
    // `experiment_results` scope through `experiment_id` only (no own
    // workspace_id), mirroring the post_targets/post_history precedent where the
    // child rows reach the workspace through their parent. is_winner is an INTEGER
    // flag (SQLite has no bool), following the `connected`/`replied` precedent.
    //
    // draft_body is a JSON blob (the same shape `drafts.body` uses) so a variant
    // can carry text + media without a schema migration. scheduled_post_id links
    // a variant to the scheduled post the engine created for it once published.
    await database.execute(`
      CREATE TABLE IF NOT EXISTS experiments (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        goal_metric TEXT NOT NULL,
        status TEXT NOT NULL,
        observation_window_hours INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_experiments_workspace ON experiments(workspace_id, created_at)"
    );
    await database.execute(`
      CREATE TABLE IF NOT EXISTS experiment_variants (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL,
        label TEXT NOT NULL,
        draft_body TEXT NOT NULL,
        scheduled_post_id TEXT,
        target_platform TEXT NOT NULL,
        scheduled_for INTEGER
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_experiment_variants_experiment ON experiment_variants(experiment_id)"
    );
    await database.execute(`
      CREATE TABLE IF NOT EXISTS experiment_results (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL,
        variant_id TEXT NOT NULL,
        metric_value REAL NOT NULL,
        measured_at INTEGER NOT NULL,
        is_winner INTEGER NOT NULL DEFAULT 0
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_experiment_results_experiment ON experiment_results(experiment_id)"
    );
    await database.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_experiment_results_variant ON experiment_results(experiment_id, variant_id)"
    );
  },
  16: async (database) => {
    // Autoresearch loop (U27). A Karpathy-autoresearch-style closed loop: a
    // user-editable strategy document (the `program.md` analog) steers an AI
    // agent that proposes one content change per iteration, runs it as a U25
    // experiment over an observation window, scores ONE hard metric, and keeps
    // or discards the change. Every iteration is recorded so the whole history
    // stays inspectable.
    //
    // `autoresearch_strategy` is workspace-scoped with one row per workspace
    // (workspace_id is the PRIMARY KEY): the strategy markdown plus the goal
    // metric + observation window that turn the prose into a concrete experiment.
    //
    // `autoresearch_iterations` is workspace-scoped, one row per iteration. The
    // proposal is a JSON blob so the proposal shape can evolve without a schema
    // migration; experiment_id links to the U25 experiment that scored it
    // (nullable while pending); decision is a TEXT enum, metric_value the scored
    // goal-metric value (nullable while pending).
    await database.execute(`
      CREATE TABLE IF NOT EXISTS autoresearch_strategy (
        workspace_id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        goal_metric TEXT NOT NULL,
        observation_window_hours INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    await database.execute(`
      CREATE TABLE IF NOT EXISTS autoresearch_iterations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        iteration_number INTEGER NOT NULL,
        proposal TEXT NOT NULL,
        experiment_id TEXT,
        metric_value REAL,
        decision TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_autoresearch_iterations_workspace ON autoresearch_iterations(workspace_id, iteration_number)"
    );
  },
  17: async (database) => {
    // Competitor / trend radar (U28). Two workspace-scoped surfaces:
    //
    // `radar_targets` is the user *input*: the creators and topics the user
    // chooses to track. A single kind-discriminated table (kind = 'competitor'
    // | 'topic') rather than two tables — both carry the same (platform?, value,
    // label, added_at) shape, and one table keeps the repo and UI symmetric. For
    // a competitor `value` is the @handle; for a topic it's the keyword/phrase.
    // The UNIQUE index on (workspace_id, kind, platform, value) keeps re-adding
    // the same target idempotent.
    //
    // `trend_signals` is the cached *output*: the radar's findings — a tracked
    // creator's recent winner, or a rising topic/format. kind = 'creator-winner'
    // | 'trend'. target_id links a signal back to the radar_target it came from
    // (nullable: a general trend has no specific target). The UNIQUE dedupe index
    // (workspace_id, kind, platform, target_id, external_id) is added HERE in the
    // table's first migration — never bolted on later — so a refresh upserts in
    // place rather than duplicating, mirroring activity_items. external_id is a
    // stable key for the signal (a remote post id, or a slug of the title) so the
    // same finding updates rather than accumulates.
    await database.execute(`
      CREATE TABLE IF NOT EXISTS radar_targets (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        platform TEXT,
        value TEXT NOT NULL,
        label TEXT,
        added_at INTEGER NOT NULL
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_radar_targets_workspace ON radar_targets(workspace_id, kind)"
    );
    await database.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_radar_targets_dedupe ON radar_targets(workspace_id, kind, platform, value)"
    );
    await database.execute(`
      CREATE TABLE IF NOT EXISTS trend_signals (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        target_id TEXT,
        platform TEXT,
        external_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        url TEXT,
        score REAL NOT NULL DEFAULT 0,
        raw TEXT,
        fetched_at INTEGER NOT NULL
      )
    `);
    await database.execute(
      "CREATE INDEX IF NOT EXISTS idx_trend_signals_workspace ON trend_signals(workspace_id, fetched_at)"
    );
    await database.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_trend_signals_dedupe ON trend_signals(workspace_id, kind, platform, target_id, external_id)"
    );
  },
};

async function runMigrations(database: Database): Promise<void> {
  const rows = await database.select<[{ user_version: number }]>(
    "PRAGMA user_version"
  );
  const current = rows[0]?.user_version ?? 0;

  if (current >= TARGET_SCHEMA_VERSION) {
    return;
  }

  logger.info(
    { from: current, to: TARGET_SCHEMA_VERSION },
    "[DB] Running migrations"
  );

  // CLAUDE.md mandates running migrations in a transaction so a partial
  // failure rolls back cleanly. Every migration is idempotent (CREATE IF
  // NOT EXISTS, safeAddColumn) so running them all from current+1 is safe
  // even on a pre-tracker install that already has v1-v6 columns/tables.
  await database.execute("BEGIN TRANSACTION");
  try {
    for (let v = current + 1; v <= TARGET_SCHEMA_VERSION; v++) {
      const fn = migrations[v];
      if (fn) {
        logger.info({ version: v }, "[DB] Applying migration");
        await fn(database);
      }
      await database.execute(`PRAGMA user_version = ${v}`);
    }
    await database.execute("COMMIT");
  } catch (err) {
    await database.execute("ROLLBACK");
    logger.error({ err }, "[DB] Migration failed, rolled back");
    throw err;
  }
}

async function initDb(): Promise<Database> {
  logger.info("[DB] Initializing shared database...");
  const database = await Database.load("sqlite:gallery.db");
  logger.info("[DB] Database connection established");

  try {
    await database.execute("PRAGMA journal_mode=WAL;");
    await database.execute("PRAGMA synchronous=NORMAL;");
    await runMigrations(database);
  } catch (err) {
    // Close the handle so we don't leak it, and clear the cached promise so a
    // subsequent getDb() call gets a fresh attempt rather than re-awaiting a
    // permanently-rejected promise.
    try {
      await database.close();
    } catch {
      // ignore close errors during cleanup
    }
    dbInitPromise = null;
    throw err;
  }

  logger.info("[DB] Ready");
  return database;
}

export async function getDb(): Promise<Database> {
  if (db) {
    return db;
  }
  if (!dbInitPromise) {
    dbInitPromise = initDb();
  }
  db = await dbInitPromise;
  return db;
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
    dbInitPromise = null;
  }
}

/** Returns the SQLite `PRAGMA user_version` — the current schema version. */
export async function getSqliteSchemaVersion(): Promise<number> {
  const database = await getDb();
  const rows = await database.select<[{ user_version: number }]>(
    "PRAGMA user_version"
  );
  return rows[0]?.user_version ?? 0;
}
