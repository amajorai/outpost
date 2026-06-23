/**
 * Repository for the `tracked_links` table (U31).
 *
 * UTM / affiliate link tracking: one row per shareable link, holding its
 * destination URL, a typed UTM blob (stored as JSON in SQLite — the brand_kit
 * precedent), a generated workspace-unique `short_code`, and a best-effort
 * `clicks` counter. There is no redirect server, so `clicks` is incremented
 * manually from the UI rather than tracked automatically — true attribution is
 * out of scope for v1, per the unit.
 *
 * Columns are snake_case in SQLite; the domain `TrackedLink` shape is camelCase.
 * We map explicitly in both directions rather than casting a `SELECT *` row,
 * mirroring the sibling repos. Queries are scoped by `workspace_id`.
 */

import { getDb } from "@/lib/db";
import {
  DEFAULT_WORKSPACE_ID,
  type TrackedLink,
  type UtmParams,
} from "@/lib/social-schema";

/** Row shape as returned by the snake_case `tracked_links` table. */
interface TrackedLinkRow {
  id: string;
  workspace_id: string;
  label: string;
  destination_url: string;
  utm: string;
  short_code: string;
  clicks: number;
  created_at: number;
}

const SELECT_COLUMNS =
  "id, workspace_id, label, destination_url, utm, short_code, clicks, created_at";

const EMPTY_UTM: UtmParams = {
  source: null,
  medium: null,
  campaign: null,
  term: null,
  content: null,
};

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Parse the JSON `utm` blob into a typed shape; missing keys decode to null. */
function parseUtm(raw: string): UtmParams {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { ...EMPTY_UTM };
    }
    const record = parsed as Record<string, unknown>;
    return {
      source: stringOrNull(record.source),
      medium: stringOrNull(record.medium),
      campaign: stringOrNull(record.campaign),
      term: stringOrNull(record.term),
      content: stringOrNull(record.content),
    };
  } catch {
    return { ...EMPTY_UTM };
  }
}

function mapRow(row: TrackedLinkRow): TrackedLink {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    label: row.label,
    destinationUrl: row.destination_url,
    utm: parseUtm(row.utm),
    shortCode: row.short_code,
    clicks: row.clicks,
    createdAt: row.created_at,
  };
}

const SHORT_CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SHORT_CODE_LENGTH = 7;

/** Generate a random short code from a lowercase-alphanumeric alphabet. */
function generateShortCode(): string {
  const bytes = new Uint8Array(SHORT_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += SHORT_CODE_ALPHABET[byte % SHORT_CODE_ALPHABET.length];
  }
  return code;
}

/** Fields a caller supplies when creating a tracked link. */
export interface CreateTrackedLinkInput {
  label: string;
  destinationUrl: string;
  utm?: Partial<UtmParams>;
  workspaceId?: string;
}

const MAX_SHORT_CODE_ATTEMPTS = 5;

/**
 * Build the full UTM-tagged URL for a link: the destination with any non-null
 * UTM params appended as `utm_*` query parameters. Pure — used by the UI's copy
 * action and by the media kit. Invalid destination URLs are returned unchanged.
 */
export function buildTrackedUrl(link: TrackedLink): string {
  let url: URL;
  try {
    url = new URL(link.destinationUrl);
  } catch {
    return link.destinationUrl;
  }
  const params: [string, string | null][] = [
    ["utm_source", link.utm.source],
    ["utm_medium", link.utm.medium],
    ["utm_campaign", link.utm.campaign],
    ["utm_term", link.utm.term],
    ["utm_content", link.utm.content],
  ];
  for (const [key, value] of params) {
    if (value !== null) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/**
 * Create a tracked link with a generated, workspace-unique short code. Retries a
 * few times on the (vanishingly rare) UNIQUE collision before giving up.
 */
export async function createTrackedLink(
  input: CreateTrackedLinkInput
): Promise<TrackedLink> {
  const db = await getDb();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const utm: UtmParams = { ...EMPTY_UTM, ...input.utm };

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_SHORT_CODE_ATTEMPTS; attempt++) {
    const shortCode = generateShortCode();
    try {
      await db.execute(
        `INSERT INTO tracked_links (id, workspace_id, label, destination_url, utm, short_code, clicks, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7)`,
        [
          id,
          workspaceId,
          input.label,
          input.destinationUrl,
          JSON.stringify(utm),
          shortCode,
          createdAt,
        ]
      );
      return {
        id,
        workspaceId,
        label: input.label,
        destinationUrl: input.destinationUrl,
        utm,
        shortCode,
        clicks: 0,
        createdAt,
      };
    } catch (error) {
      lastError = error;
      if (!String(error).toLowerCase().includes("unique")) {
        throw error;
      }
    }
  }
  throw new Error(
    `Failed to generate a unique short code after ${MAX_SHORT_CODE_ATTEMPTS} attempts: ${String(lastError)}`
  );
}

/** List a workspace's tracked links, newest first. */
export async function listTrackedLinks(
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<TrackedLink[]> {
  const db = await getDb();
  const rows = await db.select<TrackedLinkRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM tracked_links WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId]
  );
  return rows.map(mapRow);
}

/** Best-effort: bump a link's click counter by one. */
export async function incrementLinkClicks(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE tracked_links SET clicks = clicks + 1 WHERE id = $1",
    [id]
  );
}

/** Set a link's click counter to an exact value (manual correction). */
export async function setLinkClicks(id: string, clicks: number): Promise<void> {
  const db = await getDb();
  const safeClicks = Math.max(0, Math.round(clicks));
  await db.execute("UPDATE tracked_links SET clicks = $1 WHERE id = $2", [
    safeClicks,
    id,
  ]);
}

/** Delete a tracked link by id. */
export async function deleteTrackedLink(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM tracked_links WHERE id = $1", [id]);
}
