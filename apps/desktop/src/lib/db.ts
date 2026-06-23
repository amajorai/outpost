import Database from "@tauri-apps/plugin-sql";
import { logger } from "@/lib/logger";
import { DEFAULT_WORKSPACE_ID } from "@/lib/social-schema";

let db: Database | null = null;
let dbInitPromise: Promise<Database> | null = null;

// Bump this whenever you add a new migration below.
const TARGET_SCHEMA_VERSION = 13;

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
