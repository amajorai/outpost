/**
 * Repository for the `templates` table (U16).
 *
 * A template is a reusable starting point for a post: a name plus a body. The
 * `body` column is a JSON blob (a versioned {@link TemplateBody}) so a template
 * can carry its text and optional per-platform default overrides without a
 * schema migration — the same approach `drafts.body` uses for `DraftBody`. The
 * `templates` table already exists from the v10 migration; this unit adds no
 * template DDL.
 *
 * Reads tolerate a legacy plain-text body: a body that isn't recognizable JSON
 * decodes as a text-only template, so older rows keep working.
 *
 * Columns are snake_case in SQLite; the domain `Template` shape is camelCase. We
 * map explicitly rather than casting a `SELECT *` row, mirroring the sibling
 * repos.
 */

import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { getDb } from "@/lib/db";
import type { Template } from "@/lib/social-schema";

/**
 * Current version of the JSON {@link TemplateBody} shape.
 *
 * v1: `{ text, platformDefaults? }` — a single text body plus optional
 *     per-platform default text overrides keyed by platform.
 */
export const TEMPLATE_BODY_SCHEMA_VERSION = 1;

/**
 * The decoded shape of a template's `body` JSON. Versioned so a body written by
 * a newer app can be migrated forward on read by older/newer builds, per the
 * Data Versioning Contract (CLAUDE.md).
 */
export interface TemplateBody {
  schemaVersion: number;
  /** The template's primary body text. */
  text: string;
  /**
   * Optional per-platform default body text, keyed by platform. When applying a
   * template, a matching platform default seeds that platform's variant; absent
   * keys fall back to `text`. Absent entirely means "no platform defaults".
   */
  platformDefaults?: Record<string, string>;
}

/** Build an empty, current-version template body. */
export function emptyTemplateBody(): TemplateBody {
  return { schemaVersion: TEMPLATE_BODY_SCHEMA_VERSION, text: "" };
}

/** Coerce an unknown value into a `Record<string, string>`, dropping non-strings. */
function coercePlatformDefaults(
  value: unknown
): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return;
  }
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" && raw.trim().length > 0) {
      out[key] = raw;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Decode a stored `body` string into a {@link TemplateBody}, tolerating missing
 * or malformed fields and a legacy plain-text body. A body that isn't a JSON
 * object is treated as the template's text verbatim, so pre-U16 rows decode as a
 * text-only template.
 */
export function decodeTemplateBody(body: string): TemplateBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Legacy / plain-text body: use the raw string as the template text.
    return { schemaVersion: TEMPLATE_BODY_SCHEMA_VERSION, text: body };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    // A bare JSON string/number is not a template body shape — treat the
    // original string as plain text.
    return { schemaVersion: TEMPLATE_BODY_SCHEMA_VERSION, text: body };
  }
  const record = parsed as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text : "";
  const platformDefaults = coercePlatformDefaults(record.platformDefaults);
  return {
    schemaVersion: TEMPLATE_BODY_SCHEMA_VERSION,
    text,
    ...(platformDefaults ? { platformDefaults } : {}),
  };
}

/** Encode a {@link TemplateBody} for storage, always writing the current version. */
export function encodeTemplateBody(body: TemplateBody): string {
  const platformDefaults = coercePlatformDefaults(body.platformDefaults);
  return JSON.stringify({
    schemaVersion: TEMPLATE_BODY_SCHEMA_VERSION,
    text: body.text,
    ...(platformDefaults ? { platformDefaults } : {}),
  } satisfies TemplateBody);
}

/** Row shape as returned by the snake_case `templates` table. */
interface TemplateRow {
  id: string;
  workspace_id: string;
  name: string;
  body: string;
  created_at: number;
}

/** The columns we select, in order, so we never cast a `SELECT *` row. */
const SELECT_COLUMNS = "id, workspace_id, name, body, created_at";

/** Map a snake_case DB row to the camelCase domain shape. */
function mapRow(row: TemplateRow): Template {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    body: row.body,
    createdAt: row.created_at,
  };
}

/** Fields a caller supplies when saving a template. */
export interface SaveTemplateInput {
  /** Existing template id to update, or omit to insert a new template. */
  id?: string;
  name: string;
  /** The decoded body to persist. */
  body: TemplateBody;
  /** Workspace to scope the template to. Defaults to the default workspace. */
  workspaceId?: string;
}

/**
 * Insert or update a template. When `id` is supplied and the row exists it's
 * updated in place (preserving `created_at`); otherwise a new row is inserted.
 * Returns the persisted domain row.
 */
export async function saveTemplate(
  input: SaveTemplateInput
): Promise<Template> {
  const db = await getDb();
  const workspaceId = input.workspaceId ?? getCurrentWorkspaceId();
  const body = encodeTemplateBody(input.body);
  const name = input.name.trim();

  if (input.id) {
    const existing = await db.select<TemplateRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM templates WHERE id = $1`,
      [input.id]
    );
    if (existing.length > 0) {
      await db.execute(
        "UPDATE templates SET name = $1, body = $2 WHERE id = $3",
        [name, body, input.id]
      );
      return mapRow({ ...existing[0], name, body });
    }
  }

  const id = input.id ?? crypto.randomUUID();
  const createdAt = Date.now();
  await db.execute(
    "INSERT INTO templates (id, workspace_id, name, body, created_at) VALUES ($1, $2, $3, $4, $5)",
    [id, workspaceId, name, body, createdAt]
  );
  return { id, workspaceId, name, body, createdAt };
}

/** Load a single template by id, or null when it doesn't exist. */
export async function getTemplate(id: string): Promise<Template | null> {
  const db = await getDb();
  const rows = await db.select<TemplateRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM templates WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/** List all templates for a workspace, most recently created first. */
export async function listTemplates(
  workspaceId: string = getCurrentWorkspaceId()
): Promise<Template[]> {
  const db = await getDb();
  const rows = await db.select<TemplateRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM templates WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId]
  );
  return rows.map(mapRow);
}

/** Delete a template by id. Returns true when a row was removed. */
export async function deleteTemplate(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute("DELETE FROM templates WHERE id = $1", [id]);
  return result.rowsAffected > 0;
}
