/**
 * Repository for the `drafts` table (U8).
 *
 * A draft is a composed-but-unscheduled post. The `body` column is a JSON blob
 * so the composer can evolve its shape without a schema migration: it holds the
 * post text, raw media references, and which accounts were selected. The
 * `DraftBody` interface below is the source of truth for that JSON shape and
 * carries its own `schemaVersion` per the Data Versioning Contract (CLAUDE.md).
 *
 * Columns are snake_case in SQLite; the domain `Draft` shape is camelCase. We map
 * explicitly in both directions rather than casting a `SELECT *` row, mirroring
 * `lib/repos/social-accounts.ts`.
 */

import type { MediaAttachment } from "@/lib/compose/platform-limits";
import { getDb } from "@/lib/db";
import { DEFAULT_WORKSPACE_ID, type Draft } from "@/lib/social-schema";

/**
 * Current version of the JSON {@link DraftBody} shape.
 *
 * v1: `{ text, media, accountIds }` — a single post body.
 * v2: adds `segments` (U12), an ordered list of {text, media} so the composer
 *     can author X threads and IG/LinkedIn carousels. The top-level `text`/
 *     `media` are kept and always mirror `segments[0]`, so a v1 reader (and any
 *     consumer that doesn't understand segments) degrades to the first segment
 *     with no special-casing.
 */
export const DRAFT_BODY_SCHEMA_VERSION = 2;

/** One ordered piece of a multi-segment post (a thread tweet / carousel slide). */
export interface DraftSegment {
  /** This segment's text. */
  text: string;
  /** This segment's media attachments, in order. */
  media: MediaAttachment[];
}

/**
 * The decoded shape of a draft's `body` JSON. Versioned so a body written by a
 * newer app can be migrated forward on read by older/newer builds.
 */
export interface DraftBody {
  schemaVersion: number;
  /**
   * The first segment's text, mirrored from `segments[0]`. Kept from v1 so any
   * consumer that doesn't understand `segments` degrades to the first segment.
   */
  text: string;
  /** The first segment's media, mirrored from `segments[0]`. */
  media: MediaAttachment[];
  /** Social account ids selected as publish targets. */
  accountIds: string[];
  /** Ordered segments (always length >= 1). `segments[0]` mirrors text/media. */
  segments: DraftSegment[];
}

/** Build an empty, current-version draft body with one empty segment. */
export function emptyDraftBody(): DraftBody {
  return {
    schemaVersion: DRAFT_BODY_SCHEMA_VERSION,
    text: "",
    media: [],
    accountIds: [],
    segments: [{ text: "", media: [] }],
  };
}

/** Coerce an unknown array of media into a typed {@link MediaAttachment} list. */
function coerceMedia(value: unknown): MediaAttachment[] {
  return Array.isArray(value) ? (value as MediaAttachment[]) : [];
}

/**
 * Migrate a v1 body (no `segments`) to v2 by synthesizing a single segment from
 * the top-level text/media. Per the Data Versioning Contract, a missing field is
 * treated as the old default so absence never changes behavior.
 */
function migrateV1ToV2(record: Record<string, unknown>): DraftBody {
  const text = typeof record.text === "string" ? record.text : "";
  const media = coerceMedia(record.media);
  const accountIds = Array.isArray(record.accountIds)
    ? (record.accountIds as string[])
    : [];
  return {
    schemaVersion: DRAFT_BODY_SCHEMA_VERSION,
    text,
    media,
    accountIds,
    segments: [{ text, media }],
  };
}

/** Read a `segments` array from a v2 record, falling back to a single segment. */
function readSegments(
  record: Record<string, unknown>,
  fallbackText: string,
  fallbackMedia: MediaAttachment[]
): DraftSegment[] {
  if (!Array.isArray(record.segments) || record.segments.length === 0) {
    return [{ text: fallbackText, media: fallbackMedia }];
  }
  return record.segments.map((raw) => {
    const seg = (raw ?? {}) as Record<string, unknown>;
    return {
      text: typeof seg.text === "string" ? seg.text : "",
      media: coerceMedia(seg.media),
    };
  });
}

/**
 * Decode a stored `body` string into a {@link DraftBody}, tolerating missing or
 * malformed fields. Treats absent fields as the empty default so a body written
 * by an earlier shape never throws. Runs the migration pipeline so a v1 body is
 * upgraded to the current shape on read.
 */
export function decodeDraftBody(body: string): DraftBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return emptyDraftBody();
  }
  if (typeof parsed !== "object" || parsed === null) {
    return emptyDraftBody();
  }
  const record = parsed as Record<string, unknown>;

  // v1 bodies (and anything without a recognizable version) carry no segments —
  // synthesize one from the legacy top-level fields.
  const version =
    typeof record.schemaVersion === "number" ? record.schemaVersion : 1;
  if (version < 2) {
    return migrateV1ToV2(record);
  }

  const accountIds = Array.isArray(record.accountIds)
    ? (record.accountIds as string[])
    : [];
  const topText = typeof record.text === "string" ? record.text : "";
  const topMedia = coerceMedia(record.media);
  const segments = readSegments(record, topText, topMedia);
  return {
    schemaVersion: DRAFT_BODY_SCHEMA_VERSION,
    // Top-level always mirrors segment 0 so degrade-to-first is automatic.
    text: segments[0].text,
    media: segments[0].media,
    accountIds,
    segments,
  };
}

/**
 * Encode a {@link DraftBody} for storage, always writing the current version.
 * Normalizes to at least one segment and mirrors `segments[0]` into the
 * top-level `text`/`media` so older readers degrade to the first segment.
 */
export function encodeDraftBody(body: DraftBody): string {
  const segments =
    body.segments.length > 0 ? body.segments : [{ text: "", media: [] }];
  return JSON.stringify({
    schemaVersion: DRAFT_BODY_SCHEMA_VERSION,
    text: segments[0].text,
    media: segments[0].media,
    accountIds: body.accountIds,
    segments,
  } satisfies DraftBody);
}

/** Row shape as returned by the snake_case `drafts` table. */
interface DraftRow {
  id: string;
  workspace_id: string;
  body: string;
  created_at: number;
  updated_at: number;
}

/** The columns we select, in order, so we never cast a `SELECT *` row. */
const SELECT_COLUMNS = "id, workspace_id, body, created_at, updated_at";

/** Map a snake_case DB row to the camelCase domain shape. */
function mapRow(row: DraftRow): Draft {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Fields a caller supplies when saving a draft. */
export interface SaveDraftInput {
  /** Existing draft id to update, or omit to insert a new draft. */
  id?: string;
  /** The decoded body to persist. */
  body: DraftBody;
  /** Workspace to scope the draft to. Defaults to the default workspace. */
  workspaceId?: string;
}

/**
 * Insert or update a draft. When `id` is supplied and the row exists it's
 * updated in place (preserving `created_at`); otherwise a new row is inserted.
 * Returns the persisted domain row.
 */
export async function saveDraft(input: SaveDraftInput): Promise<Draft> {
  const db = await getDb();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const body = encodeDraftBody(input.body);
  const now = Date.now();

  if (input.id) {
    const existing = await db.select<DraftRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM drafts WHERE id = $1`,
      [input.id]
    );
    if (existing.length > 0) {
      await db.execute(
        "UPDATE drafts SET body = $1, updated_at = $2 WHERE id = $3",
        [body, now, input.id]
      );
      const row = existing[0];
      return mapRow({ ...row, body, updated_at: now });
    }
  }

  const id = input.id ?? crypto.randomUUID();
  await db.execute(
    "INSERT INTO drafts (id, workspace_id, body, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
    [id, workspaceId, body, now, now]
  );
  return {
    id,
    workspaceId,
    body,
    createdAt: now,
    updatedAt: now,
  };
}

/** Load a single draft by id, or null when it doesn't exist. */
export async function getDraft(id: string): Promise<Draft | null> {
  const db = await getDb();
  const rows = await db.select<DraftRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM drafts WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/** List all drafts for a workspace, most recently updated first. */
export async function listDrafts(
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<Draft[]> {
  const db = await getDb();
  const rows = await db.select<DraftRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM drafts WHERE workspace_id = $1 ORDER BY updated_at DESC`,
    [workspaceId]
  );
  return rows.map(mapRow);
}

/** Delete a draft by id. Returns true when a row was removed. */
export async function deleteDraft(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute("DELETE FROM drafts WHERE id = $1", [id]);
  return result.rowsAffected > 0;
}
