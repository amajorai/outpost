/**
 * Dedupe a detected post against the user's own scheduled/published output
 * (U19).
 *
 * The extension detects *every* authored post — including ones Outpost itself
 * cross-posted (which then echo back through the detector). To avoid a re-post
 * loop and avoid re-posting our own scheduled output, a detected post is matched
 * against the user's recent posts before it is ever offered for cross-posting.
 *
 * There is no `text` column on `post_history` or `scheduled_posts`, so matching
 * text requires reading where the post body actually lives:
 *
 * - `post_targets.variant_body` — the per-target body the cross-post pipeline
 *   writes for ad-hoc/cross-posts. This is the echo guard: when we cross-post
 *   text T we store `variant_body = T`, so a re-detected T matches here.
 * - `drafts.body` via `scheduled_posts.draft_id` — composer-scheduled posts.
 *   The body is a JSON blob, so we decode it and compare the post text.
 * - `post_history.remote_url` — a permalink match against an already-published
 *   post (the strongest signal when the detector resolved a permalink).
 *
 * Only rows within a recent time window are considered, so an old unrelated
 * post with identical text doesn't suppress a genuinely new manual post.
 */

import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { decodeDraftBody } from "@/lib/repos/drafts";
import type { DetectedPost } from "./types";

/**
 * How far back to look for a matching own-post. A cross-post echoes back within
 * seconds; a scheduled post fires close to its time. 24h is generous enough to
 * cover clock skew and delayed detection without suppressing genuinely new
 * posts that merely reuse old wording.
 */
export const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Normalize post text for comparison: collapse runs of whitespace (including
 * newlines) to single spaces, trim, and lowercase. Both the detected text and
 * the stored text are normalized the same way so trivial formatting differences
 * (a trailing newline, double spaces) don't defeat the match.
 */
export function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The reason a detected post was treated as a duplicate (for logging/telemetry). */
export type DedupeReason = "permalink" | "variant-body" | "draft-body";

export interface DedupeResult {
  isDuplicate: boolean;
  reason?: DedupeReason;
}

interface VariantBodyRow {
  variant_body: string | null;
}

interface DraftBodyRow {
  body: string;
}

interface RemoteUrlRow {
  remote_url: string | null;
}

/**
 * Decide whether a detected post is one of the user's own recent
 * scheduled/published posts (and therefore must NOT be cross-posted again).
 *
 * Reads three sources within {@link DEDUPE_WINDOW_MS}:
 * 1. permalink vs `post_history.remote_url` (exact match),
 * 2. normalized text vs `post_targets.variant_body` (the cross-post echo guard),
 * 3. normalized text vs decoded `drafts.body` for posts scheduled recently.
 *
 * Never throws — on a query error it returns `isDuplicate: true` (fail-closed),
 * because wrongly re-posting to real accounts is worse than skipping one post.
 */
export async function isOwnRecentPost(
  detected: DetectedPost,
  now: number = Date.now()
): Promise<DedupeResult> {
  const since = now - DEDUPE_WINDOW_MS;
  try {
    const db = await getDb();

    // 1. Permalink match against published history. Strongest signal.
    if (detected.permalink) {
      const urlRows = await db.select<RemoteUrlRow[]>(
        "SELECT remote_url FROM post_history WHERE remote_url = $1 AND published_at >= $2 LIMIT 1",
        [detected.permalink, since]
      );
      if (urlRows.length > 0) {
        return { isDuplicate: true, reason: "permalink" };
      }
    }

    const target = normalizeForCompare(detected.text);
    if (target.length === 0) {
      // No text to match on and no permalink hit: treat as not-a-duplicate so a
      // media-only manual post can still proceed.
      return { isDuplicate: false };
    }

    // 2. variant_body match — covers our own cross-posts (the echo) and any
    // ad-hoc post that stored its body per target. Scope to recently-created
    // scheduled posts via the join so old rows don't match.
    const variantRows = await db.select<VariantBodyRow[]>(
      `SELECT pt.variant_body AS variant_body
       FROM post_targets pt
       JOIN scheduled_posts sp ON sp.id = pt.scheduled_post_id
       WHERE pt.variant_body IS NOT NULL AND sp.created_at >= $1`,
      [since]
    );
    for (const row of variantRows) {
      if (
        row.variant_body &&
        normalizeForCompare(row.variant_body) === target
      ) {
        return { isDuplicate: true, reason: "variant-body" };
      }
    }

    // 3. draft-body match — covers composer-scheduled posts (text lives in the
    // draft JSON, reachable via scheduled_posts.draft_id).
    const draftRows = await db.select<DraftBodyRow[]>(
      `SELECT d.body AS body
       FROM drafts d
       JOIN scheduled_posts sp ON sp.draft_id = d.id
       WHERE sp.created_at >= $1`,
      [since]
    );
    for (const row of draftRows) {
      const decoded = decodeDraftBody(row.body);
      if (normalizeForCompare(decoded.text) === target) {
        return { isDuplicate: true, reason: "draft-body" };
      }
    }

    return { isDuplicate: false };
  } catch (err) {
    // Fail closed: never risk re-posting to real accounts on a query failure.
    logger.error(
      { err },
      "[CrossPost] Dedupe query failed; treating as duplicate"
    );
    return { isDuplicate: true };
  }
}
