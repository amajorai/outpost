/**
 * Repository for the `voice_profile` table (U16).
 *
 * A voice profile is a per-workspace singleton: at most one row per workspace,
 * keyed by a UNIQUE `workspace_id`. Its derived content (a human-readable
 * summary plus structured traits) is a JSON-encoded TEXT column so the shape can
 * evolve without a SQLite migration. Reads parse defensively — a missing or
 * malformed blob degrades to the empty default rather than throwing — so an
 * older or partially-written row never breaks the consumer.
 *
 * Columns are snake_case in SQLite; the domain `VoiceProfile` shape is camelCase.
 * We map explicitly, mirroring `lib/repos/brand-kit.ts`.
 */

import { getDb } from "@/lib/db";
import { DEFAULT_WORKSPACE_ID, type VoiceProfile } from "@/lib/social-schema";

/**
 * Current version of the JSON {@link VoiceProfileData} shape.
 *
 * v1: `{ schemaVersion, summary, traits, sampleCount, derivedAt }`.
 */
export const VOICE_PROFILE_SCHEMA_VERSION = 1;

/**
 * The decoded content of a voice profile, derived from the user's past posts.
 * Versioned per the Data Versioning Contract (CLAUDE.md) so a blob written by a
 * newer app can be migrated forward on read.
 */
export interface VoiceProfileData {
  schemaVersion: number;
  /**
   * A short human-readable summary of the user's writing voice (tone, length,
   * emoji use, hook patterns). Injected into AI prompts when present.
   */
  summary: string;
  /** Short bullet-style traits (e.g. "Conversational tone", "Rarely uses emoji"). */
  traits: string[];
  /** How many past posts the profile was derived from. */
  sampleCount: number;
  /** Unix epoch millis the profile was last derived. */
  derivedAt: number;
}

/** Build an empty, current-version voice profile blob (never persisted). */
export function emptyVoiceProfileData(): VoiceProfileData {
  return {
    schemaVersion: VOICE_PROFILE_SCHEMA_VERSION,
    summary: "",
    traits: [],
    sampleCount: 0,
    derivedAt: 0,
  };
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function coerceTraits(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Decode a stored `profile` string into {@link VoiceProfileData}, tolerating
 * missing or malformed fields. Treats absent fields as the empty default so a
 * blob written by an earlier shape never throws.
 */
export function decodeVoiceProfileData(profile: string): VoiceProfileData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(profile);
  } catch {
    return emptyVoiceProfileData();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return emptyVoiceProfileData();
  }
  const record = parsed as Record<string, unknown>;
  return {
    schemaVersion: VOICE_PROFILE_SCHEMA_VERSION,
    summary: asString(record.summary),
    traits: coerceTraits(record.traits),
    sampleCount: asNumber(record.sampleCount, 0),
    derivedAt: asNumber(record.derivedAt, 0),
  };
}

/** Encode {@link VoiceProfileData} for storage, always writing the current version. */
export function encodeVoiceProfileData(data: VoiceProfileData): string {
  return JSON.stringify({
    schemaVersion: VOICE_PROFILE_SCHEMA_VERSION,
    summary: data.summary,
    traits: data.traits,
    sampleCount: data.sampleCount,
    derivedAt: data.derivedAt,
  } satisfies VoiceProfileData);
}

/** Row shape as returned by the snake_case `voice_profile` table. */
interface VoiceProfileRow {
  id: string;
  workspace_id: string;
  profile: string;
  created_at: number;
  updated_at: number;
}

/** The columns we select, in order, so we never cast a `SELECT *` row. */
const SELECT_COLUMNS = "id, workspace_id, profile, created_at, updated_at";

/**
 * Load the workspace's decoded voice profile, or null when none has been
 * derived yet. Returning null lets callers treat "no profile" as the explicit
 * old default (the Data Versioning Contract: absent must not change behavior).
 */
export async function getVoiceProfile(
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<VoiceProfileData | null> {
  const db = await getDb();
  const rows = await db.select<VoiceProfileRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM voice_profile WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  const data = decodeVoiceProfileData(row.profile);
  return data.summary.trim().length > 0 || data.traits.length > 0 ? data : null;
}

/**
 * Upsert the workspace's voice profile. Inserts the singleton row on first save
 * and updates it in place afterwards (preserving `created_at`). Returns the
 * persisted domain row.
 */
export async function saveVoiceProfile(
  data: VoiceProfileData,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<VoiceProfile> {
  const db = await getDb();
  const now = Date.now();
  const profile = encodeVoiceProfileData(data);

  const existing = await db.select<VoiceProfileRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM voice_profile WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId]
  );

  if (existing.length > 0) {
    const row = existing[0];
    await db.execute(
      "UPDATE voice_profile SET profile = $1, updated_at = $2 WHERE id = $3",
      [profile, now, row.id]
    );
    return {
      id: row.id,
      workspaceId,
      profile,
      createdAt: row.created_at,
      updatedAt: now,
    };
  }

  const id = crypto.randomUUID();
  await db.execute(
    "INSERT INTO voice_profile (id, workspace_id, profile, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
    [id, workspaceId, profile, now, now]
  );
  return { id, workspaceId, profile, createdAt: now, updatedAt: now };
}

/** Delete the workspace's voice profile. Returns true when a row was removed. */
export async function deleteVoiceProfile(
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute(
    "DELETE FROM voice_profile WHERE workspace_id = $1",
    [workspaceId]
  );
  return result.rowsAffected > 0;
}
